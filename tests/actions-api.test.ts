// AI Botanist actions end to end against the real Worker (Miniflare/workerd, local D1) with a mocked model:
// the mocked parser only returns the STRUCTURE Claude would return; everything else — which plants, dates,
// duplicates, safety, confirmation, idempotency, chunking, isolation — is the real server code.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDaysToDay, isoDay, localParts, type ActionProposal } from "../src/shared/actions.ts";
import { todayTasks } from "../src/shared/domain.ts";
import type { Plant, PlantEvent, Reminder } from "../src/shared/types.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness } from "./helpers/worker.ts";

let h: Harness;
const TZ = "Asia/Jerusalem";
const today = () => isoDay(localParts(Date.now(), TZ));
let n = 0;
const person = (tag: string) => ({ sub: `cccccccc-${String(++n).padStart(4, "0")}-4000-8000-0000000000${tag}`, email: n === 1 ? OWNER_EMAIL : `actions-${tag}-${n}@example.test` });

type Rec = { entity: string; id: string; data: Record<string, unknown> };
async function seed(c: Client, extra: Record<string, unknown>[] = []) {
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  await c.push([
    mut("profile", "me", { id: "me", onboardingDone: true, pets: [{ id: "cat1", kind: "cat" }], interests: [], places: [], help: {}, onboardingStep: 6 }),
    mut("location", "bal", { id: "bal", name: "מרפסת", kind: "outdoor", createdAt: day(60) }),
    mut("location", "salon", { id: "salon", name: "סלון", kind: "indoor", createdAt: day(60) }),
    mut("plant", "m1", { id: "m1", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 1, locationId: "salon", createdAt: day(50) }),
    mut("plant", "m2", { id: "m2", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 2, nickname: "מוצי", locationId: "bal", createdAt: day(50) }),
    mut("plant", "po", { id: "po", commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "plant", ordinal: 1, locationId: "bal", createdAt: day(50) }),
  ]);
  await c.push([
    mut("plant", "cut", { id: "cut", commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "rooting", ordinal: 2, locationId: null, createdAt: day(20) }),
    mut("plant", "fi", { id: "fi", commonName: "פיקוס כינורי", scientificName: "Ficus lyrata", status: "plant", ordinal: 1, locationId: "bal", createdAt: day(50) }),
    mut("plant", "arch", { id: "arch", commonName: "קקטוס", status: "plant", ordinal: 1, locationId: "bal", archivedAt: day(5), createdAt: day(50) }),
    mut("plant", "gone", { id: "gone", commonName: "בזיליקום", status: "plant", ordinal: 1, locationId: "bal", deletedAt: day(5), createdAt: day(50) }),
    mut("wishlist", "w1", { id: "w1", speciesId: "monstera-deliciosa", createdAt: day(5) }),
    ...extra.map((x) => mut(String(x.entity), String(x.id), x.patch as Record<string, unknown>)),
  ]);
}
const ACTIVE = ["m1", "m2", "po", "cut", "fi"];

/** Prompt lines "p3 | מוצי | ..." → key of a name (as the model would answer). */
const keyOf = (prompt: string, name: string) => new RegExp(`(p\\d+) \\| ${name} \\|`).exec(prompt.replace(/\\n/g, "\n"))?.[1] ?? "p0";

