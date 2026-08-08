type CjProductShape = {
  variants?: unknown;
  variantList?: unknown;
  productVariants?: unknown;
  variantData?: unknown;
};

export function getCjVariants(product: CjProductShape | null | undefined): any[] {
  if (!product) return [];
  const candidates = [product.variants, product.variantList, product.productVariants, product.variantData];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

export function getCjVariantPrice(variant: any, ...fallbacks: unknown[]): number | null {
  const priceBlock = variant?.variantPrice;
  return finiteCjPrice(
    variant?.variantSellPrice,
    variant?.sellPrice,
    typeof priceBlock === "object" ? priceBlock?.sellPrice : priceBlock,
    variant?.price,
    variant?.productPrice,
    variant?.variantCost,
    ...fallbacks,
  );
}

export function finiteCjPrice(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value !== "string") continue;
    const matches = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
    if (!matches) continue;
    const prices = matches.map(Number).filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length > 0) return Math.min(...prices);
  }
  return null;
}