import type { LightCat } from "./types.ts";
import { SPECIES, type Species, type Toxicity } from "./species.ts";

// General plant catalog (data packs in public/catalog/, loaded at runtime — see app/data/catalog.ts).
// Adding validated species = adding entries/packs; no application code changes. Every entry is validated here
// before use; invalid entries are skipped, never "fixed up". Missing care fields stay missing (never guessed).
// The 14 hand-written species in species.ts remain the richest pages; catalog entries never duplicate them
// (a cultivar may point to one as its `parent`).

export type CatalogCategory = "houseplant" | "herb" | "vegetable" | "fruit" | "succulent" | "flower" | "outdoor";
export type Water = "moist" | "top_dry" | "half_dry" | "dry";
export interface CatalogEntry {
  id: string;
  scientific: string;
  genus: string;
  species?: string;
  cultivar?: string;
  parent?: string;
  family: string;
  he: string;
  heAlt?: string[];
  en?: string[];
  synonyms?: string[];
  category: CatalogCategory;
  group: string;
  care: {
    light?: LightCat[];
    water?: Water;
    humidity?: "low" | "medium" | "high";
    tempMinC?: number;
    substrate?: string;
    where?: "indoor" | "outdoor" | "both";
    lifecycle?: "perennial" | "annual" | "biennial";
    propagation?: string[];
    sowing?: { depth: string; germDays: [number, number]; tempC: [number, number] };
  };
  toxicity: { cats: Toxicity; dogs: Toxicity; source: string | null };
  note?: string;
  image?: { url: string; license: string; author: string; source: string };
}
export interface CatalogPack { pack: string; version: number; provenance: { he: string; toxicity_he?: string; verified: boolean }; entries: unknown[] }

const CATS = new Set(["houseplant", "herb", "vegetable", "fruit", "succulent", "flower", "outdoor"]);
const LIGHTS = new Set(["low", "medium", "bright_indirect", "direct"]);
const TOX = new Set(["toxic", "non_toxic", "unknown"]);
const str = (x: unknown, max = 200) => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const strs = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((s) => str(s)));

