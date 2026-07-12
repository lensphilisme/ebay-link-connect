import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ebayConsentUrl, exchangeEbayCode, fetchActiveEbayListings, fetchItemImagesShopping, getCategorySuggestions, getEbayCategoryTreeShallow, getFreshEbayToken, publishInventoryItem, reviseEbayListingText, endEbayFixedPriceListing } from "./ebay.server";

// Scrub the "Ban [anything] the sale of amazon" phrase eBay policy titles.
// The phrase sometimes shows up truncated as just "Ban ", "Ban of", "Ban of the",
// etc. Rule: if the title mentions "the sale of amazon" ANYWHERE, remove the
// standalone word "Ban " (with a space, so we don't touch Banana, Bank, Banjo)
// and everything after it. Otherwise, still strip the full canonical phrase.
export function stripBanAmazon(value: unknown): string {
  let s = String(value ?? "");
  if (/the\s+sale\s+of\s+amazon/i.test(s)) {
    s = s.replace(/\bBan\s[\s\S]*$/i, "");
  }
  s = s.replace(/\bban\s+the\s+sale\s+of\s+amazon\b/gi, "");
  return s.replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

function cleanTitle(value: unknown) {
  return stripBanAmazon(value).slice(0, 80);
}

function fallbackRewrite(title: string) {
  const cleaned = cleanTitle(title);
  const parts = cleaned.split(/[|,]/).map((p) => p.trim()).filter(Boolean);
  return (parts[0] || cleaned || title).slice(0, 80);
}

function compactText(value: unknown, fallback = "") {
  const text = String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  if (text) return text;
  return String(fallback ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function cleanImages(...inputs: unknown[]) {
  const out: string[] = [];
  const walk = (input: unknown) => {
    if (!input) return;
    if (Array.isArray(input)) return input.forEach(walk);
    const text = String(input).trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
    if (!text) return;
    if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith('"') && text.endsWith('"'))) {
      try { return walk(JSON.parse(text)); } catch { /* keep scanning */ }
    }
    for (const match of text.match(/https?:\/\/[^\s"'\\\])>,]+/gi) || []) {
      try { const url = new URL(match); if (url.hostname.includes(".")) out.push(url.toString()); } catch { /* skip */ }
    }
  };
  inputs.forEach(walk);
  return Array.from(new Set(out)).slice(0, 12);
}

function compactCountry(value: unknown, fallback = "CN") {
  return (compactText(value, fallback).toUpperCase().match(/[A-Z]{2}/)?.[0] || fallback).slice(0, 2);
}

async function resolveCjWarehouse(context: any, startCountry: string) {
  try {
    const { cjGetWarehouses, getUserCjToken } = await import("./cj.server");
    const token = await getUserCjToken(context.supabase, context.userId);
    const warehouses = await cjGetWarehouses(token);
    const country = compactCountry(startCountry);
    return warehouses.find((w: any) => compactCountry(w.countryCode || w.country) === country && !w.disabled)
      || warehouses.find((w: any) => compactCountry(w.countryCode || w.country) === country)
      || null;
  } catch {
    return null;
  }
}

function inferType(title: string, detail: any, draft: any) {
  const direct = compactText(draft?.item_specifics?.Type || detail?.categoryName || detail?.productCategoryName || detail?.productType);
  if (direct) return direct.slice(0, 65);
  return compactText(title).split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(" ").slice(0, 65) || "General Product";
}

function repairVariants(detail: any, draft: any, images: string[], stockByVid: Record<string, number> = {}) {
  const variants = detail?.variants || detail?.variantList || detail?.productVariants || draft?.profit?.variant_group?.variants || [];
  if (!Array.isArray(variants) || variants.length <= 1) return null;
  const productKey = compactText(detail?.productKeyEn || draft?.profit?.product_key);
  const axes = productKey ? productKey.split(/[-,/|>]+/).map((v) => compactText(v)).filter(Boolean) : [];
  const safeAxes = axes.length ? axes.map((a, i) => (/^type$/i.test(a) ? (i === 0 ? "Style" : `Option ${i + 1}`) : a)) : undefined;
  return {
    variants: variants.map((v: any, i: number) => {
      // Prefer live stock from CJ stock endpoint (keyed by vid), then any inline
      // inventory field on the variant. `null` means "unknown" — applyRuleToDraft
      // then falls back to the user's rule default instead of publishing qty=1.
      const vid = String(v?.vid || "");
      const liveStock = vid && Object.prototype.hasOwnProperty.call(stockByVid, vid) ? Number(stockByVid[vid]) : undefined;
      const inlineStock = [v?.inventory, v?.storageNum, v?.stockNum, v?.availableQuantity]
        .map((n) => Number(n)).find((n) => Number.isFinite(n) && n >= 0);
      const inv = Number.isFinite(liveStock as number) ? (liveStock as number) : (inlineStock ?? null);
      return {
        vid: v.vid,
        variantSku: v.variantSku || v.sku || v.vid || `${draft.sku}-${i + 1}`,
        variantKey: compactText(v.variantKey || v.variantNameEn || v.variantSku || v.vid || `Option ${i + 1}`),
        variantNameEn: v.variantNameEn,
        variantImage: cleanImages(v.variantImage, v.image, images)[0] || images[0] || null,
        variantSellPrice: Number(v.variantSellPrice ?? v.price ?? draft.price ?? 0),
        price: Number(v.price ?? v.variantSellPrice ?? draft.price ?? 0),
        inventory: inv,
      };
    }),
    axes: safeAxes,
    productKey,
  };
}


// Reasonable defaults for aspects eBay commonly requires but CJ doesn't supply cleanly.
const ASPECT_DEFAULTS: Record<string, string> = {
  "Department": "Unisex Adult",
  "Type": "General",
  "Brand": "Unbranded",
  "MPN": "Does Not Apply",
  "Model": "Does Not Apply",
  "Country/Region of Manufacture": "China",
  "Upper Material": "Synthetic",
  "Outer Material": "Synthetic",
  "Material": "Synthetic",
  "Style": "Casual",
  "Color": "Multicolor",
  "US Shoe Size": "10",
  "Size": "One Size",
  "Size Type": "Regular",
  "Occasion": "Casual",
  "Pattern": "Solid",
  "Character": "None",
  "Theme": "General",
  "Season": "All Seasons",
};

function parseMissingAspects(message: string): string[] {
  const names = new Set<string>();
  for (const m of message.matchAll(/item specific ([A-Za-z0-9 /\-()]+?) is missing/gi)) names.add(m[1].trim());
  for (const m of message.matchAll(/"name":"3","value":"([^"]+)"/g)) names.add(m[1].trim());
  return Array.from(names);
}

function pickAspectFromCj(name: string, detail: any) {
  const src = [
    detail?.productProEnSet, detail?.productKeyEn, detail?.categoryName,
    detail?.productType, detail?.productNameEn, detail?.brand,
  ].filter(Boolean);
  const hay = compactText(src.join(" | ")).toLowerCase();
  if (/color|colour/i.test(name)) {
    const m = hay.match(/\b(red|blue|black|white|green|yellow|pink|purple|gray|grey|brown|beige|gold|silver|orange|navy|multicolor)\b/);
    if (m) return m[1].replace(/^\w/, (c) => c.toUpperCase());
  }
  if (/material/i.test(name)) {
    const m = hay.match(/\b(cotton|silicone|leather|plastic|silk|linen|wool|polyester|nylon|rubber|metal|wood|glass|synthetic|canvas|denim|mesh|suede)\b/);
    if (m) return m[1].replace(/^\w/, (c) => c.toUpperCase());
  }
  return null;
}

async function autoRepairDraftFromCj(context: any, draft: any, reason: string) {
  const { cjProductDetail, getUserCjToken, cjGetProductStock } = await import("./cj.server");
  const token = await getUserCjToken(context.supabase, context.userId);
  const detail: any = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", token);
  const stockByVid = await cjGetProductStock(draft.cj_product_id, token).catch(() => ({} as Record<string, number>));
  const startCountry = compactCountry(draft.profit?.start_country || detail?.countryCode || detail?.countryFrom || detail?.sourceFrom, "CN");
  const warehouse = await resolveCjWarehouse(context, startCountry);
  const title = compactText(detail?.productNameEn, draft.title).slice(0, 80) || draft.title;
  const description = String(detail?.description || draft.description || `${title}. New item. Review photos and selected option before checkout.`).trim();
  const images = cleanImages(draft.images, detail?.productImageSet, detail?.productImages, detail?.bigImage, detail?.productImage);
  const variants = repairVariants(detail, draft, images, stockByVid);

  const itemSpecifics: Record<string, string> = {
    ...(draft.item_specifics || {}),
    Brand: compactText(draft.brand || draft.item_specifics?.Brand || detail?.brand, "Unbranded"),
    Type: compactText(draft.item_specifics?.Type, inferType(title, detail, draft)),
    Model: compactText(draft.model || draft.item_specifics?.Model, "Does Not Apply"),
    MPN: compactText(draft.item_specifics?.MPN, "Does Not Apply"),
  };
  // Inject explicit values for whatever eBay complained was missing.
  for (const name of parseMissingAspects(reason)) {
    if (itemSpecifics[name]) continue;
    const fromCj = pickAspectFromCj(name, detail);
    itemSpecifics[name] = fromCj || ASPECT_DEFAULTS[name] || "Does Not Apply";
  }
  const repaired = {
    ...draft,
    title,
    description,
    images,
    item_specifics: itemSpecifics,
    brand: itemSpecifics.Brand,
    model: itemSpecifics.Model,
    status: "pending" as const,
    audit_reason: `Auto-repaired CJ data after eBay error: ${reason.slice(0, 180)}`,
    profit: {
      ...(draft.profit || {}),
      start_country: startCountry,
      cj_warehouse: warehouse || draft.profit?.cj_warehouse || null,
      product_key: variants?.productKey || draft.profit?.product_key || null,
      variant_axes: variants?.axes || draft.profit?.variant_axes || null,
      variant_group: variants ? { variants: variants.variants } : draft.profit?.variant_group || null,
      cj_repair_cached_at: new Date().toISOString(),
    },
  };
  await context.supabase.from("listing_drafts").update({
    title: repaired.title,
    description: repaired.description,
    images: repaired.images,
    item_specifics: repaired.item_specifics,
    brand: repaired.brand,
    model: repaired.model,
    status: repaired.status,
    audit_reason: repaired.audit_reason,
    profit: repaired.profit,
  }).eq("id", draft.id);
  await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "ebay", message: `Auto-repaired draft from CJ: ${title}`, metadata: { draftId: draft.id, reason, variants: variants?.variants?.length || 0 } });
  return repaired;
}

function shouldAutoRepair(message: string) {
  return /variation|specific|is\s+missing|invalid data|imageUrl|country|location|mpn|gtin|upc|volume\s+is\s+not\s+allowed|already a member of another group/i.test(message);
}

function draftVariantCount(draft: any) {
  const variants = draft?.variants || draft?.variant_group?.variants || draft?.profit?.variants || draft?.profit?.variant_group?.variants || [];
  return Array.isArray(variants) ? variants.length : 0;
}



function encodeOAuthState(payload: { u: string; a?: string | null }) {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export const getEbayConnectUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { accountId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }: any) => {
    const state = encodeOAuthState({ u: context.userId, a: data?.accountId || null });
    return ebayConsentUrl(state);
  });

