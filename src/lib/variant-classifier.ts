// Deterministic, rule + dictionary + regex based variant value classifier.
// Never trusts CJDropshipping attribute names ("Color", "Style", "Size").
// Inspects the value itself and returns the best-fit eBay-style category.
//
// Scoring: each category rule contributes a score. Highest confidence wins.
// If no rule reaches the threshold, we return "Unknown" (caller labels it
// "Variant Option N" instead of guessing).

export type VariantCategory =
  | "Color"
  | "Size"
  | "Material"
  | "Pattern"
  | "Style"
  | "Capacity"
  | "Length"
  | "Width"
  | "Height"
  | "Quantity"
  | "Model"
  | "Shape"
  | "Type"
  | "Version"
  | "Design"
  | "Pack Size"
  | "Layout"
  | "Unknown";

const COLORS = [
  "red", "blue", "green", "black", "white", "pink", "purple", "grey", "gray",
  "orange", "yellow", "brown", "beige", "silver", "gold", "navy", "khaki",
  "coffee", "wine red", "sky blue", "cyan", "ivory", "camel", "burgundy",
  "mint", "maroon", "teal", "turquoise", "magenta", "lavender", "olive",
  "peach", "coral", "salmon", "tan", "cream", "rose", "violet", "indigo",
  "aqua", "amber", "bronze", "champagne", "charcoal", "chocolate", "fuchsia",
  "emerald", "ruby", "sapphire", "pearl", "plum", "apricot", "azure",
  "clear", "transparent", "multicolor", "multicolour", "rainbow",
  "light blue", "dark blue", "light green", "dark green", "light pink",
  "hot pink", "light grey", "dark grey", "light gray", "dark gray",
  "off white", "off-white", "jet black", "pure white",
];

const SIZE_LETTERS = /^(xxs|xs|s|m|l|xl|xxl|xxxl|3xl|4xl|5xl|one\s?size)$/i;
const SIZE_WORDS = /^(small|medium|large|extra\s?large|mini|standard|regular|jumbo)$/i;
const SIZE_LABELS = /^(us|uk|eu|au|jp)\s?\d+(\.\d+)?$/i;
const BED_SIZE = /^(twin|full|queen|king|california\s?king)$/i;
const PAPER_SIZE = /^(a[0-9]|b[0-9]|letter|legal)$/i;

