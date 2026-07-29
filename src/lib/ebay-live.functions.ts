import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getFreshEbayTokenForAccount, reviseEbayListingText, endEbayFixedPriceListing } from "./ebay.server";
import {
  fetchLiveListings, fetchLiveListingsSummary,
  fetchEbayOrders, fetchEbayTransactions, fetchEbayTrafficReport, fetchEbayCampaigns,
  fetchEbaySalesSummary, SALES_WINDOW_LIMIT,
  type LiveListing,
} from "./ebay-live.server";


function requireAccount(accountId?: string | null) {
  if (!accountId) throw new Error("Pick an eBay account first.");
  return accountId;
}

// -------- Live listings for the Optimizer --------

export type LiveOptimizerAction = LiveListing & {
  action: "end" | "rewrite_title" | "noop";
  reason: string;
  needs_ai: boolean;
};

function scoreLive(l: LiveListing, rule: any): LiveOptimizerAction {
  const daysNoSales = Number(rule?.optimizer_no_sales_days ?? 30);
  const daysLowWatch = Number(rule?.optimizer_low_views_days ?? 14);
  const hasBanned = /the\s+sale\s+of\s+amazon/i.test(l.title) || /\bBan\s.*the\s+sale\s+of\s+amazon/i.test(l.title);
  if (hasBanned) return { ...l, action: "rewrite_title", reason: "prohibited phrase", needs_ai: false };
  if (l.ageDays >= daysNoSales && l.quantitySold === 0 && l.watchers === 0) {
    return { ...l, action: "end", reason: `${l.ageDays}d · 0 sales · 0 watchers`, needs_ai: false };
  }
  if (l.ageDays >= daysLowWatch && l.watchers === 0) {
    return { ...l, action: "rewrite_title", reason: `${l.ageDays}d · 0 watchers`, needs_ai: true };
  }
  return { ...l, action: "noop", reason: "healthy", needs_ai: false };
}

export const analyzeOptimizerLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => d)
  .handler(async ({ data, context }: any): Promise<LiveOptimizerAction[]> => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    const listings = await fetchLiveListings(token);
    return listings.map((l) => scoreLive(l, rule));
  });

export const applyOptimizerActionLive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; itemId: string; action: "end" | "rewrite_title"; newTitle?: string; useAi?: boolean; currentTitle?: string }) => d)
  .handler(async ({ data, context }: any) => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    if (data.action === "end") {
      await endEbayFixedPriceListing(token, data.itemId, "NotAvailable");
      await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "optimizer", message: `Ended eBay listing ${data.itemId}`, metadata: { accountId: data.accountId } });
      return { ok: true, action: "end" as const };
    }
    // rewrite_title
    let title = (data.newTitle || "").trim();
    if (!title && data.useAi && process.env.LOVABLE_API_KEY && data.currentTitle) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Lovable-API-Key": process.env.LOVABLE_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "Rewrite an eBay title for search. Max 80 chars. Keep brand/model/spec keywords. No emojis, ALL CAPS, or marketplace names. Return the title only." },
              { role: "user", content: data.currentTitle },
            ],
          }),
        });
        const j = await res.json();
        title = String(j.choices?.[0]?.message?.content || "").replace(/["\n]/g, " ").trim().slice(0, 80);
      } catch { /* keep original */ }
    }
    if (!title) title = (data.currentTitle || "").slice(0, 80);
    if (!title) throw new Error("No new title generated.");
    await reviseEbayListingText(token, data.itemId, title);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "optimizer", message: `Retitled ${data.itemId}: ${title}`, metadata: { accountId: data.accountId } });
    return { ok: true, action: "rewrite_title" as const, newTitle: title };
  });

// -------- Dashboard live overview (per account) --------

export const getLiveAccountsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data: accounts } = await context.supabase
      .from("ebay_accounts")
      .select("id, account_name, is_active, refresh_token");
    const list = accounts || [];
    const { data: drafts } = await context.supabase
      .from("listing_drafts").select("id, account_id, status");
    const draftAgg = new Map<string | null, { pending: number; failed: number; total: number }>();
    for (const d of drafts || []) {
      const key = d.account_id;
      const a = draftAgg.get(key) || { pending: 0, failed: 0, total: 0 };
      a.total++;
      if (d.status === "pending") a.pending++;
      if (d.status === "failed") a.failed++;
      draftAgg.set(key, a);
    }
    const out = await Promise.all(list.map(async (a: any) => {
      const dr = draftAgg.get(a.id) || { pending: 0, failed: 0, total: 0 };
      let listings_active = 0, watchers = 0, units_sold = 0, orders_count = 0, sales_total = 0, live_error: string | null = null;
      if (a.is_active && a.refresh_token) {
        try {
          const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, a.id);
          const s = await fetchLiveListingsSummary(token);
          listings_active = s.total; watchers = s.totalWatchers;
          // Orders/sales come from the shared summary so the dashboard, Orders
          // and Finances pages always show identical numbers.
          try {
            const sum = await fetchEbaySalesSummary(token);
            orders_count = sum.ordersCount; sales_total = sum.sales; units_sold = sum.units;
          } catch { units_sold = s.totalSold; }
        } catch (e) { live_error = e instanceof Error ? e.message : String(e); }
      }
      return {
        id: a.id, account_name: a.account_name, is_active: a.is_active,
        connected: !!a.refresh_token,
        listings_active, watchers, units_sold, orders_count, sales_total,
        drafts_pending: dr.pending, drafts_failed: dr.failed, drafts_total: dr.total,
        live_error,
      };
    }));
    return { accounts: out };
  });

// -------- Orders / Finances / Analytics / Marketing --------

export const listEbayOrdersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; limit?: number }) => d)
  .handler(async ({ data, context }: any) => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    return fetchEbayOrders(token, data.limit ?? SALES_WINDOW_LIMIT);
  });

// Sales figure shared by the Finances page — same window as Orders.
export const getEbaySalesSummaryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => d)
  .handler(async ({ data, context }: any) => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    const s = await fetchEbaySalesSummary(token);
    return { ordersCount: s.ordersCount, sales: s.sales, units: s.units, orders: s.orders.slice(0, 100) };
  });


export const listEbayTransactionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; limit?: number }) => d)
  .handler(async ({ data, context }: any) => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    return fetchEbayTransactions(token, data.limit ?? 50);
  });

export const getEbayTrafficReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => d)
  .handler(async ({ data, context }: any) => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    return fetchEbayTrafficReport(token);
  });

export const listEbayCampaignsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string }) => d)
  .handler(async ({ data, context }: any) => {
    requireAccount(data.accountId);
    const token = await getFreshEbayTokenForAccount(context.supabase, context.userId, data.accountId);
    return fetchEbayCampaigns(token);
  });
