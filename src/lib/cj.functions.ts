import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cjSearchProducts,
  cjGetCategories,
  cjGetWarehouses,
  cjProductDetail,
  cjFreightCalculate,
  cjGetAccessToken,
  saveCjCreds,
  getUserCjToken,
  type CjListResponse,
  type CjProductDetail,
  type CjFreightOption,
  type CjCategoryTree,
  type CjWarehouse,
} from "./cj.server";
import { stripBanAmazon, buildCleanCategoryQuery, isAutomotiveSignal } from "./ebay.functions";
import { getCategorySuggestions, getFreshEbayToken } from "./ebay.server";

async function tok(ctx: any) {
  return getUserCjToken(ctx.supabase, ctx.userId);
}

export const searchCjProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { keyword?: string; categoryId?: string; pageNum?: number; pageSize?: number; countryCode?: string; minPrice?: number; maxPrice?: number; }) => data)
  .handler(async ({ data, context }: any): Promise<CjListResponse> => cjSearchProducts(data, await tok(context)));

export const getCjProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pid: string; countryCode?: string }) => data)
  .handler(async ({ data, context }: any): Promise<CjProductDetail> => cjProductDetail(data.pid, data.countryCode, await tok(context)));

export const getCjCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjCategoryTree[]> => cjGetCategories(await tok(context)));

export const getCjWarehouses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjWarehouse[]> => cjGetWarehouses(await tok(context)));

export const getCjFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { startCountryCode?: string; endCountryCode: string; products: { vid: string; quantity: number }[]; }) => data)
  .handler(async ({ data, context }: any): Promise<CjFreightOption[]> => cjFreightCalculate(data, await tok(context)));

// The user only supplies their CJ account email + API key. The server
// immediately exchanges them for access/refresh tokens, validates them and
// stores everything. Token renewal happens automatically afterwards.
export const saveCjApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; apiKey: string }) => data)
  .handler(async ({ data, context }: any) => {
    const email = data.email?.trim();
    const apiKey = data.apiKey?.trim();
    if (!email) throw new Error("CJ account email is required");
    if (!apiKey) throw new Error("CJ API key is required");
    // Validate by fetching a fresh token pair right away.
    const t = await cjGetAccessToken(email, apiKey);
    await saveCjCreds(context.supabase, context.userId, {
      email,
      api_key: apiKey,
      access_token: t.accessToken,
      access_token_expiry: t.accessTokenExpiryDate,
      refresh_token: t.refreshToken,
      refresh_token_expiry: t.refreshTokenExpiryDate,
    });
    return { ok: true };
  });

// Reports connection status considering per-user creds first, then env fallback.
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data } = await context.supabase.from("integration_credentials").select("provider,is_active,last_validated_at,credentials").eq("user_id", context.userId);
    const cjRow = data?.find((r: any) => r.provider === "cj");
    const ebayRow = data?.find((r: any) => r.provider === "ebay");
    const cjUserConfigured = !!(cjRow?.is_active && (cjRow.credentials?.api_key || cjRow.credentials?.access_token));
    const cjConnected = cjUserConfigured || !!(process.env.CJ_API_KEY && process.env.CJ_EMAIL) || !!process.env.CJ_ACCESS_TOKEN;
    const ebayConnected = !!(ebayRow?.is_active && ebayRow.credentials?.refresh_token);
    return {
      cj: {
        connected: cjConnected,
        source: cjUserConfigured ? "user" : cjConnected ? "env" : null,
        last: cjRow?.last_validated_at || null,
        email: cjRow?.credentials?.email || null,
      },
      ebay: { connected: ebayConnected, source: ebayConnected ? "user" : null, last: ebayRow?.last_validated_at || null },
    };
  });

