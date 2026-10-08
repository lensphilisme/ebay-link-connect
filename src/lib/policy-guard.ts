// Deterministic eBay policy guard (no AI). Runs before drafts are created and
// before anything is published. "block" rules stop the listing entirely;
// "scrub" rules remove risky wording but let the listing continue.

export type PolicySeverity = "block" | "scrub";
export type PolicyRule = { id: string; label: string; severity: PolicySeverity; patterns: RegExp[]; policy: string };
export type PolicyHit = { ruleId: string; label: string; severity: PolicySeverity; match: string; policy: string };
export type PolicyResult = { ok: boolean; blocked: PolicyHit[]; scrubbed: PolicyHit[]; title: string; description: string };

const w = (...words: string[]) => words.map((x) => new RegExp(`\\b${x}\\b`, "i"));

export const POLICY_RULES: PolicyRule[] = [
  { id: "pesticide", label: "Pesticides / insecticides (EPA FIFRA)", severity: "block", policy: "Pesticides policy",
    patterns: w("pesticides?", "insecticides?", "herbicides?", "fungicides?", "rodenticides?", "roach (?:killer|bait|poison|gel)", "cockroach (?:killer|bait|poison|gel|trap powder)", "ant (?:killer|bait|poison)", "rat poison", "mouse poison", "bug spray", "flea (?:killer|powder|spray)", "mosquito (?:killer spray|repellent spray)", "weed killer", "poison bait", "chalk insecticide", "miraculous chalk", "boric acid bait", "termite killer") },
  { id: "emissions", label: "Emissions defeat devices (Clean Air Act)", severity: "block", policy: "Motor vehicle emissions policy",
    patterns: w("muffler delete", "cat(?:alytic)? delete", "catalytic converter delete", "dpf delete", "egr delete", "def delete", "scr delete", "o2 (?:sensor )?(?:spacer|eliminator|simulator)", "oxygen sensor (?:spacer|eliminator)", "test pipe", "decat", "de-cat", "straight pipe kit", "emissions? (?:delete|defeat|bypass|eliminator)", "race pipe", "off[- ]road use only", "cat eliminator", "egr block(?:off|-off) plate", "dpf (?:removal|race)") },
  { id: "weapons", label: "Weapons & weapon parts", severity: "block", policy: "Weapons policy",
    patterns: w("switchblade", "butterfly knife", "balisong", "gravity knife", "brass knuckles?", "knuckle dusters?", "stun guns?", "tasers?", "pepper spray", "solvent trap", "silencers?", "suppressors?", "bump stock", "auto sear", "glock switch", "gun parts?", "firearm", "ammunition", "ammo", "throwing stars?", "nunchucks?", "blowguns?", "crossbow bolts? broadhead", "tear gas") },
  { id: "drugs", label: "Drugs, paraphernalia & supplements", severity: "block", policy: "Drugs & drug paraphernalia policy",
    patterns: w("bongs?", "dab rigs?", "crack pipes?", "weed grinder", "herb grinder", "cbd", "thc", "kratom", "kava", "steroids?", "sarms", "weight loss pills?", "diet pills?", "prescription", "viagra", "sildenafil", "nitrous", "whippets?", "cream chargers?", "poppers") },
  { id: "medical", label: "Medical devices requiring approval", severity: "block", policy: "Medical devices policy",
    patterns: w("contact lenses", "colored contacts", "hearing aids?", "syringes?", "hypodermic", "insulin pens?", "blood glucose test strips?", "covid test", "pregnancy test", "breast pump", "cpap", "tens unit for pain cure", "cures? cancer", "fda approved") },
  { id: "hazmat", label: "Hazardous materials & batteries", severity: "block", policy: "Hazardous materials policy",
    patterns: w("lithium metal batter(?:y|ies)", "loose 18650", "fireworks?", "sparklers?", "gunpowder", "flammable liquid", "butane refill", "lighter fluid", "mercury thermometer", "asbestos", "radioactive", "uranium") },
  { id: "lasers", label: "High-power lasers", severity: "block", policy: "Laser pointer policy",
    patterns: [/\b\d{3,5}\s?mw\b.*laser|laser.*\b\d{3,5}\s?mw\b/i, ...w("burning laser", "high power laser pointer", "military laser")] },
  { id: "surveillance", label: "Spy / surveillance devices", severity: "block", policy: "Surveillance equipment policy",
    patterns: w("hidden (?:spy )?camera(?: in| for)? (?:bathroom|toilet)", "spy pen camera", "voice recorder bug", "gps jammer", "signal jammer", "cell phone jammer", "radar jammer", "police scanner decoder", "lock picks?", "lock pick set", "bump keys?", "car key programmer", "relay attack") },
  { id: "adult", label: "Adult content", severity: "block", policy: "Adult items policy",
    patterns: w("sex toys?", "dildos?", "vibrators? for (?:women|adult)", "masturbat\\w*", "fleshlight", "erotic", "porn\\w*", "nude", "fetish", "bdsm") },
  { id: "animals", label: "Animal products & wildlife", severity: "block", policy: "Animals & wildlife products policy",
    patterns: w("ivory", "rhino horn", "tortoise ?shell", "shark fin", "bear bile", "real fur (?:of )?(?:dog|cat)", "live (?:animals?|insects?|fish|birds?)", "taxidermy", "pangolin", "coral (?:real|natural)") },
  { id: "currency", label: "Counterfeit currency, IDs & documents", severity: "block", policy: "Counterfeit currency & government documents policy",
    patterns: w("prop money", "fake money", "counterfeit", "fake id", "driver'?s licen[cs]e template", "passport cover replica", "police badge", "official badge", "license plate (?:real|government)") },
  { id: "replica", label: "Replicas & knock-offs (VeRO)", severity: "block", policy: "Counterfeit / VeRO policy",
    patterns: w("replica", "knock[- ]?off", "1:1 copy", "aaa quality", "inspired by (?:louis|gucci|chanel|nike|rolex)", "dupe", "unauthori[sz]ed copy", "mirror quality") },
  { id: "brands", label: "Brand names on unbranded items (VeRO)", severity: "block", policy: "VeRO intellectual property program",
    patterns: w("nike", "adidas", "gucci", "louis vuitton", "lv", "chanel", "rolex", "cartier", "hermes", "prada", "dior", "versace", "supreme", "yeezy", "jordan", "apple", "iphone", "airpods?", "ipad", "samsung", "galaxy buds", "sony", "playstation", "nintendo", "xbox", "disney", "marvel", "pokemon", "hello kitty", "sanrio", "lego", "barbie", "harley[- ]davidson", "ford", "chevy", "chevrolet", "toyota", "honda", "bmw", "mercedes", "audi", "porsche", "ferrari", "lamborghini", "tesla", "jeep", "dodge", "ram 1500", "subaru", "nissan", "mazda", "hyundai", "kia", "volkswagen", "vw", "lexus", "nfl", "nba", "mlb", "nhl", "fifa", "stanley cup tumbler", "yeti", "oakley", "ray[- ]?ban", "dyson", "pandora", "swarovski", "tiffany", "michael kors", "coach", "north face", "ugg", "crocs", "lululemon", "under armour", "puma", "new balance", "vans", "converse", "beats", "bose", "jbl", "gopro", "dji", "otterbox", "magsafe", "louboutin") },
  { id: "claims", label: "Medical / health claims", severity: "scrub", policy: "Health claims policy",
    patterns: w("cures?", "heals?", "treats? (?:cancer|diabetes|covid|arthritis)", "anti[- ]?viral", "kills (?:99\\.9% )?(?:viruses|germs|bacteria)", "antibacterial", "fda", "clinically proven", "doctor recommended", "covid", "coronavirus") },
  { id: "keyword_spam", label: "Keyword spam & marketplace references", severity: "scrub", policy: "Search & browse manipulation policy",
    patterns: w("ban the sale of amazon", "banned on amazon", "amazon", "aliexpress", "temu", "shein", "wish\\.com", "walmart", "dropship(?:ping)?", "cj ?dropshipping", "free shipping", "best seller", "hot sale", "hot selling", "new arrival", "202[0-9] new", "cross[- ]border", "foreign trade", "wholesale", "factory direct", "spot goods", "explosive models?", "tiktok", "same style", "l@@k", "wow") },
  { id: "contact", label: "Off-eBay contact info", severity: "scrub", policy: "Offers to buy or sell outside eBay",
    patterns: [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/i, /\bhttps?:\/\/\S+/i, /\bwww\.\S+/i, /\b(?:whatsapp|wechat|telegram|qq)\b/i] },
];