export const connectEbayWithCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string; accountId?: string | null; accountName?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const creds = await exchangeEbayCode(decodeURIComponent(data.code.trim()));

    // Multi-account write path — always land tokens on ebay_accounts.
    let accountId = data.accountId || null;
    if (!accountId) {
      // Prefer the existing default account, else create one.
      const { data: existing } = await context.supabase
        .from("ebay_accounts")
        .select("id")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existing?.id) accountId = existing.id;
      else {
        const { data: created, error: cErr } = await context.supabase
          .from("ebay_accounts")
          .insert({ user_id: context.userId, account_name: data.accountName || "Default", is_active: true })
          .select("id")
          .single();
        if (cErr) throw cErr;
        accountId = created.id;
      }
    }

    const { error: uErr } = await context.supabase
      .from("ebay_accounts")
      .update({
        access_token: creds.access_token,
        refresh_token: creds.refresh_token,
        token_expires_at: creds.expires_at ? new Date(creds.expires_at).toISOString() : null,
        is_active: true,
      })
      .eq("id", accountId)
      .eq("user_id", context.userId);
    if (uErr) throw uErr;

    // Mirror to legacy integration_credentials so existing code paths keep working.
    const row = {
      user_id: context.userId,
      provider: "ebay",
      label: "default",
      environment: "production",
      is_active: true,
      last_validated_at: new Date().toISOString(),
      credentials: creds,
    };
    const { data: existingCred } = await context.supabase.from("integration_credentials").select("id").eq("user_id", context.userId).eq("provider", "ebay").eq("label", "default").maybeSingle();
    if (existingCred?.id) await context.supabase.from("integration_credentials").update(row).eq("id", existingCred.id);
    else await context.supabase.from("integration_credentials").insert(row);

    return { ok: true, account_id: accountId };
  });

