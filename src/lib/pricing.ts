export type PricingRule = {
  markup_percent?: number | null;
  min_profit_usd?: number | null;
  ebay_fee_buffer_percent?: number | null;
  payment_fee_buffer_percent?: number | null;
  round_to?: number | null;
  max_listing_quantity?: number | null;
};

export type PriceBreakdown = {
  itemCost: number;
  shipping: number;
  landedCost: number;
  targetProfit: number;
  ebayFee: number;
  paymentFee: number;
  sellPrice: number;
  projectedProfit: number;
};

function safeNonNegative(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function roundPriceUp(value: number, roundTo: unknown): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ending = Number(roundTo);
  if (!Number.isFinite(ending) || ending < 0 || ending >= 1) return Number(value.toFixed(2));
  const floor = Math.floor(value);
  const candidate = floor + ending;
  return Number((candidate + (candidate + 0.000001 < value ? 1 : 0)).toFixed(2));
}

export function calculateRulePrice(itemCostValue: unknown, shippingValue: unknown, rule: PricingRule): PriceBreakdown {
  const itemCost = safeNonNegative(itemCostValue);
  const shipping = safeNonNegative(shippingValue);
  const landedCost = itemCost + shipping;
  const markupProfit = landedCost * (safeNonNegative(rule.markup_percent, 50) / 100);
  const targetProfit = Math.max(markupProfit, safeNonNegative(rule.min_profit_usd));
  const ebayRate = safeNonNegative(rule.ebay_fee_buffer_percent, 17) / 100;
  const paymentRate = safeNonNegative(rule.payment_fee_buffer_percent) / 100;
  const totalRate = Math.min(0.95, ebayRate + paymentRate);
  const requiredPrice = (landedCost + targetProfit) / (1 - totalRate);
  const sellPrice = roundPriceUp(requiredPrice, rule.round_to ?? 0.99);
  const ebayFee = sellPrice * ebayRate;
  const paymentFee = sellPrice * paymentRate;
  const projectedProfit = sellPrice - landedCost - ebayFee - paymentFee;

  return {
    itemCost: Number(itemCost.toFixed(2)),
    shipping: Number(shipping.toFixed(2)),
    landedCost: Number(landedCost.toFixed(2)),
    targetProfit: Number(targetProfit.toFixed(2)),
    ebayFee: Number(ebayFee.toFixed(2)),
    paymentFee: Number(paymentFee.toFixed(2)),
    sellPrice,
    projectedProfit: Number(projectedProfit.toFixed(2)),
  };
}

export function finitePositivePrice(...values: unknown[]): number | null {
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