function asText(value: unknown) {
  return String(value ?? "");
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
}

function scrub(text: string, rules: PolicyRule[]) {
  let out = text;
  for (const rule of rules) for (const p of rule.patterns) out = out.replace(new RegExp(p.source, p.flags.includes("g") ? p.flags : p.flags + "g"), " ");
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/^[\s,\-|]+|[\s,\-|]+$/g, "").trim();
}

export type PolicyInput = { title?: unknown; description?: unknown; category?: unknown; brand?: unknown; extraBlocked?: string[] };

export function checkListingPolicy(input: PolicyInput): PolicyResult {
  const title = asText(input.title);
  const description = asText(input.description);
  const haystack = `${title} \n ${stripHtml(description)} \n ${asText(input.category)}`;
  const brandIsGeneric = !input.brand || /^(unbranded|generic|no brand|none)$/i.test(asText(input.brand).trim());
  const blocked: PolicyHit[] = [];
  const scrubbed: PolicyHit[] = [];

  const rules = [...POLICY_RULES];
  if (input.extraBlocked?.length) {
    rules.push({ id: "custom", label: "Custom banned words", severity: "block", policy: "Your own banned word list",
      patterns: input.extraBlocked.filter(Boolean).map((x) => new RegExp(`\\b${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")) });
  }

  for (const rule of rules) {
    // Brand names are only a problem on unbranded items, and only in the title
    // (descriptions often say "compatible with" which eBay allows).
    const text = rule.id === "brands" ? title : haystack;
    if (rule.id === "brands" && !brandIsGeneric) continue;
    for (const p of rule.patterns) {
      const m = text.match(p);
      if (!m) continue;
      // "fits / compatible with <brand>" in titles is allowed for parts.
      if (rule.id === "brands") {
        const idx = m.index ?? 0;
        const before = text.slice(Math.max(0, idx - 25), idx).toLowerCase();
        if (/(for|fits?|compatible with|replacement for)\s*$/.test(before)) continue;
      }
      const hit = { ruleId: rule.id, label: rule.label, severity: rule.severity, match: m[0], policy: rule.policy };
      (rule.severity === "block" ? blocked : scrubbed).push(hit);
      break;
    }
  }

  const scrubRules = POLICY_RULES.filter((r) => r.severity === "scrub");
  return {
    ok: blocked.length === 0,
    blocked,
    scrubbed,
    title: scrub(title, scrubRules).slice(0, 80),
    description: scrub(description, scrubRules.filter((r) => r.id !== "claims" || true)),
  };
}

export function policyErrorMessage(result: PolicyResult) {
  const parts = result.blocked.map((h) => `${h.label} ("${h.match}")`);
  return `POLICY_BLOCKED: ${parts.join("; ")} — eBay ${result.blocked[0]?.policy ?? "policy"}`;
}
