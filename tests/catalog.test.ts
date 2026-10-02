// General plant catalog: pack integrity, multilingual search, AI-identification matching.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchCandidate, searchAll, validateEntry, type CatalogEntry } from "../src/shared/catalog.ts";
import { SPECIES } from "../src/shared/species.ts";

const pack = JSON.parse(readFileSync(new URL("../public/catalog/plants-core-v1.json", import.meta.url), "utf8")) as { entries: CatalogEntry[]; provenance: { verified: boolean } };
const index = JSON.parse(readFileSync(new URL("../public/catalog/index.json", import.meta.url), "utf8")) as { packs: string[] };
const entries = pack.entries;
const ids = (q: string) => searchAll(q, entries).map((h) => h.id);

describe("catalog pack", () => {
  it("is listed in the index, every entry validates, ids are unique", () => {
    expect(index.packs).toContain("plants-core-v1.json");
    const bad = entries.filter((e) => !validateEntry(e)).map((e) => (e as { id?: string }).id);
    expect(bad).toEqual([]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(entries.length).toBeGreaterThanOrEqual(250);
  });
  it("honest provenance: draft, unverified; toxicity only with a source", () => {
    expect(pack.provenance.verified).toBe(false);
    for (const e of entries) if (e.toxicity.cats !== "unknown" || e.toxicity.dogs !== "unknown") expect(e.toxicity.source, e.id).toBe("ASPCA");
    expect(entries.some((e) => e.toxicity.cats === "unknown")).toBe(true); // unknown stays unknown
  });
  it("covers the requested plant groups", () => {
    const groups = new Set(entries.map((e) => e.group));
    for (const g of ["aroid", "marantaceae", "ficus", "dracaena", "sansevieria", "hoya", "peperomia", "begonia", "orchid", "fern", "palm", "succulent", "cactus", "herb", "vegetable", "fruit", "flower", "bulb"]) expect(groups.has(g), g).toBe(true);
    const genera = new Set(entries.map((e) => e.genus));
    for (const g of ["Alocasia", "Monstera", "Philodendron", "Anthurium", "Epipremnum", "Syngonium", "Goeppertia", "Maranta", "Ficus", "Dracaena", "Hoya", "Peperomia", "Begonia"]) expect(genera.has(g), g).toBe(true);
    expect(entries.some((e) => e.cultivar)).toBe(true);
    expect(entries.filter((e) => e.care.sowing).length).toBeGreaterThan(15);
  });
  it("never duplicates a curated species; every parent exists", () => {
    const curated = new Set(SPECIES.map((s) => s.scientific.toLowerCase()));
    for (const e of entries) expect(curated.has(e.scientific.toLowerCase()), e.id).toBe(false);
    const known = new Set([...SPECIES.map((s) => s.id), ...entries.map((e) => e.id)]);
    for (const e of entries) if (e.parent) expect(known.has(e.parent), `${e.id} → ${e.parent}`).toBe(true);
  });
  it("does not invent fields: optional care fields are simply absent when unknown", () => {
    expect(entries.some((e) => !e.care.sowing)).toBe(true);
    expect(entries.every((e) => !("lux" in e.care))).toBe(true);
  });
  it("rejects malformed entries", () => {
    expect(validateEntry({ id: "X Bad", scientific: "a", genus: "a", family: "a", he: "א", category: "houseplant", group: "aroid", care: {}, toxicity: { cats: "unknown", dogs: "unknown", source: null } })).toBe(false);
    expect(validateEntry({ ...entries[0], care: { light: ["sunny"] } })).toBe(false);
    expect(validateEntry({ ...entries[0], image: { url: "javascript:alert(1)", license: "x", author: "y", source: "z" } })).toBe(false);
  });
});

describe("search: Hebrew, English, scientific, synonyms, cultivars", () => {
  it("Hebrew", () => {
    expect(ids("מונסטרה")[0]).toBe("monstera-deliciosa"); // curated first
    expect(ids("מונסטרה")).toContain("monstera-adansonii");
    expect(ids("קלתאה")).toContain("goeppertia-orbifolia");
    expect(ids("שערות שולמית")[0]).toBe("adiantum-raddianum");
    expect(ids("לשון חמות")[0]).toBe("dracaena-trifasciata");
    expect(ids("סנסווריה")).toContain("dracaena-trifasciata-laurentii");
  });
  it("English common names", () => {
    expect(ids("fiddle")).toContain("ficus-lyrata");
    expect(ids("snake plant")).toContain("dracaena-angolensis");
    expect(ids("String of pearls")[0]).toBe("curio-rowleyanus");
  });
  it("scientific names and synonyms", () => {
    expect(ids("Goeppertia orbifolia")[0]).toBe("goeppertia-orbifolia");
    expect(ids("Calathea orbifolia")[0]).toBe("goeppertia-orbifolia");
    expect(ids("Sansevieria cylindrica")[0]).toBe("dracaena-angolensis");
    expect(ids("Schefflera arboricola")[0]).toBe("heptapleurum-arboricola");
  });
  it("less common plants and cultivars", () => {
    expect(ids("Platycerium")[0]).toBe("platycerium-bifurcatum");
    expect(ids("Thai Constellation")[0]).toBe("monstera-deliciosa-thai-constellation");
    expect(ids("pink princess")[0]).toBe("philodendron-pink-princess");
  });
});

describe("AI identification outside the catalog", () => {
  it("exact / synonym / genus / none", () => {
    expect(matchCandidate("Monstera deliciosa", "מונסטרה", entries)).toMatchObject({ kind: "curated", id: "monstera-deliciosa", level: "exact" });
    expect(matchCandidate("Calathea orbifolia", "קלתאה", entries)).toMatchObject({ kind: "catalog", id: "goeppertia-orbifolia" });
    expect(matchCandidate("Alocasia sanderiana", "אלוקסיה סנדריאנה", entries)).toMatchObject({ id: "alocasia", level: "genus" });
    expect(matchCandidate("Phalaenopsis amabilis", "סחלב", entries)).toMatchObject({ id: "phalaenopsis" });
    expect(matchCandidate("Welwitschia mirabilis", "ולוויצ'יה", entries)).toBeNull(); // not in Leafling → AI result stays usable
  });
});