const MEASURE = /\b\d+(\.\d+)?\s?(mm|cm|m|in|inch|inches|ft|foot|feet|yd|yard|"|')\b/i;
const CAPACITY = /\b\d+(\.\d+)?\s?(ml|l|litre|liter|oz|fl\s?oz|gal|gallon|kg|g|gram|lb|lbs|pound|mah|mah|gb|tb|mb)\b/i;
const QUANTITY = /^(\d+\s?(pcs|pc|pack|packs|piece|pieces|set|sets|pair|pairs|box|boxes|count|ct)|pack\s?of\s?\d+|set\s?of\s?\d+|\d+\s?x\b)/i;

const SHAPES = ["round", "square", "rectangle", "rectangular", "oval", "heart", "hexagon", "hexagonal", "octagon", "star", "triangle", "circle", "circular", "diamond", "cylinder", "sphere", "cube"];

const MATERIALS = ["cotton", "polyester", "leather", "faux leather", "pu leather", "wool", "silk", "linen", "denim", "nylon", "acrylic", "canvas", "velvet", "suede", "rubber", "plastic", "abs", "pvc", "silicone", "wood", "wooden", "bamboo", "metal", "stainless steel", "aluminum", "aluminium", "iron", "brass", "copper", "glass", "ceramic", "porcelain", "paper", "cardboard", "fabric", "mesh", "spandex", "elastane", "chiffon", "satin", "microfiber", "fleece", "cashmere", "jute", "hemp", "resin", "titanium"];

const PATTERNS = ["striped", "stripe", "plaid", "checkered", "checker", "polka dot", "floral", "solid", "printed", "geometric", "camo", "camouflage", "abstract", "tie dye", "tie-dye", "gradient", "ombre", "animal print", "leopard", "zebra"];

const STYLES = ["vintage", "modern", "classic", "nordic", "scandinavian", "minimalist", "luxury", "portable", "foldable", "telescopic", "magnetic", "rechargeable", "casual", "sporty", "elegant", "retro", "bohemian", "boho", "industrial", "rustic", "contemporary", "traditional", "gothic", "chic", "trendy"];

const DESIGN_NOUNS = [
  // animals
  "owl", "fish", "whale", "cat", "dog", "bear", "tiger", "lion", "elephant", "rabbit", "bunny", "fox", "wolf", "deer", "horse", "unicorn", "dragon", "dinosaur", "butterfly", "bee", "bird", "duck", "penguin", "panda", "koala", "monkey", "frog", "shark", "dolphin", "octopus", "turtle", "snake", "spider", "chicken", "cow", "pig", "sheep",
  // plants
  "rose", "flower", "sunflower", "tulip", "lily", "daisy", "orchid", "cactus", "tree", "leaf", "leaves", "plum blossom", "cherry blossom", "bamboo",
  // objects/scenes
  "galaxy", "space", "moon", "sun", "star", "cloud", "rainbow", "mountain", "ocean", "castle", "car", "truck", "airplane", "rocket", "ship", "boat", "trumpet",
  // materials-as-print
  "marble", "wood grain",
];

const GRID_LAYOUT = /^\d+\s?(grid|slot|slots|compartment|compartments|hole|holes|drawer|drawers|shelf|shelves|tier|tiers|layer|layers|row|rows|section|sections)$/i;

const MODEL_TOKEN = /^(model\s?[a-z0-9]+|type\s?[a-z0-9]+|version\s?[a-z0-9]+|v\d+|gen\s?\d+|mk\s?\d+|pro|max|mini|plus|lite|se|air|ultra|\d{4}\s?edition)$/i;

const LENGTH_ONLY = /\b\d+(\.\d+)?\s?(inch|inches|in|cm|mm|ft|feet|m)\b.*(length|long|tall|height|width)/i;

function normalize(v: string) {
  return v
    .toLowerCase()
    .replace(/[_/|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(hay: string, needles: string[]) {
  return needles.some((n) => new RegExp(`(^|\\s|-)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|-|$|s)`, "i").test(hay));
}

export function classifyVariantValue(rawValue: string): { category: VariantCategory; confidence: number } {
  const value = String(rawValue || "").trim();
  if (!value) return { category: "Unknown", confidence: 0 };
  const norm = normalize(value);

  const scores: Record<string, number> = {};
  const add = (cat: VariantCategory, score: number) => {
    scores[cat] = Math.max(scores[cat] || 0, score);
  };

  // Design first — a design word here typically outranks a stray color mention.
  if (containsAny(norm, DESIGN_NOUNS)) add("Design", 90);

  // Colors — only when a real color token is present and no strong design noun.
  if (containsAny(norm, COLORS)) add("Color", scores["Design"] ? 55 : 88);

  // Sizes — letter codes, size words, size labels.
  if (SIZE_LETTERS.test(norm) || SIZE_WORDS.test(norm) || SIZE_LABELS.test(norm) || BED_SIZE.test(norm) || PAPER_SIZE.test(norm)) {
    // Downgrade "Large" alone when a design noun sits next to it (e.g. "Large Owl").
    add("Size", scores["Design"] ? 30 : 92);
  }

  // Measurement / length
  if (MEASURE.test(value)) add("Length", 85);
  if (LENGTH_ONLY.test(value)) add("Length", 90);

  // Capacity (volume, weight, storage, battery)
  if (CAPACITY.test(value)) add("Capacity", 90);

  // Quantity / pack size
  if (QUANTITY.test(value)) add("Quantity", 92);

  // Grid / slot layouts (e.g. "7 Grid", "12 Slot")
  if (GRID_LAYOUT.test(norm)) add("Layout", 90);

  // Shapes
  if (containsAny(norm, SHAPES)) add("Shape", 75);

  // Materials
  if (containsAny(norm, MATERIALS)) add("Material", 80);

  // Patterns
  if (containsAny(norm, PATTERNS)) add("Pattern", 80);

  // Styles (descriptors)
  if (containsAny(norm, STYLES)) add("Style", 70);

  // Model / version tokens
  if (MODEL_TOKEN.test(norm)) add("Model", 75);

  let bestCat: VariantCategory = "Unknown";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat as VariantCategory;
    }
  }
  if (bestScore < 55) return { category: "Unknown", confidence: bestScore };
  return { category: bestCat, confidence: bestScore };
}

// Pick the winning category for a column of variant values.
// Never trust the CJ attribute name; use it only as a weak tiebreaker hint.
export function classifyAxis(values: string[], cjHint?: string): VariantCategory {
  const tally: Record<string, number> = {};
  let totalConfidence = 0;
  for (const v of values) {
    const { category, confidence } = classifyVariantValue(v);
    if (category === "Unknown") continue;
    tally[category] = (tally[category] || 0) + confidence;
    totalConfidence += confidence;
  }
  if (totalConfidence === 0) return "Unknown";
  // Weak tiebreaker: if CJ hint matches a plausible category and it has some support, prefer it.
  const hint = String(cjHint || "").toLowerCase().trim();
  const hintMap: Record<string, VariantCategory> = {
    color: "Color", colour: "Color", size: "Size", material: "Material",
    pattern: "Pattern", style: "Style", shape: "Shape", type: "Type",
    capacity: "Capacity", length: "Length", quantity: "Quantity",
    model: "Model", design: "Design",
  };
  const hintCat = hintMap[hint];
  let best: VariantCategory = "Unknown";
  let bestScore = 0;
  for (const [cat, score] of Object.entries(tally)) {
    const adjusted = cat === hintCat ? score * 1.05 : score;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      best = cat as VariantCategory;
    }
  }
  return best;
}
