// Facebook Marketplace bulk-upload exporter.
// Turns selected CJ Dropshipping products into the XLSX format Facebook
// Marketplace accepts (TITLE, PRICE, CONDITION, DESCRIPTION, CATEGORY).
//
// FB caps a single bulk upload at 50 listings; we still allow larger exports
// (the file will simply need to be split by the user), but we warn upstream.
import * as XLSX from "xlsx";

export type FbSourceProduct = {
  pid: string;
  productSku?: string | null;
  productNameEn?: string | null;
  productImage?: string | null;
  categoryName?: string | null;
  sellPrice?: number | string | null;
  description?: string | null;
};

export type FbPricingRule = {
  markupPercent?: number;
  ebayFeeBufferPercent?: number; // reused as generic buffer
};

// FB accepts these four condition strings. We default to "New" (CJ is
// brand-new dropship inventory).
export const FB_CONDITIONS = ["New", "Used - Like New", "Used - Good", "Used - Fair"] as const;

// Roots pulled from the official FB Marketplace bulk-upload validation sheet.
// Values are the exact "A//B//C" strings FB expects. We only need one plausible
// leaf per root; the seller can edit inside the XLSX if they need finer detail.
const FB_CATEGORY_FALLBACKS: Record<string, string> = {
  "Antiques & Collectibles": "Antiques & Collectibles//Collectibles//Other Collectibles",
  "Arts & Crafts": "Arts & Crafts//Craft Supplies//Other Craft Supplies",
  "Auto Parts & Accessories": "Auto Parts & Accessories//Car Accessories//Other Car Accessories",
  "Baby Products": "Baby Products//Baby Gear//Other Baby Gear",
  "Bags & Luggage": "Bags & Luggage//Handbags & Wallets//Handbags",
  "Books, Movies & Music": "Books, Movies & Music//Books//Other Books",
  "Cell Phones & Accessories": "Cell Phones & Accessories//Cell Phone Accessories//Other Cell Phone Accessories",
  "Clothing, Shoes & Accessories": "Clothing, Shoes & Accessories//Women's Clothing//Other Women's Clothing",
  "Electronics": "Electronics//Consumer Electronics//Other Consumer Electronics",
  "Furniture": "Furniture//Living Room Furniture//Other Living Room Furniture",
  "Health & Beauty": "Health & Beauty//Beauty//Other Beauty",
  "Home & Kitchen": "Home & Kitchen//Home Decor//Other Home Decor",
  "Jewelry & Watches": "Jewelry & Watches//Jewelry//Other Jewelry",
  "Musical Instruments": "Musical Instruments//Musical Instrument Accessories//Other Musical Instrument Accessories",
  "Office Supplies": "Office Supplies//Office Products//Other Office Products",
  "Patio & Garden": "Patio & Garden//Garden//Other Garden",
  "Pet Supplies": "Pet Supplies//Dog Supplies//Other Dog Supplies",
  "Sporting Goods": "Sporting Goods//Outdoor Recreation//Other Outdoor Recreation",
  "Tools & Home Improvement": "Tools & Home Improvement//Tools//Other Tools",
  "Toys & Games": "Toys & Games//Toys//Other Toys",
  "Video Games & Consoles": "Video Games & Consoles//Video Games//Other Video Games",
};