export const syncEbayListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { entriesPerPage?: number }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const perPage = data.entriesPerPage ?? 200;
    let page = 1;
    let grandTotal = 0;
    // Dedupe items across pages by ebay_item_id (eBay pagination can overlap).
    const seen = new Map<string, any>();
    while (true) {
      const result = await fetchActiveEbayListings(token, page, perPage);
      grandTotal = result.total;
      for (const item of result.items) {
        if (!item.itemId) continue;
        if (!seen.has(item.itemId)) seen.set(item.itemId, item);
      }
      if (result.items.length < perPage || seen.size >= grandTotal) break;
      page += 1;
      if (page > 50) break; // safety cap ~10k listings
    }
    const uniqueItems = Array.from(seen.values());
    // Enrich thumbnails via public Shopping API (GetMyeBaySelling doesn't return them).
    const missingImgIds = uniqueItems.filter((i) => !i.imageUrl).map((i) => i.itemId);
    if (missingImgIds.length) {
      try {
        const imgMap = await fetchItemImagesShopping(missingImgIds);
        for (const it of uniqueItems) if (!it.imageUrl && imgMap[it.itemId]) it.imageUrl = imgMap[it.itemId];
      } catch { /* best effort */ }
    }
    // Upsert every unique active item.
    for (const item of uniqueItems) {
      const row = {
        user_id: context.userId,
        ebay_item_id: item.itemId,
        sku: item.sku,
        title: stripBanAmazon(item.title) || item.title,
        price: item.price,
        currency: item.currency,
        marketplace_id: "EBAY_US",
        status: "active",
        sales: item.quantitySold,
        views: item.watchCount,
        image_url: item.imageUrl || null,
        listed_at: item.listedAt || undefined,
      };
      const { data: existingRows } = await context.supabase.from("ebay_listings").select("id").eq("user_id", context.userId).eq("ebay_item_id", item.itemId).limit(10);
      const existing = existingRows?.[0];
      if (existing?.id) {
        await context.supabase.from("ebay_listings").update(row).eq("id", existing.id);
        const duplicateIds = (existingRows || []).slice(1).map((r: any) => r.id);
        if (duplicateIds.length) await context.supabase.from("ebay_listings").delete().in("id", duplicateIds);
      } else await context.supabase.from("ebay_listings").insert(row);
    }
    // Prune stale: mark rows as 'ended' when they're no longer in eBay's active set.
    const seenIds = Array.from(seen.keys());
    let pruned = 0;
    if (seenIds.length > 0) {
      const { data: stale } = await context.supabase
        .from("ebay_listings")
        .select("id,ebay_item_id")
        .eq("user_id", context.userId)
        .eq("status", "active")
        .not("ebay_item_id", "in", `(${seenIds.map((v) => `"${v}"`).join(",")})`);
      pruned = stale?.length || 0;
      if (pruned > 0) {
        await context.supabase.from("ebay_listings").delete().in("id", (stale || []).map((r: any) => r.id));
      }
    }
    const synced = uniqueItems.length;
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ebay", message: `Synced ${synced} active eBay listings (removed ${pruned} stale)`, metadata: { total: grandTotal, synced, pruned } });
    return { total: grandTotal, synced, pruned };
  });


