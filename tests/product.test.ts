import { describe, expect, it } from "vitest";
import { buildExifApp1, readExif, withExif } from "../src/shared/exif.ts";
import { LIGHT_CATEGORY_LABEL, approxIlluminance, categoryFromExposure, validExposure } from "../src/shared/light.ts";
import { hebrewToList, normalizePets, petDisplayName, petSafety, type Pet } from "../src/shared/pets.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe("EXIF", () => {
  it("reads exposure, ISO, date and GPS presence", () => {
    const f = withExif(JPEG, buildExifApp1({ exposureTime: [1, 120], fNumber: [178, 100], iso: 64, date: "2026:09:30 10:15:00", gps: true }));
    const x = readExif(f);
    expect(x.exposureTime).toBeCloseTo(1 / 120);
    expect(x.fNumber).toBeCloseTo(1.78);
    expect(x.iso).toBe(64);
    expect(x.dateTimeOriginal).toBe(new Date("2026-09-30T10:15:00").toISOString());
    expect(x.hasGps).toBe(true);
  });
  it("missing or broken EXIF → nulls, never throws", () => {
    expect(readExif(JPEG)).toEqual({ dateTimeOriginal: null, exposureTime: null, fNumber: null, iso: null, hasGps: false });
    expect(readExif(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3])).exposureTime).toBeNull();
  });
});

describe("light estimate (categories only, from camera exposure)", () => {
  const cat = (t: number, n: number, iso: number) => categoryFromExposure({ exposureTime: t, fNumber: n, iso });
  it("maps typical iPhone exposures to broad categories", () => {
    expect(cat(1 / 30, 1.78, 640)).toBe("low");             // ≈40 lux: dim room corner
    expect(cat(1 / 60, 1.78, 125)).toBe("low");             // ≈380 lux: ordinary room — low light for plants
    expect(cat(1 / 250, 1.78, 50)).toBe("medium");          // ≈4,000 lux: close to a window
    expect(cat(1 / 1000, 1.78, 50)).toBe("bright_indirect"); // ≈16,000 lux: bright window, no sun
    expect(cat(1 / 2000, 1.78, 32)).toBe("direct");          // ≈50,000 lux: sunlit sill
  });
  it("monotonic: more light never gives a darker category", () => {
    const order = ["low", "medium", "bright_indirect", "direct"];
    let prev = 0;
    for (let t = 1 / 8; t > 1 / 8000; t /= 1.5) { const r = order.indexOf(cat(t, 1.78, 50)); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
  });
  it("rejects implausible metadata instead of guessing", () => {
    expect(validExposure({ exposureTime: 0, fNumber: 1.8, iso: 100 })).toBe(false);
    expect(validExposure({ exposureTime: 1 / 100, fNumber: 1.8 })).toBe(false);
    expect(validExposure({ exposureTime: 1 / 100, fNumber: 1.8, iso: 100 })).toBe(true);
    expect(approxIlluminance({ exposureTime: 1 / 100, fNumber: 2, iso: 100 })).toBeCloseTo(1000);
  });
  it("user-facing labels are the four categories, no numbers", () => {
    expect(Object.values(LIGHT_CATEGORY_LABEL)).toEqual(["אור חלש", "אור בינוני", "אור חזק", "שמש ישירה"]);
    for (const l of Object.values(LIGHT_CATEGORY_LABEL)) expect(l).not.toMatch(/\d|lux|לוקס/i);
  });
});

describe("pets: several of the same kind", () => {
  const dogs: Pet[] = [{ id: "a", kind: "dog", name: "מיקאסה" }, { id: "b", kind: "dog", name: "בייליס" }];
  it("legacy one-per-kind profiles are read without loss and get stable ids", () => {
    const legacy = [{ kind: "dog" as const, name: "רקס" }, { kind: "cat" as const, name: null }];
    const a = normalizePets(legacy), b = normalizePets(legacy);
    expect(a.map((p) => [p.kind, p.name])).toEqual([["dog", "רקס"], ["cat", null]]);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(new Set(a.map((p) => p.id)).size).toBe(2);
    expect(normalizePets(undefined)).toEqual([]);
    expect(normalizePets([{ kind: "unicorn" } as never])).toEqual([]);
  });
  it("two dogs stay two records; editing or removing one leaves the other", () => {
    const edited = dogs.map((p) => (p.id === "a" ? { ...p, name: "מיקי" } : p));
    expect(edited.find((p) => p.id === "b")!.name).toBe("בייליס");
    const removed = dogs.filter((p) => p.id !== "a");
    expect(removed).toEqual([dogs[1]]);
  });
  it("unnamed pets get distinct display names", () => {
    const two: Pet[] = [{ id: "x", kind: "cat", name: null }, { id: "y", kind: "cat", name: "" }];
    expect(two.map((p) => petDisplayName(p, two))).toEqual(["חתול 1", "חתול 2"]);
  });
  it("Hebrew list wording", () => {
    expect(hebrewToList(dogs)).toBe("למיקאסה ולבייליס");
    expect(hebrewToList([dogs[0]])).toBe("למיקאסה");
    expect(hebrewToList([...dogs, { id: "c", kind: "cat", name: null }])).toBe("למיקאסה, לבייליס ולחתול");
    expect(hebrewToList([{ id: "d", kind: "dog", name: "Max" }])).toBe("ל-Max");
  });
  it("safety considers every pet, by kind (not by name)", () => {
    const pets: Pet[] = [...dogs, { id: "c", kind: "cat", name: "חתולי" }, { id: "p", kind: "bird", name: "ציוצי" }];
    const s = petSafety({ cats: "non_toxic", dogs: "toxic" }, pets);
    expect(s.warning).toBe("לא בטוח למיקאסה ולבייליס");
    expect(s.safe.map((p) => p.id)).toEqual(["c"]);
    expect(s.unknownNote).toContain("לציוצי");
    // A pet NAMED like a safe animal is still judged by its kind.
    expect(petSafety({ cats: "non_toxic", dogs: "toxic" }, [{ id: "z", kind: "dog", name: "חתול" }]).warning).toBe("לא בטוח לחתול");
    expect(petSafety({ cats: "non_toxic", dogs: "non_toxic" }, dogs).warning).toBeNull();
  });
});
