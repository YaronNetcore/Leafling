// Deterministic parts of AI Botanist actions: Hebrew dates in the user's time zone, personal-plant matching and
// treatment safety. No model involved.
import { describe, expect, it } from "vitest";
import {
  dueAtFor, matchLocations, matchPlants, occurredAtFor, proposalQuestion, resolveHebrewDate, safeReminderText, safeTz, samePest, pestInfo, treatmentSafety,
  type PlantLite,
} from "../src/shared/actions.ts";
import { sanitizeParsed } from "../src/worker/action-schema.ts";

const TZ = "Asia/Jerusalem";
// Sunday 18.10.2026, 10:00 in Israel (07:00 UTC, IDT +3).
const NOW = Date.UTC(2026, 9, 18, 7, 0);
const day = (t: string | null, dir: "past" | "future" = "past", now = NOW) => {
  const r = resolveHebrewDate(t, now, TZ, dir);
  return r.ok ? r.day : `ERR:${r.reason}`;
};

describe("Hebrew dates (user's time zone)", () => {
  it("relative words", () => {
    expect(day(null)).toBe("2026-10-18");
    expect(day("היום")).toBe("2026-10-18");
    expect(day("אתמול")).toBe("2026-10-17");
    expect(day("שלשום")).toBe("2026-10-16");
    expect(day("לפני שבוע")).toBe("2026-10-11");
    expect(day("לפני שבועיים")).toBe("2026-10-04");
    expect(day("לפני יומיים")).toBe("2026-10-16");
    expect(day("לפני 3 ימים")).toBe("2026-10-15");
    expect(day("לפני שלושה ימים")).toBe("2026-10-15");
  });
  it("weekdays: the most recent past one for things done; the next one for reminders", () => {
    expect(day("ביום שלישי")).toBe("2026-10-13"); // Tuesday
    expect(day("ביום ג'")).toBe("2026-10-13");
    expect(day("בשבת")).toBe("2026-10-17");
    expect(day("ביום ראשון")).toBe("2026-10-11"); // today is Sunday → last week's
    expect(day("ביום שלישי", "future")).toBe("2026-10-20");
  });
  it("explicit dates incl. two-digit years and the Hebrew maqaf; weekday consistency is checked", () => {
    expect(day("ב־13.10.26")).toBe("2026-10-13");
    expect(day("13/10/2026")).toBe("2026-10-13");
    expect(day("ביום שלישי ה־13.10.26")).toBe("2026-10-13");
    expect(day("ביום שני ה־13.10.26")).toBe("ERR:weekday_mismatch");
    const r = resolveHebrewDate("ביום שני 13.10.26", NOW, TZ);
    expect(!r.ok && r.message).toContain("יום שלישי");
    expect(day("31.2.26")).toBe("ERR:invalid");
    expect(day("1.11")).toBe("2025-11-01"); // no year, past action → last year's
  });
  it("never backdates into the future, never schedules into the past; unknown phrases are asked about", () => {
    expect(day("מחר")).toBe("ERR:future");
    expect(day("20.10.26")).toBe("ERR:future");
    expect(day("אתמול", "future")).toBe("ERR:past");
    expect(day("בעוד שבוע", "future")).toBe("2026-10-25");
    expect(day("מחר", "future")).toBe("2026-10-19");
    expect(day("כשהיה חם")).toBe("ERR:unknown");
  });
  it("the local day, not UTC: 01:30 in Israel is already the next day", () => {
    const lateUtc = Date.UTC(2026, 9, 17, 22, 30); // 18.10 01:30 IDT
    expect(day("היום", "past", lateUtc)).toBe("2026-10-18");
    expect(day("אתמול", "past", lateUtc)).toBe("2026-10-17");
    // A user in New York at the same instant is still on the 17th.
    expect((resolveHebrewDate("היום", lateUtc, "America/New_York") as { day: string }).day).toBe("2026-10-17");
  });
  it("stored instants: now for today, local noon for earlier days, 08:00 for reminders", () => {
    expect(occurredAtFor("2026-10-18", NOW, TZ)).toEqual({ occurredAt: new Date(NOW).toISOString(), precision: "exact" });
    expect(occurredAtFor("2026-10-13", NOW, TZ)).toEqual({ occurredAt: "2026-10-13T09:00:00.000Z", precision: "day" });
    expect(dueAtFor("2026-10-25", TZ)).toBe("2026-10-25T06:00:00.000Z"); // DST has ended that night (IST +2)
    expect(dueAtFor("2026-10-20", TZ)).toBe("2026-10-20T05:00:00.000Z"); // IDT +3
    expect(safeTz("Not/AZone")).toBe(TZ);
    expect(safeTz("Europe/London")).toBe("Europe/London");
  });
});

