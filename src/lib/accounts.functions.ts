import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ------------------------- eBay accounts -------------------------

export const listEbayAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data, error } = await context.supabase
      .from("ebay_accounts")
      .select("id, account_name, ebay_user_id, region, is_active, token_expires_at, refresh_token, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      account_name: row.account_name,
      ebay_user_id: row.ebay_user_id,
      region: row.region,
      is_active: row.is_active,
      connected: !!row.refresh_token,
      token_expires_at: row.token_expires_at,
      created_at: row.created_at,
    }));
  });

export const createEbayAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { account_name: string; region?: string }) =>
    z.object({
      account_name: z.string().trim().min(1).max(60),
      region: z.string().trim().max(4).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }: any) => {
    const { data: row, error } = await context.supabase
      .from("ebay_accounts")
      .insert({
        user_id: context.userId,
        account_name: data.account_name,
        region: data.region || "US",
        is_active: true,
      })
      .select("id, account_name, region, is_active")
      .single();
    if (error) throw error;
    return row;
  });

export const updateEbayAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; account_name?: string; region?: string; is_active?: boolean }) =>
    z.object({
      id: z.string().uuid(),
      account_name: z.string().trim().min(1).max(60).optional(),
      region: z.string().trim().max(4).optional(),
      is_active: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }: any) => {
    const patch: any = {};
    if (data.account_name !== undefined) patch.account_name = data.account_name;
    if (data.region !== undefined) patch.region = data.region;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    const { error } = await context.supabase
      .from("ebay_accounts")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteEbayAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }: any) => {
    const { error } = await context.supabase
      .from("ebay_accounts")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// ------------------------- Account rules -------------------------

export const listAccountRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data, error } = await context.supabase
      .from("account_rules")
      .select("id, account_id, cj_category, region, is_preferred, created_at")
      .order("cj_category", { ascending: true });
    if (error) throw error;
    return data || [];
  });

export const upsertAccountRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; account_id: string; cj_category: string; region?: string; is_preferred?: boolean }) =>
    z.object({
      id: z.string().uuid().optional(),
      account_id: z.string().uuid(),
      cj_category: z.string().trim().min(1).max(300),
      region: z.string().trim().max(4).optional(),
      is_preferred: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }: any) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("account_rules")
        .update({
          account_id: data.account_id,
          cj_category: data.cj_category,
          region: data.region || null,
          is_preferred: data.is_preferred ?? true,
        })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      if (error) throw error;
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("account_rules")
      .insert({
        user_id: context.userId,
        account_id: data.account_id,
        cj_category: data.cj_category,
        region: data.region || null,
        is_preferred: data.is_preferred ?? true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: row.id };
  });

export const deleteAccountRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }: any) => {
    const { error } = await context.supabase
      .from("account_rules")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

// ------------------------- Combined dashboard summary -------------------------

export const getAccountsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data: accounts } = await context.supabase
      .from("ebay_accounts")
      .select("id, account_name, is_active");
    const list = accounts || [];
    if (list.length === 0) return { accounts: [] };

    const [listings, drafts] = await Promise.all([
      context.supabase
        .from("ebay_listings")
        .select("id, account_id, status, sales, views, price"),
      context.supabase
        .from("listing_drafts")
        .select("id, account_id, status"),
    ]);

    const byAccount = new Map<string, any>();
    for (const a of list) {
      byAccount.set(a.id, {
        id: a.id,
        account_name: a.account_name,
        is_active: a.is_active,
        listings_active: 0,
        listings_total: 0,
        drafts_pending: 0,
        drafts_failed: 0,
        units_sold: 0,
        views: 0,
        gmv: 0,
      });
    }
    for (const l of listings.data || []) {
      const agg = byAccount.get(l.account_id);
      if (!agg) continue;
      agg.listings_total++;
      if (l.status === "active") agg.listings_active++;
      agg.units_sold += l.sales || 0;
      agg.views += l.views || 0;
      agg.gmv += Number(l.price || 0) * (l.sales || 0);
    }
    for (const d of drafts.data || []) {
      const agg = byAccount.get(d.account_id);
      if (!agg) continue;
      if (d.status === "pending") agg.drafts_pending++;
      if (d.status === "failed") agg.drafts_failed++;
    }
    return { accounts: Array.from(byAccount.values()) };
  });