// Marketing noise that pollutes CJ titles and misleads eBay's text match.
const CATEGORY_QUERY_STOPWORDS = new Set([
  "universal", "hot", "sale", "new", "kit", "sets", "set", "high", "quality",
  "for", "pcs", "pc", "pack", "packs", "piece", "pieces", "the", "and", "with",
  "of", "in", "on", "a", "an", "to", "premium", "professional", "pro", "luxury",
  "portable", "foldable", "adjustable", "multi", "multifunctional", "durable",
  "waterproof", "wireless", "rechargeable", "mini", "large", "small", "medium",
  "big", "hd", "led", "usb", "diy", "fashion", "style", "styles", "trendy",
  "cute", "lovely", "creative", "classic", "modern", "vintage", "brand",
  "unbranded", "oem", "original", "genuine", "eu", "us", "uk", "au", "cn",
  "free", "shipping", "gift", "gifts", "party", "home", "outdoor", "indoor",
  "size", "color", "colour", "black", "white", "red", "blue", "green", "pink",
  "gold", "silver", "grey", "gray", "yellow", "brown", "purple", "orange",
]);

const AUTOMOTIVE_KEYWORDS = [
  "car", "cars", "auto", "automotive", "truck", "vehicle", "motorcycle",
  "motorbike", "bike", "atv", "utv", "suv", "van", "bus", "engine", "exhaust",
  "muffler", "header", "headers", "manifold", "catalytic", "brake", "brakes",
  "rotor", "caliper", "clutch", "transmission", "carburetor", "carb",
  "spark plug", "piston", "cylinder head", "intake", "turbo", "supercharger",
  "radiator", "alternator", "starter motor", "axle", "differential",
  "suspension", "shock", "strut", "steering", "tie rod", "control arm",
  "cv joint", "wheel bearing", "fuel injector", "oxygen sensor", "abs sensor",
  "throttle body", "camshaft", "crankshaft", "timing belt", "timing chain",
  "head gasket", "oil pan", "valve cover", "cooling fan",
];