const P = (id: string, commonName: string, o: Partial<PlantLite> = {}): PlantLite => ({ id, commonName, scientificName: "", ordinal: 1, status: "plant", locationId: null, nickname: null, ...o });
const PLANTS: PlantLite[] = [
  P("m1", "מונסטרה", { scientificName: "Monstera deliciosa", locationId: "salon" }),
  P("m2", "מונסטרה", { scientificName: "Monstera deliciosa", ordinal: 2, nickname: "מוצי", locationId: "balcony" }),
  P("po", "פוטוס", { scientificName: "Epipremnum aureum", locationId: "balcony" }),
  P("cut", "פוטוס", { scientificName: "Epipremnum aureum", ordinal: 2, status: "rooting" }),
  P("fi", "פיקוס כינורי", { scientificName: "Ficus lyrata" }),
];

describe("personal plant matching (deterministic, Hebrew-aware)", () => {
  it("prefixes and plurals: המונסטרה / למונסטרה / המונסטרות all mean Monstera", () => {
    for (const ref of ["המונסטרה", "למונסטרה", "את המונסטרה", "המונסטרות", "monstera"]) {
      expect(matchPlants(ref, PLANTS).all.map((p) => p.id).sort(), ref).toEqual(["m1", "m2"]);
    }
  });
  it("a nickname picks exactly one plant even when it shares the species", () => {
    expect(matchPlants("מוצי", PLANTS).exactNickname.map((p) => p.id)).toEqual(["m2"]);
    expect(matchPlants("את מוצי", PLANTS).all.map((p) => p.id)).toEqual(["m2"]);
  });
  it("duplicate species stay distinguishable by number; partial common names match", () => {
    expect(matchPlants("פוטוס 2", PLANTS).all.map((p) => p.id)).toEqual(["cut"]);
    expect(matchPlants("הפיקוס", PLANTS).all.map((p) => p.id)).toEqual(["fi"]);
    expect(matchPlants("הבזיליקום", PLANTS).all).toEqual([]);
  });
  it("locations with prefixes", () => {
    const L = [{ id: "balcony", name: "מרפסת" }, { id: "salon", name: "סלון" }, { id: "k", name: "חלון המטבח" }];
    expect(matchLocations("במרפסת", L).map((l) => l.id)).toEqual(["balcony"]);
    expect(matchLocations("לסלון", L).map((l) => l.id)).toEqual(["salon"]);
    expect(matchLocations("המטבח", L).map((l) => l.id)).toEqual(["k"]);
  });
});

describe("treatment safety", () => {
  it("Confidor against spider mites: warns it is usually ineffective/may worsen, offers an inspection only, never a dose", () => {
    const s = treatmentSafety({ product: "קונפידור", pest: "אקריות", hasOutdoor: true, hasPets: true });
    expect(s.prod?.active).toContain("imidacloprid");
    expect(s.pest?.kind).toBe("mite");
    const all = s.warnings.join(" ");
    expect(all).toContain("לא יעיל");
    expect(all).toContain("להחמיר");
    expect(all).toContain("דבורים");
    expect(all).toContain("חיות מחמד");
    expect(all).toContain("התווית");
    expect(all).not.toMatch(/\d+\s*(?:מ"ל|מל|גרם|ml|g)\b/); // no invented dosage
    expect(s.followText).toContain("בדיקה");
    expect(s.followText).not.toMatch(/ריסוס|לרסס/);
  });
  it("a reminder to spray again becomes a reminder to inspect and decide by the label", () => {
    const r = safeReminderText("לרסס שוב בקונפידור", "אקריות");
    expect(r.changed).toBe(true);
    expect(r.text).toContain("לבדוק");
    expect(r.text).not.toContain("לרסס");
    expect(safeReminderText("לבדוק את השורשים").changed).toBe(false);
  });
  it("same-problem detection for reusing a health case", () => {
    expect(samePest("אקריות", pestInfo("spider mites")!)).toBe(true);
    expect(samePest("קרדית עכביש אדום", pestInfo("אקריות")!)).toBe(true);
    expect(samePest("כנימה קמחית", pestInfo("אקריות")!)).toBe(false);
  });
});

describe("model output is validated against an allowlist", () => {
  it("unknown actions / keys / scopes are dropped, never executed", () => {
    const q = sanitizeParsed({ intent: "delete_everything", action: "drop_table", scope: "users", plants: [{ text: "x", keys: ["p1", "'; DROP", "u9"], all_matching: "yes" }], location_key: "../l1" });
    expect(q.intent).toBe("chat");
    expect(q.action).toBe("none");
    expect(q.scope).toBe("none");
    expect(q.plants[0].keys).toEqual(["p1"]);
    expect(q.plants[0].all_matching).toBe(false);
    expect(q.location_key).toBeNull();
    expect(sanitizeParsed(null).intent).toBe("chat");
  });
  it("summary question", () => {
    const t = proposalQuestion({ action: "water", scopeLabel: "מצאתי 8 צמחים במרפסת", dateLabel: "היום · יום ראשון, 18.10.2026", details: {}, targets: Array.from({ length: 8 }, (_, i) => ({ plantId: `p${i}`, name: `צמח ${i}`, selected: true })) });
    expect(t).toBe("מצאתי 8 צמחים במרפסת. לשמור השקיה ל־8 הצמחים — היום?");
  });
});