type Ev = { event: string; data: Record<string, unknown> };
async function say(c: Client, chatId: string, text: string, plantId: string | null = null) {
  const messageId = randomUUID();
  const r = await c.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, messageId, plantId, text, tz: TZ }) });
  if (!r.ok) return { status: r.status, error: ((await r.json()) as { error: string }).error, text: "", events: [] as Ev[], messageId, answerId: `${messageId}-a` };
  const events: Ev[] = (await r.text()).split("\n\n").filter((b) => b.trim()).map((b) => ({ event: /^event: (.+)$/m.exec(b)?.[1] ?? "", data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "{}") }));
  await new Promise((res) => setTimeout(res, 60));
  return { status: r.status, error: null, text: events.filter((e) => e.event === "delta").map((e) => e.data.t).join(""), events, messageId, answerId: `${messageId}-a` };
}
const records = async (c: Client) => (await c.pullAll()) as Rec[];
const msg = async (c: Client, id: string) => (await records(c)).find((r) => r.entity === "message" && r.id === id)?.data as { text: string; proposal?: ActionProposal; clarify?: unknown } | undefined;
const card = async (c: Client, id: string) => (await msg(c, id))!.proposal!;
const exec = (c: Client, body: Record<string, unknown>) => c.req("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** Confirms like the app does: first call with the selection, then continue until nothing remains. */
async function confirm(c: Client, p: ActionProposal, plantIds = p.targets.filter((t) => t.selected).map((t) => t.plantId), followUp = false) {
  let r = await exec(c, { messageId: p.id, revision: p.revision, plantIds, followUp });
  let body = (await r.json()) as { status: string; remaining: number; message: string | null; failures: { plantId: string }[]; results: Record<string, string>; error?: string };
  let calls = 1;
  while (r.ok && body.remaining > 0 && calls < 40) {
    r = await exec(c, { messageId: p.id, revision: p.revision });
    body = await r.json() as typeof body;
    calls++;
  }
  return { ...body, http: r.status, calls };
}
const events = async (c: Client, type?: string) => (await records(c)).filter((r) => r.entity === "event" && (!type || r.data.type === type)).map((r) => r.data as unknown as PlantEvent);

beforeAll(async () => { h = await startWorker({ anthropicKey: true }); }, 120_000);
afterAll(async () => { await h?.mf.dispose(); });

describe("one plant, several named plants, ambiguity and clarification", () => {
  let A: Client;
  const chatId = randomUUID();
  beforeAll(async () => { A = await Client.signIn(h, person("a1")); await seed(A); });

  it("one plant by nickname, backdated 'אתמול': card first, nothing written until confirmed", async () => {
    h.actionParse = (prompt) => ({ intent: "new_action", action: "water", scope: "named", plants: [{ text: "מוצי", keys: [keyOf(prompt, "מוצי")], all_matching: false }], date_text: "אתמול" });
    const r = await say(A, chatId, "השקיתי את מוצי אתמול");
    expect(r.status).toBe(200);
    expect(r.text).toContain("מוצי");
    expect(r.text).toContain("אתמול");
    const p = await card(A, r.answerId);
    expect(p.status).toBe("pending");
    expect(p.targets.map((t) => t.plantId)).toEqual(["m2"]);
    expect(p.day).toBe(addDaysToDay(today(), -1));
    expect(await events(A, "watering")).toHaveLength(0); // never silently modified
    const res = await confirm(A, p);
    expect(res.http).toBe(200);
    expect(res.message).toBe("מוצי עודכן בהצלחה 🌱");
    const w = await events(A, "watering");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ plantId: "m2", source: "ai_confirmed", precision: "day", inHistory: true });
    expect(isoDay(localParts(Date.parse(w[0].occurredAt), TZ))).toBe(addDaysToDay(today(), -1));
    expect((await msg(A, `${p.id}-r`))!.text).toBe("מוצי עודכן בהצלחה 🌱");
    expect((await card(A, r.answerId)).status).toBe("done");
  });

  it("ambiguous name → a short question; the answer completes the original request (several named plants)", async () => {
    h.actionParse = (prompt) => ({ intent: "new_action", action: "fertilize", scope: "named", date_text: "אתמול",
      plants: [{ text: "המונסטרה", keys: [keyOf(prompt, "מונסטרה"), keyOf(prompt, "מוצי")], all_matching: false }, { text: "הפוטוס", keys: [keyOf(prompt, "פוטוס")], all_matching: false }] });
    const q = await say(A, chatId, "דישנתי את המונסטרה והפוטוס אתמול");
    expect(q.text).toContain("2 צמחים");
    expect(q.text).toContain("מוצי");
    expect((await msg(A, q.answerId))!.proposal ?? null).toBeNull();
    let sawContext = false;
    h.actionParse = (prompt) => {
      sawContext = prompt.includes("הבוטנאית שאלה") && prompt.includes("דישנתי את המונסטרה והפוטוס אתמול");
      return { intent: "new_action", action: "fertilize", scope: "named", date_text: "אתמול",
        plants: [{ text: "המונסטרות", keys: [keyOf(prompt, "מונסטרה"), keyOf(prompt, "מוצי")], all_matching: true }, { text: "הפוטוס", keys: [keyOf(prompt, "פוטוס")], all_matching: false }] };
    };
    const r = await say(A, chatId, "לשתיהן");
    expect(sawContext).toBe(true);
    const p = await card(A, r.answerId);
    expect(p.action).toBe("fertilize");
    expect(p.targets.map((t) => t.plantId).sort()).toEqual(["m1", "m2", "po"]);
    const res = await confirm(A, p);
    expect(res.message).toBe("עודכנו 3 צמחים בהצלחה 🌱");
    expect((await events(A, "fertilizing")).map((e) => e.plantId).sort()).toEqual(["m1", "m2", "po"]);
  });

  it("unknown name, future date and contradicting weekday are asked about, not guessed", async () => {
    h.actionParse = { action: "water", scope: "named", plants: [{ text: "הבזיליקום", keys: [], all_matching: false }] };
    expect((await say(A, chatId, "השקיתי את הבזיליקום")).text).toContain("לא מצאתי");
    h.actionParse = { action: "water", scope: "all", date_text: "מחר" };
    expect((await say(A, chatId, "השקיתי את כל הצמחים מחר")).text).toContain("עוד לא הגיע");
    h.actionParse = { action: "water", scope: "all", date_text: "ביום שני ה־13.10.26" };
    expect((await say(A, chatId, "השקיתי ביום שני ה־13.10.26")).text).toContain("יום שלישי");
    h.actionParse = { action: "soil_check", scope: "all", soil: "none" };
    expect((await say(A, chatId, "בדקתי את כל הצמחים")).text).toContain("מה היה מצב האדמה");
  });

  it("a plain question does not call the action parser (no extra latency)", async () => {
    h.anthropic.length = 0;
    h.chatReply = { text: "בודקים את האדמה קודם." };
    await say(A, randomUUID(), "מתי להשקות את המונסטרה?");
    expect(h.anthropic.length).toBe(1);
    expect(h.anthropic[0].body.stream).toBe(true);
  });
});