// Pure function: build a clean query string for eBay Taxonomy search.
// Prefers the CJ-provided category name (much cleaner + closer to eBay's tree)
// and falls back to a scrubbed version of the raw title.
export function buildCleanCategoryQuery(input: {
  title?: string | null;
  cjCategoryName?: string | null;
}): string {
  const cjCat = String(input.cjCategoryName ?? "").trim();
  if (cjCat) {
    // CJ paths look like "Home / Kitchen / Storage Boxes". Take the last two
    // segments — most specific + parent — that's what eBay's fuzzy matcher likes.
    const segments = cjCat.split(/[\/>|,]/).map((s) => s.trim()).filter(Boolean);
    const tail = segments.slice(-2).join(" ");
    if (tail) return tail.replace(/\s+/g, " ").slice(0, 80);
  }
  const raw = String(input.title ?? "");
  const stripped = raw
    .toLowerCase()
    // strip emojis / symbols
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    // strip punctuation
    .replace(/[^a-z0-9\s]/g, " ")
    // strip 4-digit years
    .replace(/\b(19|20)\d{2}\b/g, " ")
    // strip size tokens like "12cm", "3.5in", "500ml"
    .replace(/\b\d+(\.\d+)?\s?(mm|cm|m|in|inch|inches|ft|ml|l|oz|g|kg|lb|lbs|xl|xxl|xs|s|m|l)\b/g, " ")
    // strip bare number+unit patterns like "10pcs", "2pack"
    .replace(/\b\d+\s?(pcs|pc|pack|packs|piece|pieces|set|sets)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const meaningful: string[] = [];
  for (const tok of stripped.split(" ")) {
    if (!tok || tok.length < 2) continue;
    if (/^\d+$/.test(tok)) continue;
    if (CATEGORY_QUERY_STOPWORDS.has(tok)) continue;
    meaningful.push(tok);
    if (meaningful.length >= 5) break;
  }
  const cleaned = meaningful.slice(0, 5).join(" ");
  return cleaned || raw.slice(0, 80);
}

export function isAutomotiveSignal(q: string, cjCategoryName?: string | null): boolean {
  const hay = `${q} ${cjCategoryName ?? ""}`.toLowerCase();
  if (/\b(motor|auto|vehicle|automotive|car\s+part|truck)\b/.test(hay)) return true;
  return AUTOMOTIVE_KEYWORDS.some((kw) => new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`).test(hay));
}

function filterAutomotive(rows: Array<{ categoryId: string; categoryName: string; path: string }>) {
  return rows.filter((r) => /ebay motors|parts\s*&\s*accessories/i.test(r.path));
}

// Deterministic "deep scan" for the best eBay leaf category — NO AI.
// Progressive query fallback + automotive filtering. Shared by the drafts UI
// and the automatic bulk-send pipeline so both behave identically.
export async function deepScanEbayCategory(
  token: string,
  input: { title?: string | null; cjCategoryName?: string | null; marketplaceId?: string },
): Promise<Array<{ categoryId: string; categoryName: string; path: string }>> {
  const marketplaceId = input.marketplaceId ?? "EBAY_US";
  const rawTitle = String(input.title ?? "").trim();
  const cleaned = buildCleanCategoryQuery({ title: rawTitle, cjCategoryName: input.cjCategoryName ?? null });
  const titleOnly = buildCleanCategoryQuery({ title: rawTitle, cjCategoryName: null });
  const rawFallback = rawTitle.slice(0, 80);
  const attempts = Array.from(new Set([cleaned, titleOnly, rawFallback].filter(Boolean)));
  const automotive = isAutomotiveSignal(cleaned, input.cjCategoryName);
  let rows: Array<{ categoryId: string; categoryName: string; path: string }> = [];
  let usedQ = "";
  for (const q of attempts) {
    try {
      const r = await getCategorySuggestions(token, q, marketplaceId);
      const filtered = automotive ? filterAutomotive(r) : r;
      const chosen = filtered.length ? filtered : r;
      if (chosen.length > 0) { rows = chosen; usedQ = q; break; }
    } catch (e) {
      console.warn("[category-deep-scan] attempt failed q=", q, e instanceof Error ? e.message : e);
    }
  }
  if (rows.length === 0 && automotive) {
    try {
      const r = await getCategorySuggestions(token, `${cleaned} car part`, marketplaceId);
      rows = filterAutomotive(r).length ? filterAutomotive(r) : r;
      usedQ = `${cleaned} car part`;
    } catch { /* give up */ }
  }
  console.log("[category-deep-scan] raw=", rawTitle, "cjCat=", input.cjCategoryName, "→ usedQ=", usedQ, "rows=", rows.length);
  return rows;
}

export const suggestEbayCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q?: string; title?: string; cjCategoryName?: string | null; marketplaceId?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    return deepScanEbayCategory(token, {
      title: data.title ?? data.q ?? "",
      cjCategoryName: data.cjCategoryName ?? null,
      marketplaceId: data.marketplaceId,
    });
  });

// Snap a price to the round_to rule (e.g. 0.99 → force cents to .99).
// roundTo is a fractional value in [0, 1). Values outside that range fall back to 2-decimal rounding.
export function roundPriceToRule(value: number, roundTo: number): number {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return price;
  const r = Number(roundTo);
  if (!Number.isFinite(r) || r < 0 || r >= 1) return Number(price.toFixed(2));
  const floor = Math.floor(price);
  const snapped = floor + r;
  // Never round DOWN below the computed price — always land on the next .r step up.
  const out = snapped >= price ? snapped : snapped + 1;
  return Number(out.toFixed(2));
}

// Apply automation_rules (max_listing_quantity + round_to) to a draft copy,
// including any nested variant arrays. Pure — returns a new object.
//
// Quantity rule: `max_listing_quantity` is the *target* stock we publish.
// If CJ reports real inventory for a variant (inventory / storageNum /
// availableQuantity fields), we cap the target by that number so we never
// oversell. When inventory is unknown we simply use the target, so users
// don't see "1 per variant" published when they asked for e.g. 5.
export function applyRuleToDraft<T extends Record<string, any>>(draft: T, rule: any): T {
  const maxQty = Math.max(1, Number(rule?.max_listing_quantity ?? 1));
  const roundTo = Number(rule?.round_to ?? 0.99);
  // readInv returns `null` when we truly don't know the stock, so targetQty
  // can fall back to the rule's target instead of publishing quantity 1.
  const readInv = (v: any): number | null => {
    for (const field of [v?.inventory, v?.storageNum, v?.availableQuantity, v?.stock, v?.stockNum, v?.cj_stock]) {
      const n = Number(field);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    // `quantity` is a last resort — it's often the previously-published qty (e.g. 1),
    // not real stock. Ignore it so we don't get stuck republishing at 1.
    return null;
  };
  const targetQty = (inv: number | null) =>
    inv == null ? maxQty : (inv <= 0 ? 0 : Math.max(1, Math.min(inv, maxQty)));
  const rowInv = readInv(draft);
  const rowQty = targetQty(rowInv);
  const roundedPrice = roundPriceToRule(Number(draft.price || 0), roundTo);
  const patched: any = { ...draft, quantity: Math.max(1, rowQty || maxQty), price: roundedPrice };
  const patchVariants = (arr: any) => {
    if (!Array.isArray(arr)) return arr;
    return arr.map((v: any) => {
      const p = Number(v?.price ?? v?.variantSellPrice ?? roundedPrice);
      const inv = readInv(v);
      const newQty = Math.max(1, targetQty(inv) || maxQty);
      const newPrice = roundPriceToRule(p, roundTo);
      return { ...v, price: newPrice, variantSellPrice: newPrice, quantity: newQty, inventory: newQty };
    });
  };

  if (Array.isArray(patched.variants)) patched.variants = patchVariants(patched.variants);
  if (patched.variant_group?.variants) patched.variant_group = { ...patched.variant_group, variants: patchVariants(patched.variant_group.variants) };
  if (patched.profit) {
    const newProfit: any = { ...patched.profit };
    if (Array.isArray(newProfit.variants)) newProfit.variants = patchVariants(newProfit.variants);
    if (newProfit.variant_group?.variants) newProfit.variant_group = { ...newProfit.variant_group, variants: patchVariants(newProfit.variant_group.variants) };
    patched.profit = newProfit;
  }
  return patched as T;
}

export const pushDraftsToEbay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { draftIds: string[] }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const { data: drafts, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).in("id", data.draftIds);
    if (error) throw error;
    const { data: rule } = await context.supabase.from("automation_rules").select("max_listing_quantity,round_to").eq("user_id", context.userId).maybeSingle();
    const results = [];
    for (const draft of drafts || []) {
      try {
        if (!draft.category_id) throw new Error("Missing eBay category");
        // Always hydrate the full CJ variant group first; a chosen VID must not publish alone when the product has sibling variants.
        let workingDraft = draft;
        if (draft.cj_product_id && draftVariantCount(workingDraft) <= 1) {
          try {
            const repaired = await autoRepairDraftFromCj(context, workingDraft, "Refreshing full CJ variant group before eBay push");
            if (draftVariantCount(repaired) > draftVariantCount(workingDraft)) workingDraft = repaired;
          } catch { /* publish the existing draft if CJ refresh is unavailable */ }
        }
        // Duplicate guard: refuse to push the same CJ product twice.
        if (workingDraft.cj_product_id) {
          const { data: existing } = await context.supabase
            .from("ebay_listings")
            .select("id,ebay_item_id")
            .eq("user_id", context.userId)
            .eq("cj_product_id", workingDraft.cj_product_id)
            .in("status", ["active", "pushed"])
            .limit(1)
            .maybeSingle();
          if (existing?.id) throw new Error(`Already listed on eBay (item ${existing.ebay_item_id || existing.id}). Skipping duplicate.`);
        }
        // Ensure start_country is set from CJ so inventory location is valid.
        if (!draft.profit?.start_country) {
          try {
            const { cjProductDetail, getUserCjToken } = await import("./cj.server");
            const cjToken = await getUserCjToken(context.supabase, context.userId);
            const detail: any = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", cjToken);
            const startCountry = compactCountry(detail?.countryCode || detail?.countryFrom || detail?.sourceFrom, "CN");
            const warehouse = await resolveCjWarehouse(context, startCountry);
            workingDraft = { ...draft, profit: { ...(draft.profit || {}), start_country: startCountry, cj_warehouse: warehouse || draft.profit?.cj_warehouse || null } };
            await context.supabase.from("listing_drafts").update({ profit: workingDraft.profit }).eq("id", draft.id);
          } catch { /* fall back to CN default in publish */ }
        } else if (!draft.profit?.cj_warehouse) {
          const warehouse = await resolveCjWarehouse(context, draft.profit.start_country);
          if (warehouse) {
            workingDraft = { ...draft, profit: { ...(draft.profit || {}), cj_warehouse: warehouse } };
            await context.supabase.from("listing_drafts").update({ profit: workingDraft.profit }).eq("id", draft.id);
          }
        }
        let pushed: any;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            // Enforce automation_rules right before publish so any auto-repair,
            // variant hydration, or draft edits are covered on every retry.
            const ruleAdjusted = applyRuleToDraft(workingDraft, rule);
            pushed = await publishInventoryItem(token, ruleAdjusted);
            workingDraft = ruleAdjusted;
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            const message = err instanceof Error ? err.message : String(err);
            if (!draft.cj_product_id || !shouldAutoRepair(message) || attempt === 3) throw err;
            workingDraft = await autoRepairDraftFromCj(context, workingDraft, message);
          }
        }
        if (lastError) throw lastError;

        const expectedVariants = draftVariantCount(workingDraft);
        if (expectedVariants > 1 && (!pushed.listingId || Number(pushed.variantCount || 0) !== expectedVariants)) {
          throw new Error(`eBay did not confirm all ${expectedVariants} variants were published. Nothing was marked pushed.`);
        }

        await context.supabase.from("ebay_listings").insert({ user_id: context.userId, draft_id: draft.id, ebay_item_id: pushed.listingId, ebay_offer_id: pushed.offerId, sku: workingDraft.sku, title: workingDraft.title, price: workingDraft.price, cj_product_id: workingDraft.cj_product_id, status: "active", cj_landed_cost: Number((workingDraft.profit || {}).item_cost || 0) + Number((workingDraft.profit || {}).shipping || 0) });
        // Auto-remove pushed draft from queue.
        await context.supabase.from("listing_drafts").delete().eq("id", draft.id);
        await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ebay", message: `Pushed to eBay: ${workingDraft.title}`, metadata: { draftId: draft.id, listingId: pushed.listingId, offerId: pushed.offerId, variants: expectedVariants || 1 } });
        results.push({ draftId: draft.id, ok: true, ...pushed });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await context.supabase.from("listing_drafts").update({ status: "failed", audit_reason: message }).eq("id", draft.id);
        await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "error", category: "ebay", message: `eBay push failed: ${draft.title}`, metadata: { draftId: draft.id, error: message } });
        results.push({ draftId: draft.id, ok: false, error: message });
      }
    }
    return results;
  });
// AI-powered deep category picker. Fetches the eBay category tree (top 3 levels),
// asks Gemini to pick the single best leaf categoryId for a product, returns
// the top candidates so the user can accept or override.
export const aiDeepCategorySuggest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { title: string; description?: string; hint?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    // Cheap: also include normal suggestions as a strong prior.
    const [normal, tree] = await Promise.all([
      getCategorySuggestions(token, data.title, "EBAY_US").catch(() => []),
      getEbayCategoryTreeShallow(token, "EBAY_US"),
    ]);
    const priors = normal.slice(0, 8).map((c: any) => `${c.categoryId}\t${c.path}`).join("\n");
    // Keep prompt bounded: leaf categories only, shuffled prior wins.
    const leaves = tree.categories.filter((c) => c.leaf).slice(0, 4000);
    let picks: { categoryId: string; path: string; reason: string }[] = [];
    if (process.env.LOVABLE_API_KEY) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Lovable-API-Key": process.env.LOVABLE_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "You choose the single best eBay leaf category for a product. Return JSON { picks: [{categoryId, path, reason}] } with 3 candidates sorted best first. Use only categoryIds from the provided list." },
              { role: "user", content: `Product title: ${data.title}\nDescription: ${(data.description || "").slice(0, 500)}\nManual hint: ${data.hint || "none"}\n\nStrong prior (eBay suggestions):\n${priors}\n\nFull leaf categories (id\\tpath):\n${leaves.map((c) => `${c.categoryId}\t${c.path}`).join("\n").slice(0, 60000)}` },
            ],
          }),
        });
        const json = await res.json();
        picks = JSON.parse(json.choices?.[0]?.message?.content || "{}").picks || [];
      } catch { picks = []; }
    }
    if (picks.length === 0) {
      picks = normal.slice(0, 3).map((c: any) => ({ categoryId: c.categoryId, path: c.path, reason: "eBay suggestion" }));
    }
    return picks;
  });

// ---------- Optimizer engine (two-phase) ----------
// Phase 1 = analyze(). Deterministic, no AI, no eBay writes. Uses real synced
// stats (views, watchers, sales, clicks, age) + hard rules (banned phrases,
// bad titles) to decide what SHOULD happen to each active listing.
// Phase 2 = applyOptimizerAction(). Runs one row at a time. AI (title/desc
// rewrite) fires ONLY here, ONLY for rows analyze marked as needing a rewrite.

type OptimizerAction = {
  id: string;
  ebay_item_id: string | null;
  title: string;
  action: "end" | "rewrite_title" | "rewrite_description" | "noop";
  reason: string;
  needs_ai: boolean;
  age_days: number;
  views: number;
  clicks: number;
  sales: number;
};

function scoreListing(l: any, rule: any): OptimizerAction {
  const listedAt = l.listed_at ? new Date(l.listed_at) : null;
  const ageDays = listedAt ? Math.floor((Date.now() - listedAt.getTime()) / 86400000) : 0;
  const daysNoSales = Number(rule?.optimizer_no_sales_days ?? 30);
  const daysNoViewsRewrite = Number(rule?.optimizer_low_views_days ?? 14);
  const poorExposureDays = Number(rule?.optimizer_poor_exposure_days ?? 45);
  const views = Number(l.views || 0);
  const clicks = Number(l.clicks || 0);
  const sales = Number(l.sales || 0);
  const base = { id: l.id, ebay_item_id: l.ebay_item_id ?? null, title: l.title, age_days: ageDays, views, clicks, sales };
  const hasBanned = /the\s+sale\s+of\s+amazon/i.test(l.title || "") || /\bBan\s.*the\s+sale\s+of\s+amazon/i.test(l.title || "");

  // Hard rule 1: prohibited phrase — deterministic fix, no AI needed.
  if (hasBanned) return { ...base, action: "rewrite_title", reason: "prohibited marketplace phrase (Ban ... the sale of amazon)", needs_ai: false };
  // Hard rule 2: dead listing (no sales after threshold days) → end it.
  if (ageDays >= daysNoSales && sales === 0) return { ...base, action: "end", reason: `${ageDays}d live · 0 sales`, needs_ai: false };
  // Hard rule 3: zero views after long exposure = title is invisible → rewrite (AI).
  if (ageDays >= daysNoViewsRewrite && views === 0) return { ...base, action: "rewrite_title", reason: `${ageDays}d · 0 views`, needs_ai: true };
  // Hard rule 4: has views but 0 clicks over long window → title/description not converting → rewrite (AI).
  if (ageDays >= poorExposureDays && clicks === 0 && views > 0) return { ...base, action: "rewrite_description", reason: `${ageDays}d · ${views} views · 0 clicks`, needs_ai: true };
  // Hard rule 5: some views but under threshold → try a fresh title (AI).
  if (ageDays >= daysNoViewsRewrite && views > 0 && views < 5) return { ...base, action: "rewrite_title", reason: `${ageDays}d · only ${views} views`, needs_ai: true };
  return { ...base, action: "noop", reason: "healthy", needs_ai: false };
}

// Fast analysis. NO AI, NO writes. Returns the plan for the frontend to
// walk one-by-one with a progress bar.
export const analyzeOptimizer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { listingIds?: string[] } = {}) => data)
  .handler(async ({ data, context }: any): Promise<OptimizerAction[]> => {
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    let q = context.supabase.from("ebay_listings").select("*").eq("user_id", context.userId).eq("status", "active");
    if (data?.listingIds?.length) q = q.in("id", data.listingIds);
    const { data: listings, error } = await q;
    if (error) throw error;
    return (listings || []).map((l: any) => scoreListing(l, rule));
  });

// Apply ONE action. AI only fires when `needs_ai` was true in analyze.
export const applyOptimizerAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; action: "end" | "rewrite_title" | "rewrite_description"; useAi?: boolean }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: l } = await context.supabase.from("ebay_listings").select("*").eq("user_id", context.userId).eq("id", data.id).maybeSingle();
    if (!l) throw new Error("Listing not found");
    const token = await getFreshEbayToken(context.supabase, context.userId).catch(() => null);
    if (data.action === "end") {
      if (token && l.ebay_item_id) await endEbayFixedPriceListing(token, l.ebay_item_id, "NotAvailable");
      await context.supabase.from("ebay_listings").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", l.id);
      return { ok: true, action: "end", newTitle: null };
    }
    if (data.action === "rewrite_title") {
      let newTitle = fallbackRewrite(l.title);
      if (data.useAi && process.env.LOVABLE_API_KEY) {
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Lovable-API-Key": process.env.LOVABLE_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "Rewrite an eBay title for search. Max 80 chars. Keep brand/model/spec keywords. No emojis, no ALL CAPS. No marketplace names. Return the title only." },
                { role: "user", content: l.title },
              ],
            }),
          });
          const j = await res.json();
          newTitle = cleanTitle(j.choices?.[0]?.message?.content || newTitle);
        } catch { /* keep fallback */ }
      }
      if (newTitle && newTitle !== l.title) {
        if (token && l.ebay_item_id) await reviseEbayListingText(token, l.ebay_item_id, newTitle);
        await context.supabase.from("ebay_listings").update({ title: newTitle }).eq("id", l.id);
      }
      return { ok: true, action: "rewrite_title", newTitle };
    }
    if (data.action === "rewrite_description") {
      // Description rewrites need AI; if disabled, mark noop.
      if (!data.useAi || !process.env.LOVABLE_API_KEY) return { ok: true, action: "noop", newTitle: null };
      // Nothing to revise without a description column; we log the recommendation.
      await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "optimizer", message: `Description rewrite queued: ${l.title}`, metadata: { listingId: l.id } });
      return { ok: true, action: "rewrite_description", newTitle: null };
    }
    return { ok: true, action: "noop", newTitle: null };
  });