// Bulk send CJ products to the drafts queue with an automatic freight quote.
// For each product we hit CJ product detail, pick the first variant, quote the
// cheapest freight option to the target country (US by default), then upsert
// a draft that already includes shipping in its landed cost.
export const bulkSendCjToDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pids: string[]; endCountry?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const pids: string[] = Array.from(new Set((data.pids || []).map(String).filter(Boolean))) as string[];
    if (pids.length === 0) throw new Error("No products selected");
    const endCountry = (data.endCountry || "US").toUpperCase();
    const token = await tok(context);
    const { data: rule } = await context.supabase
      .from("automation_rules")
      .select("markup_percent,ebay_fee_buffer_percent")
      .eq("user_id", context.userId)
      .maybeSingle();
    const markupPct = Number(rule?.markup_percent ?? 50);
    const feePct = Number(rule?.ebay_fee_buffer_percent ?? 17) / 100;

    // Best-effort: fetch an eBay token once so we can auto-suggest a category per draft.
    let ebayToken: string | null = null;
    try { ebayToken = await getFreshEbayToken(context.supabase, context.userId); } catch { ebayToken = null; }

    const results: { pid: string; ok: boolean; carrier?: string; shipping?: number; error?: string; draftId?: string; categoryId?: string | null }[] = [];
    // Fetch details/freight in small parallel batches to keep it fast without hammering CJ.
    const batchSize = 4;
    for (let i = 0; i < pids.length; i += batchSize) {
      const batch = pids.slice(i, i + batchSize);
      const done = await Promise.all(batch.map(async (pid) => {
        try {
          const detail: any = await cjProductDetail(pid, endCountry, token);
          const variants: any[] = detail?.variants ?? detail?.variantList ?? detail?.productVariants ?? [];
          const first = variants[0];
          const vid = first?.vid || detail?.vid;
          const itemCost = Number(first?.variantSellPrice ?? detail?.sellPrice ?? 0);
          let shipping = itemCost * 0.2;
          let carrierName: string | null = null;
          let carrierDays: string | null = null;
          if (vid) {
            try {
              const options = await cjFreightCalculate({ endCountryCode: endCountry, products: [{ vid, quantity: 1 }] }, token);
              const cheapest = [...(options || [])].sort((a, b) => Number(a.logisticPrice ?? 0) - Number(b.logisticPrice ?? 0))[0];
              if (cheapest) {
                shipping = Number(cheapest.logisticPrice ?? shipping);
                carrierName = cheapest.logisticName;
                carrierDays = cheapest.logisticAging;
              }
            } catch { /* fall back to estimate */ }
          }
          const landed = itemCost + shipping;
          const desiredProfit = landed * (markupPct / 100);
          const preFee = landed + desiredProfit;
          const ebayFee = preFee * feePct;
          const finalSell = preFee + ebayFee;
          const cjCategoryName = detail?.categoryName || null;
          const title = stripBanAmazon(String(detail?.productNameEn || "")).slice(0, 80);
          const images = [detail?.bigImage, detail?.productImage, ...(detail?.productImageSet || [])].filter(Boolean).slice(0, 12);

          // Auto-suggest eBay category so drafts are ready to push.
          let categoryId: string | null = null;
          let categoryPath: string | null = null;
          if (ebayToken) {
            try {
              const q = buildCleanCategoryQuery({ title, cjCategoryName });
              const rows = await getCategorySuggestions(ebayToken, q, "EBAY_US");
              const auto = isAutomotiveSignal(q, cjCategoryName);
              const filtered = auto ? rows.filter((r: { path: string }) => /ebay motors|parts\s*&\s*accessories/i.test(r.path)) : rows;
              const pick = (filtered.length ? filtered : rows)[0];
              if (pick) { categoryId = pick.categoryId; categoryPath = pick.path; }
            } catch { /* leave blank; user can pick manually */ }
          }

          const row = {
            user_id: context.userId,
            cj_product_id: pid,
            cj_variant_id: vid || null,
            sku: first?.variantSku || detail?.productSku || pid,
            title,
            price: Number(finalSell.toFixed(2)),
            images,
            description: stripBanAmazon(detail?.description ?? ""),
            status: "pending" as const,
            category_id: categoryId,
            item_specifics: { Brand: "Unbranded", Condition: "New" },
            profit: {
              item_cost: itemCost,
              shipping: Number(shipping.toFixed(2)),
              carrier: carrierName,
              carrier_days: carrierDays,
              markup_pct: markupPct,
              ebay_fee_pct: feePct,
              ebay_fee: Number(ebayFee.toFixed(2)),
              profit: Number(desiredProfit.toFixed(2)),
              desired_profit: Number(desiredProfit.toFixed(2)),
              end_country: endCountry,
              start_country: "CN",
              product_key: detail?.productKeyEn || null,
              cj_category_name: cjCategoryName,
              ebay_category_path: categoryPath,
              auto_quoted: true,
            },
          };
          const { data: saved } = await context.supabase
            .from("listing_drafts")
            .upsert(row, { onConflict: "user_id,cj_product_id", ignoreDuplicates: false })
            .select("id")
            .maybeSingle();
          return { pid, ok: true, carrier: carrierName || undefined, shipping: Number(shipping.toFixed(2)), draftId: saved?.id, categoryId };
        } catch (e) {
          return { pid, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }));
      results.push(...done);
    }
    return { total: pids.length, ok: results.filter((r) => r.ok).length, results };
  });
