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
import { stripBanAmazon, deepScanEbayCategory } from "./ebay.functions";
import { getFreshEbayToken } from "./ebay.server";
import { calculateRulePrice, finitePositivePrice } from "./pricing";

async function tok(ctx: any) {
  return getUserCjToken(ctx.supabase, ctx.userId);
}

export const searchCjProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { keyword?: string; categoryId?: string; categoryIds?: string[]; pageNum?: number; pageSize?: number; countryCode?: string; minPrice?: number; maxPrice?: number; }) => data)
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
  .inputValidator((data: { pids: string[]; endCountry?: string; stockCountry?: string | null; preferredVariantId?: string | null; shippingOverride?: number | null; carrierOverride?: string | null }) => data)
  .handler(async ({ data, context }: any) => {
    const pids: string[] = Array.from(new Set((data.pids || []).map(String).filter(Boolean))) as string[];
    if (pids.length === 0) throw new Error("No products selected");
    const endCountry = (data.endCountry || "US").toUpperCase();
    // When the research page filtered by a warehouse country (e.g. US stock),
    // that country is the real ship-from — never default such products to CN.
    const filterStockCountry = String(data.stockCountry || "").trim().toUpperCase() || null;
    const token = await tok(context);

    const { data: rule } = await context.supabase
      .from("automation_rules")
      .select("markup_percent,min_profit_usd,ebay_fee_buffer_percent,payment_fee_buffer_percent,round_to,max_listing_quantity")
      .eq("user_id", context.userId)
      .maybeSingle();
    const targetQty = Math.max(1, Number(rule?.max_listing_quantity ?? 1));

    // Load account routing: cj_category → ebay_accounts.id. When a draft's
    // CJ category matches a rule, we assign that account. Otherwise fall
    // back to the user's first active connected account so downstream
    // dashboards can still filter cleanly.
    const [{ data: rules }, { data: accts }] = await Promise.all([
      context.supabase.from("account_rules").select("account_id, cj_category").eq("user_id", context.userId),
      context.supabase
        .from("ebay_accounts")
        .select("id, is_active, refresh_token, created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: true }),
    ]);
    const ruleMap = new Map<string, string>();
    for (const r of rules || []) if (r.cj_category) ruleMap.set(String(r.cj_category).trim().toLowerCase(), r.account_id);
    const usable = (accts || []).filter((a: any) => a.is_active && a.refresh_token);
    // Only auto-assign when there's exactly one connected account. With several
    // connected accounts, an unmatched draft stays unassigned so the user is
    // asked which seller to publish to (instead of silently using the first).
    const defaultAccountId: string | null = usable.length === 1 ? usable[0].id : null;
    const routeAccount = (cjCategoryName: string | null | undefined): string | null => {
      const cat = String(cjCategoryName || "").trim();
      if (!cat) return defaultAccountId;
      // Try full path, then each segment, most specific first.
      const segments = cat.split(/[\/>|,]/).map((s) => s.trim()).filter(Boolean);
      const candidates = [cat, ...segments.reverse()];
      for (const c of candidates) {
        const hit = ruleMap.get(c.toLowerCase());
        if (hit) return hit;
      }
      return defaultAccountId;
    };


    // Best-effort: fetch an eBay token once so we can auto-suggest a category per draft.
    let ebayToken: string | null = null;
    try { ebayToken = await getFreshEbayToken(context.supabase, context.userId); } catch { ebayToken = null; }

    const results: { pid: string; ok: boolean; carrier?: string; shipping?: number; error?: string; draftId?: string; categoryId?: string | null; accountId?: string | null }[] = [];
    // Fetch details/freight in small parallel batches to keep it fast without hammering CJ.
    const batchSize = 4;
    for (let i = 0; i < pids.length; i += batchSize) {
      const batch = pids.slice(i, i + batchSize);
      const done = await Promise.all(batch.map(async (pid) => {
        const notes: string[] = [];
        try {
          const detail: any = await cjProductDetail(pid, endCountry, token);
          const variants: any[] = detail?.variants ?? detail?.variantList ?? detail?.productVariants ?? [];
          const pricedVariants = variants.filter((variant) => finitePositivePrice(variant?.variantSellPrice, variant?.sellPrice, variant?.price) != null);
          const preferred = data.preferredVariantId
            ? pricedVariants.find((variant) => String(variant?.vid) === String(data.preferredVariantId))
            : null;
          const first = preferred || pricedVariants[0] || variants[0];
          const vid = first?.vid || detail?.vid || null;
          const itemCost = finitePositivePrice(first?.variantSellPrice, first?.sellPrice, first?.price, detail?.sellPrice);
          if (itemCost == null) throw new Error("CJ did not return a valid price for any variant");

          const startCountry = (
            filterStockCountry
            || String(detail?.countryCode || detail?.countryFrom || detail?.sourceFrom || "").trim().toUpperCase()
            || "CN"
          ).slice(0, 2);

          // Freight is best-effort: free-shipping items return nothing/0 from CJ,
          // and some products expose no quotable variant. Never fail the draft
          // for that — fall back to a caller-supplied quote or $0 shipping.
          const overrideShipping = Number(data.shippingOverride);
          const hasOverride = Number.isFinite(overrideShipping) && overrideShipping >= 0;
          let shipping = hasOverride ? overrideShipping : 0;
          let carrierName: string | null = hasOverride ? (data.carrierOverride ?? null) : null;
          let carrierDays: string | null = null;
          if (!hasOverride) {
            if (!vid) {
              notes.push("No quotable CJ variant — shipping treated as free ($0).");
            } else {
              try {
                const options = await cjFreightCalculate({ startCountryCode: startCountry, endCountryCode: endCountry, products: [{ vid, quantity: 1 }] }, token);
                const validOptions = (options || []).filter((option) => {
                  const price = Number(option?.logisticPrice);
                  return Number.isFinite(price) && price >= 0;
                });
                if (validOptions.length === 0) {
                  notes.push("CJ returned no logistics quote — shipping treated as free ($0).");
                } else {
                  const fourToSevenDays = validOptions.filter((option) => {
                    const days = String(option?.logisticAging || "").match(/\d+/g)?.map(Number) || [];
                    return days.some((day) => day >= 4 && day <= 7);
                  });
                  const carrier = [...(fourToSevenDays.length ? fourToSevenDays : validOptions)]
                    .sort((a, b) => Number(a.logisticPrice) - Number(b.logisticPrice))[0];
                  shipping = Number(carrier.logisticPrice) || 0;
                  carrierName = carrier.logisticName || null;
                  carrierDays = carrier.logisticAging || null;
                }
              } catch (freightError) {
                notes.push(`Freight quote failed (${freightError instanceof Error ? freightError.message : String(freightError)}) — shipping treated as free ($0).`);
              }
            }
          }
          const pricing = calculateRulePrice(itemCost, shipping, rule || {});

          const cjCategoryName = detail?.categoryName || null;
          const title = stripBanAmazon(String(detail?.productNameEn || "")).slice(0, 80);
          const images = [detail?.bigImage, detail?.productImage, ...(detail?.productImageSet || [])].filter(Boolean).slice(0, 12);

          // Auto-suggest eBay category so drafts are ready to push.
          let categoryId: string | null = null;
          let categoryPath: string | null = null;
          if (ebayToken) {
            try {
              // Deterministic deep scan (no AI): tries progressive queries and
              // applies automotive filtering when applicable.
              const rows = await deepScanEbayCategory(ebayToken, { title, cjCategoryName });
              const pick = rows[0];
              if (pick) { categoryId = pick.categoryId; categoryPath = pick.path; }
            } catch { /* leave blank; user can pick manually */ }
          }

          const assignedAccountId = routeAccount(cjCategoryName);
          const allVariantRows = (variants.length ? variants : [first]).map((variant: any, index: number) => {
            const variantCost = finitePositivePrice(variant?.variantSellPrice, variant?.sellPrice, variant?.price, itemCost) ?? itemCost;
            const variantPricing = calculateRulePrice(variantCost, shipping, rule || {});
            return {
              vid: variant?.vid || vid,
              variantSku: variant?.variantSku || variant?.sku || variant?.vid || `${detail?.productSku || pid}-${index + 1}`,
              variantKey: variant?.variantKey || variant?.variantNameEn || variant?.variantSku || variant?.vid || `Option ${index + 1}`,
              variantNameEn: variant?.variantNameEn,
              variantImage: variant?.variantImage || images[0] || null,
              variantSellPrice: variantCost,
              price: variantPricing.sellPrice,
              inventory: Number.isFinite(Number(variant?.inventory)) ? Number(variant.inventory) : null,
            };
          });
          const row = {
            user_id: context.userId,
            account_id: assignedAccountId,
            cj_product_id: pid,
            cj_variant_id: vid || null,
            sku: first?.variantSku || detail?.productSku || pid,
            title,
            price: pricing.sellPrice,
            quantity: targetQty,
            images,
            description: stripBanAmazon(detail?.description ?? ""),
            status: "pending" as const,
            category_id: categoryId,
            item_specifics: { Brand: "Unbranded", Condition: "New" },

            profit: {
              item_cost: pricing.itemCost,
              shipping: pricing.shipping,
              carrier: carrierName,
              carrier_days: carrierDays,
              markup_pct: Number(rule?.markup_percent ?? 50),
              min_profit_usd: Number(rule?.min_profit_usd ?? 0),
              ebay_fee_pct: Number(rule?.ebay_fee_buffer_percent ?? 17) / 100,
              payment_fee_pct: Number(rule?.payment_fee_buffer_percent ?? 0) / 100,
              ebay_fee: pricing.ebayFee,
              payment_fee: pricing.paymentFee,
              profit: pricing.projectedProfit,
              desired_profit: pricing.targetProfit,
              end_country: endCountry,
              start_country: startCountry,

              product_key: detail?.productKeyEn || null,
              cj_category_name: cjCategoryName,
              ebay_category_path: categoryPath,
              auto_quoted: true,
              variant_group: allVariantRows.length > 1 ? { variants: allVariantRows } : null,
            },
          };
          const { data: saved, error: saveError } = await context.supabase
            .from("listing_drafts")
            .upsert(row, { onConflict: "user_id,cj_product_id", ignoreDuplicates: false })
            .select("id")
            .maybeSingle();
          if (saveError) throw new Error(`Draft save failed: ${saveError.message}`);
          if (notes.length) {
            await context.supabase.from("activity_logs").insert({
              user_id: context.userId,
              account_id: assignedAccountId,
              level: "warn",
              category: "cj",
              message: `Draft created with shipping fallback: ${title}`,
              metadata: { pid, draftId: saved?.id, notes, shipping, startCountry, endCountry, variantCount: variants.length, vid },
            });
          }
          return { pid, ok: true, carrier: carrierName || undefined, shipping: Number(shipping.toFixed(2)), draftId: saved?.id, categoryId, accountId: assignedAccountId, notes };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          try {
            await context.supabase.from("activity_logs").insert({
              user_id: context.userId,
              level: "error",
              category: "cj",
              message: `Send to drafts failed: ${pid}`,
              metadata: { pid, error: message, notes, endCountry, stockCountry: filterStockCountry },
            });
          } catch { /* logging must never mask the original failure */ }
          return { pid, ok: false, error: message, notes };
        }

      }));
      results.push(...done);
    }
    return { total: pids.length, ok: results.filter((r) => r.ok).length, results };
  });
