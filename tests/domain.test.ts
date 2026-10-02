import { describe, expect, it } from "vitest";
import { DAY, displayName, dryDown, nextOrdinal, soilCheckPlan, todayTasks } from "../src/shared/domain.ts";
import { lightFit, searchSpecies, speciesById } from "../src/shared/species.ts";
import type { Plant, PlantEvent } from "../src/shared/types.ts";

const T0 = Date.parse("2026-07-01T09:00:00Z"); // warm season
const plant = (over: Partial<Plant> = {}): Plant => ({
  id: "p1", createdAt: new Date(T0 - 30 * DAY).toISOString(), speciesId: "monstera-deliciosa", scientificName: "Monstera deliciosa",
  commonName: "מונסטרה", ordinal: 1, status: "plant", ...over,
});
let n = 0;
const ev = (type: PlantEvent["type"], at: number, payload: Record<string, unknown> = {}, plantId = "p1"): PlantEvent => ({
  id: `e${n++}`, plantId, type, occurredAt: new Date(at).toISOString(), payload, source: "user", inJournal: false, inHistory: true, createdAt: new Date(at).toISOString(),
});

describe("naming", () => {
  it("first plant has no number, then #2/#3, never #1", () => {
    expect(displayName({ commonName: "מונסטרה", ordinal: 1 })).toBe("מונסטרה");
    expect(displayName({ commonName: "מונסטרה", ordinal: 2 })).toBe("מונסטרה #2");
    expect(displayName({ commonName: "מונסטרה", ordinal: 2, nickname: "מוצי" })).toBe("מוצי");
  });
  it("ordinals are never reused (deleted plants keep theirs)", () => {
    const all = [{ speciesId: "a", scientificName: "", ordinal: 1 }, { speciesId: "a", scientificName: "", ordinal: 3 }, { speciesId: "b", scientificName: "", ordinal: 1 }];
    expect(nextOrdinal(all, "a")).toBe(4);
    expect(nextOrdinal(all, "c")).toBe(1);
  });
});

describe("soil-check model and plant memory", () => {
  it("a single cycle is never a pattern", () => {
    const d = dryDown([ev("watering", T0 - 10 * DAY), ev("soil_check", T0 - 4 * DAY, { result: "dry" })]);
    expect(d.cycles).toEqual([6]);
    expect(d.confidence).toBe("insufficient");
    expect(d.typicalMin).toBeUndefined();
  });
  it("three or more cycles produce a qualified personal range", () => {
    const e: PlantEvent[] = [];
    for (const [w, gap] of [[40, 6], [30, 7], [20, 6], [10, 8]]) { e.push(ev("watering", T0 - w * DAY)); e.push(ev("soil_check", T0 - (w - gap) * DAY, { result: "dry" })); }
    const d = dryDown(e);
    expect(d.cycles.length).toBe(4);
    expect(d.confidence).toBe("possible");
    expect(d.typicalMin).toBeGreaterThanOrEqual(6);
  });
  it("next check follows the last watering using the species prior when history is thin", () => {
    const sp = speciesById("monstera-deliciosa");
    const plan = soilCheckPlan(plant(), [ev("watering", T0 - 1 * DAY)], sp, T0);
    expect(plan.basis).toBe("species");
    expect(Math.round((plan.nextCheckAt - (T0 - DAY)) / DAY)).toBe(sp!.checkDays[0]);
  });
  it("a moist check schedules a sooner re-check without creating watering", () => {
    const plan = soilCheckPlan(plant(), [ev("watering", T0 - 8 * DAY), ev("soil_check", T0, { result: "slightly_moist", watered: false })], speciesById("monstera-deliciosa"), T0);
    expect(plan.nextCheckAt).toBeGreaterThan(T0);
    expect(plan.lastWateringAt).toBe(T0 - 8 * DAY);
  });
  it("Today shows a due soil check and hides archived plants", () => {
    const evs = [ev("watering", T0 - 9 * DAY)];
    const tasks = todayTasks([plant(), plant({ id: "p2", archivedAt: new Date().toISOString() })], evs, [], (p) => speciesById(p.speciesId), T0);
    expect(tasks.map((t) => t.key)).toEqual(["soil:p1"]);
  });
});

describe("species knowledge", () => {
  it("searches Hebrew, scientific and alias names", () => {
    expect(searchSpecies("פוטוס")[0].id).toBe("epipremnum-aureum");
    expect(searchSpecies("monstera")[0].id).toBe("monstera-deliciosa");
    expect(searchSpecies("Snake plant")[0].id).toBe("dracaena-trifasciata");
  });
  it("light fit explains but never blocks; unknown when not measured", () => {
    const sp = speciesById("echeveria");
    expect(lightFit(sp, "low")).toBe("poor");
    expect(lightFit(sp, "direct")).toBe("fit");
    expect(lightFit(sp, null)).toBeNull();
  });
  it("never asserts pet safety without a source", () => {
    for (const s of ["zamioculcas-zamiifolia"]) {
      const sp = speciesById(s)!;
      expect(sp.safety.source).toBeNull();
      expect(sp.safety.cats).toBe("unknown");
    }
  });
});