describe("bulk watering: all / location / exclusions / corrections / duplicates / idempotency", () => {
  let A: Client;
  const chatId = randomUUID();
  beforeAll(async () => { A = await Client.signIn(h, person("a2")); await seed(A); });

  it("all plants in a location (archived, deleted, wishlist never included); 'לא לפוטוס' → 'נשארו 2'; old card closed", async () => {
    h.actionParse = { action: "water", scope: "location", location_text: "במרפסת" };
    const r = await say(A, chatId, "השקיתי את כל הצמחים במרפסת");
    expect(r.text).toBe("מצאתי 3 צמחים במרפסת. לשמור השקיה ל־3 הצמחים — היום?");
    const p1 = await card(A, r.answerId);
    expect(p1.targets.map((t) => t.plantId).sort()).toEqual(["fi", "m2", "po"]);
    h.actionParse = (prompt) => ({ intent: "modify_pending", exclude: [{ text: "הפוטוס", keys: [keyOf(prompt, "פוטוס")], all_matching: false }] });
    const r2 = await say(A, chatId, "לא לפוטוס");
    expect(r2.text).toContain("בסדר, נשארו 2 צמחים.");
    expect(r2.text).toContain("לשמור");
    const p2 = await card(A, r2.answerId);
    expect(p2.revision).toBe(2);
    expect(p2.targets.find((t) => t.plantId === "po")).toMatchObject({ selected: false, note: "excluded" });
    expect((await card(A, r.answerId)).status).toBe("superseded");
    expect((await exec(A, { messageId: p1.id, revision: 1, plantIds: ["po"] })).status).toBe(409); // closed card
    expect((await exec(A, { messageId: p2.id, revision: 1, plantIds: ["fi"] })).status).toBe(409); // wrong revision
    const res = await confirm(A, p2);
    expect(res.message).toBe("עודכנו 2 צמחים בהצלחה 🌱");
    expect((await events(A, "watering")).map((e) => e.plantId).sort()).toEqual(["fi", "m2"]);
  });

  it("all plants: the ones already watered today are flagged and unselected (no silent duplicates)", async () => {
    h.actionParse = { action: "water", scope: "all", exclude: [{ text: "חוץ מהמונסטרה", keys: [], all_matching: false }] };
    const r = await say(A, chatId, "השקיתי את כל הצמחים חוץ מהמונסטרה");
    const p = await card(A, r.answerId);
    expect(p.targets.map((t) => t.plantId).sort()).toEqual([...ACTIVE].sort());
    const sel = (id: string) => p.targets.find((t) => t.plantId === id)!;
    expect(sel("fi")).toMatchObject({ selected: false, note: "already_recorded" });
    expect(sel("m2").selected).toBe(false); // already watered today AND a Monstera
    expect(sel("m1")).toMatchObject({ selected: false, note: "excluded" });
    expect(r.text).toContain("כבר רשום");
    const res = await confirm(A, p);
    expect(res.message).toBe("עודכנו 2 צמחים בהצלחה 🌱"); // po + cut
    // Confirm again (double tap, retry after a lost response): same result, nothing written twice.
    const again = await confirm(A, p);
    expect(again.http).toBe(200);
    expect(again.message).toBe(res.message);
    const w = await events(A, "watering");
    expect(w.map((e) => e.plantId).sort()).toEqual(["cut", "fi", "m2", "po"]);
  });

  it("two confirms at the same time write each record once", async () => {
    h.actionParse = { action: "fertilize", scope: "all" };
    const p = await card(A, (await say(A, chatId, "דישנתי את כל הצמחים")).answerId);
    const ids = p.targets.map((t) => t.plantId);
    const [a, b] = await Promise.all([exec(A, { messageId: p.id, revision: p.revision, plantIds: ids }), exec(A, { messageId: p.id, revision: p.revision, plantIds: ids })]);
    expect([a.status, b.status].every((s) => s === 200 || s === 409)).toBe(true);
    await confirm(A, { ...(await card(A, p.id)) });
    const f = await events(A, "fertilizing");
    expect(f.map((e) => e.plantId).sort()).toEqual([...ids].sort());
  });

  it("only plants of the confirmed card can be written; selection cannot be widened", async () => {
    h.actionParse = { action: "water", scope: "location", location_text: "סלון", date_text: "שלשום" };
    const p = await card(A, (await say(A, chatId, "השקיתי את הצמחים בסלון שלשום")).answerId);
    expect(p.targets.map((t) => t.plantId)).toEqual(["m1"]);
    const bad = await exec(A, { messageId: p.id, revision: p.revision, plantIds: ["m1", "po"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("plant_not_in_proposal");
    expect((await exec(A, { messageId: p.id, revision: p.revision, plantIds: [] })).status).toBe(400);
  });

  it("cancel (button and typed) closes the card and writes nothing", async () => {
    h.actionParse = { action: "water", scope: "location", location_text: "סלון", date_text: "אתמול" };
    const r = await say(A, chatId, "השקיתי את הצמחים בסלון אתמול");
    const before = (await events(A)).length;
    const c = await A.req("/api/v1/actions/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: r.answerId }) });
    expect(c.status).toBe(200);
    expect((await card(A, r.answerId)).status).toBe("cancelled");
    expect((await msg(A, `${r.answerId}-r`))!.text).toContain("לא נשמר");
    expect((await exec(A, { messageId: r.answerId, revision: 1, plantIds: ["m1"] })).status).toBe(409);
    h.actionParse = { action: "water", scope: "location", location_text: "סלון", date_text: "אתמול" };
    const r2 = await say(A, chatId, "השקיתי את הצמחים בסלון אתמול");
    h.actionParse = { intent: "cancel_pending" };
    const r3 = await say(A, chatId, "בעצם בטלי");
    expect(r3.text).toBe("ביטלתי — לא נשמר דבר.");
    expect((await card(A, r2.answerId)).status).toBe("cancelled");
    expect((await events(A)).length).toBe(before);
  });

  it("a typed 'כן' points to the button (execution only by explicit confirmation of the card)", async () => {
    h.actionParse = { action: "water", scope: "named", plants: [{ text: "פיקוס", keys: [], all_matching: false }], date_text: "שלשום" };
    const r = await say(A, chatId, "השקיתי את הפיקוס שלשום");
    h.actionParse = { intent: "confirm_pending" };
    const before = (await events(A)).length;
    const r2 = await say(A, chatId, "כן");
    expect(r2.text).toContain("אישור ושמירה");
    expect((await card(A, r.answerId)).status).toBe("superseded");
    expect((await card(A, r2.answerId)).status).toBe("pending");
    expect((await events(A)).length).toBe(before);
  });

  it("a question while a card is pending gets a normal answer and leaves the card pending", async () => {
    h.actionParse = { action: "water", scope: "all", date_text: "שלשום" };
    const r = await say(A, chatId, "השקיתי את כל הצמחים שלשום");
    h.actionParse = { intent: "chat" };
    h.chatReply = { text: "כן, אפשר." };
    const r2 = await say(A, chatId, "אגב, אפשר להשקות במים מהברז?");
    expect(r2.text).toBe("כן, אפשר.");
    expect((await card(A, r.answerId)).status).toBe("pending");
  });
});

describe("treatments, health cases, follow-ups, reminders, soil checks and moves", () => {
  let A: Client;
  const chatId = randomUUID();
  beforeAll(async () => {
    A = await Client.signIn(h, person("a3"));
    await seed(A, [{ entity: "health", id: "hc-fi", patch: { id: "hc-fi", plantId: "fi", title: "אקריות", state: "active", source: "ai", openedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), createdAt: new Date().toISOString() } }]);
  });

  it("'טיפלתי בכל הצמחים נגד אקריות עם קונפידור ב־13.10.26': preview with product, pest, date and safety; health cases reused; inspection follow-up only", async () => {
    h.actionParse = { action: "treatment", scope: "all", pest: "אקריות", product: "קונפידור", date_text: "ב־13.10.26", already_done: true };
    const r = await say(A, chatId, "טיפלתי בכל הצמחים נגד אקריות עם קונפידור ב־13.10.26");
    const p = await card(A, r.answerId);
    expect(p.action).toBe("treatment");
    expect(p.day).toBe("2026-10-13");
    expect(p.dateLabel).toContain("שלישי");
    expect(p.details).toMatchObject({ product: "קונפידור", pest: "אקריות", reportedBy: "user" });
    expect(p.details.productActive).toContain("imidacloprid");
    const w = p.warnings.join(" ");
    expect(w).toContain("לא יעיל");
    expect(w).toContain("דבורים"); // balcony is outdoor
    expect(w).toContain("חיות מחמד");
    expect(r.text).toContain("⚠️");
    expect(p.followUp?.text).toContain("בדיקה");
    expect(p.followUp?.text).not.toMatch(/ריסוס|לרסס/);
    expect(Date.parse(p.followUp!.dueAt)).toBeGreaterThan(Date.now()); // never in the past
    expect((await records(A)).filter((x) => x.entity === "health")).toHaveLength(1); // nothing yet

    const res = await confirm(A, p, ACTIVE, true);
    expect(res.calls).toBeGreaterThan(1); // chunked (D1 Free plan query budget per request)
    expect(res.message).toContain("עודכנו 5 צמחים בהצלחה 🌱");
    expect(res.message).toContain("תזכורת לבדיקה");
    const all = await records(A);
    const cases = all.filter((x) => x.entity === "health").map((x) => x.data);
    expect(cases.filter((c) => c.plantId === "fi")).toHaveLength(1); // reused, not duplicated
    expect(cases.filter((c) => c.plantId !== "fi").every((c) => c.source === "user" && c.state === "active" && c.title === "אקריות")).toBe(true);
    expect(cases).toHaveLength(5);
    const tr = all.filter((x) => x.entity === "event" && x.data.type === "treatment_started").map((x) => x.data as unknown as PlantEvent);
    expect(tr).toHaveLength(5);
    for (const e of tr) {
      expect(e.payload).toMatchObject({ product: "קונפידור", pest: "אקריות", reportedBy: "user", verified: false });
      expect(cases.some((c) => c.id === e.payload.healthCaseId && c.plantId === e.plantId)).toBe(true);
      expect(isoDay(localParts(Date.parse(e.occurredAt), TZ))).toBe("2026-10-13");
    }
    expect(tr.find((e) => e.plantId === "fi")!.payload.healthCaseId).toBe("hc-fi");
    const rem = all.filter((x) => x.entity === "reminder").map((x) => x.data as unknown as Reminder);
    expect(rem).toHaveLength(5);
    expect(rem.every((x) => x.kind === "inspect" && !x.everyDays && !/לרסס|ריסוס/.test(x.text))).toBe(true);
    // Today shows them when due (existing reminder system).
    const plants = all.filter((x) => x.entity === "plant").map((x) => x.data as unknown as Plant);
    const tasks = todayTasks(plants, [], rem, () => undefined, Date.parse(rem[0].nextAt) + 3_600_000);
    expect(tasks.filter((t) => t.kind === "reminder")).toHaveLength(5);
    // Repeating the same report the same day is flagged as a duplicate.
    h.actionParse = { action: "treatment", scope: "all", pest: "אקריות", product: "קונפידור", date_text: "13.10.26", already_done: true };
    const dup = await card(A, (await say(A, chatId, "טיפלתי בכל הצמחים נגד אקריות עם קונפידור ב־13.10.26")).answerId);
    expect(dup.targets.every((t) => !t.selected && t.note === "already_recorded")).toBe(true);
  });

  it("a requested repeat-pesticide reminder becomes an inspection reminder; seedlings/cuttings by status; due in the user's time zone", async () => {
    h.actionParse = { action: "reminder", scope: "all", reminder_text: "לרסס שוב בקונפידור", reminder_due_text: "בעוד שבוע", pest: "אקריות" };
    const p = await card(A, (await say(A, chatId, "תזכירי לי לרסס שוב את כל הצמחים בקונפידור בעוד שבוע")).answerId);
    expect(p.details.reminderText).toContain("לבדוק");
    expect(p.details.reminderText).not.toContain("לרסס");
    expect(p.warnings.join(" ")).toContain("לא קובעים חזרה על ריסוס");
    await A.req("/api/v1/actions/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: p.id }) });

    h.actionParse = { action: "reminder", scope: "status", status_filter: "rooting", reminder_text: "לבדוק את השורשים", reminder_due_text: "בעוד שבוע" };
    const r = await say(A, chatId, "תזכירי לי לבדוק את השורשים של כל הייחורים בעוד שבוע");
    const p2 = await card(A, r.answerId);
    expect(p2.targets.map((t) => t.plantId)).toEqual(["cut"]);
    expect(p2.day).toBe(addDaysToDay(today(), 7));
    const res = await confirm(A, p2);
    expect(res.message).toContain("עודכן בהצלחה");
    expect(res.message).toContain("'היום'");
    const rem = (await records(A)).filter((x) => x.entity === "reminder" && x.data.plantId === "cut" && x.data.kind === "inspect" && String(x.data.text).includes("שורשים"));
    expect(rem).toHaveLength(1);
    const at = localParts(Date.parse(String(rem[0].data.nextAt)), TZ);
    expect(isoDay(at)).toBe(addDaysToDay(today(), 7));
    expect(at.h).toBe(8);
  });

  it("'כל הצמחים במרפסת נבדקו היום והאדמה עדיין לחה' → soil checks only (never a watering, never 'dry')", async () => {
    h.actionParse = { action: "soil_check", scope: "location", location_text: "במרפסת", soil: "slightly_moist", date_text: "היום" };
    const p = await card(A, (await say(A, chatId, "כל הצמחים במרפסת נבדקו היום והאדמה עדיין לחה")).answerId);
    const before = (await events(A, "watering")).length;
    await confirm(A, p);
    const sc = await events(A, "soil_check");
    expect(sc.map((e) => e.plantId).sort()).toEqual(["fi", "m2", "po"]);
    expect(sc.every((e) => e.payload.result === "slightly_moist" && e.payload.watered === false)).toBe(true);
    expect((await events(A, "watering")).length).toBe(before);
  });

  it("'העברתי את מוצי לסלון' → the plant's location + a location_changed event (like a manual move)", async () => {
    h.actionParse = (prompt) => ({ action: "move", scope: "named", plants: [{ text: "מוצי", keys: [keyOf(prompt, "מוצי")], all_matching: false }], move_to_text: "לסלון" });
    const p = await card(A, (await say(A, chatId, "העברתי את מוצי לסלון")).answerId);
    expect(p.details.toLocationName).toBe("סלון");
    await confirm(A, p);
    const all = await records(A);
    expect(all.find((x) => x.entity === "plant" && x.id === "m2")!.data.locationId).toBe("salon");
    const mv = all.filter((x) => x.entity === "event" && x.data.type === "location_changed").map((x) => x.data.payload);
    expect(mv).toEqual([{ from: "bal", to: "salon", via: "ai_chat" }]);
  });

  it("partial failure: a plant removed before confirming is reported per plant; the rest is saved", async () => {
    h.actionParse = { action: "fertilize", scope: "location", location_text: "מרפסת", date_text: "אתמול" };
    const p = await card(A, (await say(A, chatId, "דישנתי את הצמחים במרפסת אתמול")).answerId);
    expect(p.targets.map((t) => t.plantId).sort()).toEqual(["fi", "po"]); // מוצי moved to the living room
    await A.push([mut("plant", "po", { archivedAt: new Date().toISOString() }, 2 ** 31)]);
    const res = await confirm(A, p);
    expect(res.http).toBe(200);
    expect(res.failures.map((f) => f.plantId)).toEqual(["po"]);
    expect(res.message).toContain("עודכנו 1 מתוך 2");
    expect(res.message).toContain("פוטוס");
    expect((await card(A, p.id)).status).toBe("partial");
    const f = await events(A, "fertilizing");
    expect(f.map((e) => e.plantId)).toEqual(["fi"]);
  });
});

describe("isolation between users", () => {
  let A: Client, B: Client;
  const chatA = randomUUID(), chatB = randomUUID();
  beforeAll(async () => {
    A = await Client.signIn(h, person("a4"));
    B = await Client.signIn(h, person("b4"));
    await seed(A);
    await B.push([
      mut("location", "bal", { id: "bal", name: "מרפסת", kind: "outdoor" }),
      mut("plant", "b-only", { id: "b-only", commonName: "צמח סודי של בי", status: "plant", ordinal: 1, locationId: "bal" }),
    ]);
  });

  it("the parser sees only the caller's own plants; targets resolve only to own plants", async () => {
    h.actionParse = { action: "water", scope: "location", location_text: "מרפסת" };
    h.anthropic.length = 0;
    const rb = await say(B, chatB, "השקיתי את כל הצמחים במרפסת");
    const prompt = JSON.stringify(h.anthropic[0].body.messages);
    expect(prompt).toContain("צמח סודי של בי");
    expect(prompt).not.toContain("מוצי");
    expect(prompt).not.toContain("פיקוס");
    const pb = await card(B, rb.answerId);
    expect(pb.targets.map((t) => t.plantId)).toEqual(["b-only"]);
    h.anthropic.length = 0;
    const ra = await say(A, chatA, "השקיתי את כל הצמחים במרפסת");
    expect(JSON.stringify(h.anthropic[0].body.messages)).not.toContain("צמח סודי של בי");
    const pa = await card(A, ra.answerId);
    expect(pa.targets.map((t) => t.plantId).sort()).toEqual(["fi", "m2", "po"]);

    // B cannot confirm, continue or cancel A's card (same answer as a missing one), nor widen its own to A's plants.
    for (const path of ["/api/v1/actions/execute", "/api/v1/actions/cancel"]) {
      const x = await B.req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: pa.id, revision: pa.revision, plantIds: ["fi"] }) });
      expect(x.status).toBe(404);
    }
    const wide = await exec(B, { messageId: pb.id, revision: pb.revision, plantIds: ["b-only", "fi"] });
    expect(wide.status).toBe(400);
    // A forged card cannot be pushed: messages are server-only records.
    const forged = await B.push([mut("message", "forged-a", { role: "assistant", chatId: chatB, proposal: { ...pb, targets: [{ plantId: "fi", name: "x", selected: true }] } })]);
    expect(forged.status).toBe(400);
    await confirm(B, pb);
    expect((await events(A, "watering"))).toHaveLength(0);
    expect((await events(B, "watering")).map((e) => e.plantId)).toEqual(["b-only"]);
  });
});