/** Strict validation of one entry from a pack (untrusted data). */
export function validateEntry(x: unknown): x is CatalogEntry {
  const e = x as CatalogEntry;
  if (!e || typeof e !== "object") return false;
  if (!str(e.id, 64) || !/^[a-z0-9-]+$/.test(e.id)) return false;
  if (!str(e.scientific) || !str(e.genus, 60) || !str(e.family, 60) || !str(e.he, 80) || !str(e.group, 30)) return false;
  if (!CATS.has(e.category)) return false;
  if (!strs(e.heAlt) || !strs(e.en) || !strs(e.synonyms)) return false;
  if (e.image && !(str(e.image.url, 300) && /^\/|^https:\/\//.test(e.image.url) && str(e.image.license) && str(e.image.author) && str(e.image.source, 300))) return false;
  const c = e.care;
  if (!c || typeof c !== "object") return false;
  if (c.light && !(Array.isArray(c.light) && c.light.every((l) => LIGHTS.has(l)))) return false;
  if (c.tempMinC !== undefined && !(typeof c.tempMinC === "number" && c.tempMinC > -40 && c.tempMinC < 40)) return false;
  if (!e.toxicity || !TOX.has(e.toxicity.cats) || !TOX.has(e.toxicity.dogs)) return false;
  return true;
}

// ---------- Hebrew labels for the coded care fields ----------
export const WATER_TEXT: Record<Water, string> = {
  moist: "לשמור על מצע לח קלות — לא רטוב ולא יבש לגמרי.",
  top_dry: "לבדוק כשהשכבה העליונה (2–3 ס״מ) מתייבשת.",
  half_dry: "להשקות כשכמחצית המצע יבשה.",
  dry: "להשקות רק כשהמצע יבש לגמרי.",
};
export const HUMIDITY_TEXT = { low: "לחות נמוכה–ביתית מספיקה", medium: "לחות בינונית", high: "אוהב לחות גבוהה" } as const;
export const SUBSTRATE_TEXT: Record<string, string> = {
  aroid: "מצע מאוורר לאראונים: קליפות, פרלייט ומעט מצע עציצים",
  general: "מצע עציצים איכותי עם ניקוז טוב",
  gritty: "מצע מנקז מאוד (לסוקולנטים/קקטוסים) — חול גס, פומיס או פרלייט",
  orchid_bark: "קליפות גסות / מצע לסחלבים",
  moisture_retentive: "מצע ששומר לחות אבל מנוקז (עם כבול/קוקוס ופרלייט)",
  rich_garden: "אדמה או מצע עשירים בחומר אורגני",
  peat_free_acidic: "מצע חומצי ודל (כמו סקפגנום), מים רכים בלבד",
  mounted: "על מצע תלייה (קרש/קליפה) או בסל מאוורר",
};
export const PROPAGATION_TEXT: Record<string, string> = {
  stem_cutting_water: "ייחור גבעול במים", stem_cutting_soil: "ייחור גבעול במצע", leaf_cutting: "ייחור עלה", division: "חלוקה",
  offsets: "צמחונים / ייחורי בסיס", seed: "זרעים", air_layering: "הברכה אווירית", tuber: "פקעות", bulb: "בצלים", runners: "שלוחות / צמחונים",
  spores: "נבגים", keiki: "קייקי (צמחון על השרביט)", pad_cutting: "ייחור כף", rhizome: "קנה שורש", cloves: "שיני שום", grafting: "הרכבה",
};
export const WHERE_TEXT = { indoor: "בתוך הבית", outdoor: "בחוץ", both: "בבית או בחוץ (לפי האקלים)" } as const;
export const LIFECYCLE_TEXT = { perennial: "רב-שנתי", annual: "חד-שנתי", biennial: "דו-שנתי" } as const;
export const SOW_DEPTH_TEXT: Record<string, string> = { surface: "על פני המצע (צריך אור לנביטה)", "0.5cm": "כחצי ס״מ", "1cm": "כ-1 ס״מ", "2cm": "כ-2 ס״מ", "3cm": "כ-3 ס״מ" };
export const GROUP_LABEL: Record<string, string> = {
  aroid: "אראונים", marantaceae: "צמחי תפילה", ficus: "פיקוסים", dracaena: "דרצנות", sansevieria: "סנסווריות", hoya: "הויות",
  peperomia: "פפרומיות", begonia: "בגוניות", orchid: "סחלבים", fern: "שרכים", palm: "דקלים", succulent: "סוקולנטים", cactus: "קקטוסים",
  herb: "עשבי תיבול", vegetable: "ירקות", fruit: "עצי פרי ופירות", flower: "פורחים", bulb: "פקעות ובצלים", foliage: "צמחי עלווה",
  bromeliad: "ברומליות", carnivorous: "טורפים", tree: "עצים", vine: "מטפסים",
};

// ---------- Search ----------
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[֑-ׇ'"׳״`’\-\s.×()]/g, "").replace(/spp$/, "");

export interface CatalogHit { id: string; he: string; scientific: string; category: string; group: string; image?: string; kind: "curated" | "catalog"; cultivar?: string }
const curatedHit = (s: Species): CatalogHit => ({ id: s.id, he: s.he, scientific: s.scientific, category: s.category, group: s.category, image: s.image, kind: "curated" });
const entryHit = (e: CatalogEntry): CatalogHit => ({ id: e.id, he: e.he, scientific: e.scientific, category: e.category, group: e.group, image: e.image?.url, kind: "catalog", cultivar: e.cultivar });

/** Names a plant can be found by: Hebrew, alternative Hebrew, English, scientific, synonyms, genus, cultivar. Never personal nicknames. */
export function namesOf(e: CatalogEntry): string[] {
  return [e.he, ...(e.heAlt ?? []), ...(e.en ?? []), e.scientific, ...(e.synonyms ?? []), e.genus, e.cultivar ?? ""].filter(Boolean);
}

/** Unified search over the curated species and the loaded catalog; better matches first, curated first on ties. */
export function searchAll(q: string, catalog: CatalogEntry[]): CatalogHit[] {
  const n = norm(q);
  const curated = SPECIES.map((s) => ({ hit: curatedHit(s), names: [s.he, s.scientific, ...s.aliases] }));
  const rest = catalog.map((e) => ({ hit: entryHit(e), names: namesOf(e) }));
  if (!n) return [...curated, ...rest].map((x) => x.hit);
  const scored: { hit: CatalogHit; score: number }[] = [];
  for (const x of [...curated, ...rest]) {
    let best = 0;
    for (const name of x.names) {
      const m = norm(name);
      if (!m) continue;
      if (m === n) best = Math.max(best, 3);
      else if (m.startsWith(n)) best = Math.max(best, 2);
      else if (m.includes(n)) best = Math.max(best, 1);
    }
    if (best) scored.push({ hit: x.hit, score: best * 2 + (x.hit.kind === "curated" ? 1 : 0) - (x.hit.cultivar ? 0.5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.hit.he.localeCompare(b.hit.he, "he")).map((x) => x.hit);
}

// ---------- Matching an AI identification to the catalog ----------
const sciKey = (s: string) => s.toLowerCase().replace(/[×'"‘’]/g, " ").replace(/\b(spp|sp|var|subsp|cv|f)\.?(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
const binomial = (s: string) => sciKey(s).split(" ").slice(0, 2).join(" ");

export interface CatalogMatch { kind: "curated" | "catalog"; id: string; level: "exact" | "species" | "genus"; he: string; scientific: string }

/**
 * Finds the catalog page for an AI candidate. Exact name (incl. cultivar) → species (binomial or synonym) →
 * a genus-level page. Returns null when Leafling has no page — the AI result itself stays usable.
 */
export function matchCandidate(scientific: string, he: string, catalog: CatalogEntry[]): CatalogMatch | null {
  const full = sciKey(scientific);
  const bi = binomial(scientific);
  const genus = full.split(" ")[0] ?? "";
  const heN = norm(he);
  const curated = SPECIES.map((s) => ({ kind: "curated" as const, id: s.id, he: s.he, scientific: s.scientific, names: [s.scientific], heNames: [s.he, ...s.aliases], cultivar: false, genusOnly: /spp\.?$/.test(s.scientific) }));
  const cat = catalog.map((e) => ({ kind: "catalog" as const, id: e.id, he: e.he, scientific: e.scientific, names: [e.scientific, ...(e.synonyms ?? [])], heNames: [e.he, ...(e.heAlt ?? [])], cultivar: Boolean(e.cultivar), genusOnly: !e.species && !e.cultivar }));
  const all = [...curated, ...cat];
  const pick = (x: (typeof all)[number], level: CatalogMatch["level"]): CatalogMatch => ({ kind: x.kind, id: x.id, level, he: x.he, scientific: x.scientific });
  if (full) {
    const exact = all.find((x) => x.names.some((n) => sciKey(n) === full));
    if (exact) return pick(exact, exact.genusOnly ? "genus" : "exact");
  }
  if (bi.includes(" ")) {
    const sp = all.filter((x) => !x.cultivar && !x.genusOnly && x.names.some((n) => binomial(n) === bi));
    if (sp.length) return pick(sp[0], "species");
  }
  if (heN) {
    const byHe = all.find((x) => x.heNames.some((n) => norm(n) === heN));
    if (byHe) return pick(byHe, byHe.genusOnly ? "genus" : "species");
  }
  if (genus) {
    const g = all.find((x) => x.genusOnly && sciKey(x.scientific).split(" ")[0] === genus);
    if (g) return pick(g, "genus");
  }
  return null;
}