// Keyword rules — evaluated in order. First match wins. Rules match against
// the concatenation of CJ category name + product title, lowercased.
const KEYWORD_RULES: Array<{ match: RegExp; root: keyof typeof FB_CATEGORY_FALLBACKS }> = [
  { match: /\b(phone|iphone|samsung|charger cable|case|screen protector|airpods?)\b/, root: "Cell Phones & Accessories" },
  { match: /\b(laptop|tablet|monitor|keyboard|mouse|headphone|earbud|speaker|camera|drone|tv|console|hdmi|usb|smart\s?watch)\b/, root: "Electronics" },
  { match: /\b(shoe|sneaker|boot|dress|shirt|t-shirt|pants|jeans|jacket|hoodie|coat|hat|cap|sock|scarf|glove|swimsuit|bikini|underwear|bra|lingerie|leggings|skirt)\b/, root: "Clothing, Shoes & Accessories" },
  { match: /\b(bag|backpack|handbag|wallet|purse|luggage|suitcase|tote)\b/, root: "Bags & Luggage" },
  { match: /\b(ring|necklace|bracelet|earring|watch|jewelry|pendant)\b/, root: "Jewelry & Watches" },
  { match: /\b(makeup|lipstick|skincare|serum|moisturizer|shampoo|conditioner|nail|beauty|cosmetic|perfume|fragrance|hair\s?care|massager|facial)\b/, root: "Health & Beauty" },
  { match: /\b(baby|infant|toddler|stroller|diaper|pacifier|crib)\b/, root: "Baby Products" },
  { match: /\b(dog|cat|pet|aquarium|fish tank|bird cage|hamster|leash|collar)\b/, root: "Pet Supplies" },
  { match: /\b(toy|puzzle|lego|doll|figure|board game|plush|stuffed animal)\b/, root: "Toys & Games" },
  { match: /\b(sofa|couch|chair|table|desk|bed|mattress|shelf|dresser|nightstand|furniture)\b/, root: "Furniture" },
  { match: /\b(kitchen|cookware|pan|pot|utensil|blender|mixer|coffee|kettle|dinnerware|cutlery|bakeware|storage|organizer|home\s?decor|curtain|rug|pillow|blanket|towel|bedding|lamp|candle)\b/, root: "Home & Kitchen" },
  { match: /\b(garden|patio|outdoor|planter|hose|lawn|bbq|grill)\b/, root: "Patio & Garden" },
  { match: /\b(tool|drill|saw|wrench|screwdriver|hardware|paint|plumbing|electrical)\b/, root: "Tools & Home Improvement" },
  { match: /\b(car|auto|vehicle|truck|motorcycle|tire|wheel|exhaust|bumper|dashboard|seat cover)\b/, root: "Auto Parts & Accessories" },
  { match: /\b(bike|bicycle|yoga|fitness|dumbbell|treadmill|sport|camping|hiking|fishing|hunting|golf|tennis|basketball|football|soccer)\b/, root: "Sporting Goods" },
  { match: /\b(office|stationery|pen|notebook|desk\s?organizer|printer|paper)\b/, root: "Office Supplies" },
  { match: /\b(art|craft|paint|brush|canvas|scrapbook|yarn|knit|sewing|bead)\b/, root: "Arts & Crafts" },
  { match: /\b(guitar|piano|drum|violin|ukulele|microphone|amplifier|instrument)\b/, root: "Musical Instruments" },
  { match: /\b(book|novel|magazine|movie|dvd|blu-?ray|vinyl|cd|music)\b/, root: "Books, Movies & Music" },
  { match: /\b(video game|xbox|playstation|nintendo|switch)\b/, root: "Video Games & Consoles" },
  { match: /\b(antique|vintage|collectible|memorabilia|coin|stamp)\b/, root: "Antiques & Collectibles" },
];

export function guessFbCategory(cjCategoryName?: string | null, productName?: string | null): string {
  const hay = `${cjCategoryName ?? ""} ${productName ?? ""}`.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(hay)) return FB_CATEGORY_FALLBACKS[rule.root];
  }
  // Default catch-all — sellers can edit before uploading.
  return FB_CATEGORY_FALLBACKS["Home & Kitchen"];
}

export function buildFbTitle(name?: string | null): string {
  const text = String(name ?? "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? text.slice(0, 147).trim() + "…" : text;
}

// FB DESCRIPTION column is plain text, up to 5000 characters. Strip HTML,
// collapse whitespace, and keep enough of the original copy to be useful.
export function buildFbDescription(raw?: string | null, fallbackTitle?: string | null): string {
  const html = String(raw ?? "").trim();
  const plain = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const text = plain || String(fallbackTitle ?? "").trim();
  return text.length > 5000 ? text.slice(0, 4997).trim() + "…" : text;
}

// FB bulk template PRICE column is a whole number in $. Apply the same
// markup/fee buffer used elsewhere in the app and round up so we never
// undersell on rounding.
export function buildFbPrice(sellPrice: number | string | null | undefined, rule?: FbPricingRule): number {
  const cost = Number(sellPrice) || 0;
  const shipping = cost * 0.2; // conservative default when no live freight quote
  const landed = cost + shipping;
  const markupPct = Number(rule?.markupPercent ?? 50) / 100;
  const feePct = Number(rule?.ebayFeeBufferPercent ?? 17) / 100;
  const profit = landed * markupPct;
  const preFee = landed + profit;
  const final = preFee * (1 + feePct);
  return Math.max(1, Math.ceil(final));
}

export type FbRow = {
  TITLE: string;
  PRICE: number;
  CONDITION: (typeof FB_CONDITIONS)[number];
  DESCRIPTION: string;
  CATEGORY: string;
};

export function productsToFbRows(products: FbSourceProduct[], rule?: FbPricingRule): FbRow[] {
  return products.map((p) => ({
    TITLE: buildFbTitle(p.productNameEn),
    PRICE: buildFbPrice(p.sellPrice, rule),
    CONDITION: "New",
    DESCRIPTION: buildFbDescription(p.description, p.productNameEn),
    CATEGORY: guessFbCategory(p.categoryName, p.productNameEn),
  }));
}

export function exportProductsToFbXlsx(products: FbSourceProduct[], rule?: FbPricingRule, filename = "facebook-marketplace.xlsx") {
  const rows = productsToFbRows(products, rule);
  const header = ["TITLE", "PRICE", "CONDITION", "DESCRIPTION", "CATEGORY"];
  const aoa: (string | number)[][] = [header, ...rows.map((r) => [r.TITLE, r.PRICE, r.CONDITION, r.DESCRIPTION, r.CATEGORY])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 80 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bulk Upload Template");
  XLSX.writeFile(wb, filename);
  return rows.length;
}
