// AI Botanist changes to EXISTING records (resolve / remove issue, delete, re-date, edit, cancel reminders, undo)
// against the real Worker (Miniflare, local D1) with a mocked parser that returns only the structure.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDaysToDay, appliedOf, isoDay, localParts, type ActionProposal } from "../src/shared/actions.ts";
import { needsCarePlantIds, soilCheckPlan, todayTasks } from "../src/shared/domain.ts";
import type { HealthCase, Plant, PlantEvent, Reminder } from "../src/shared/types.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness } from "./helpers/worker.ts";

let h: Harness;
const TZ = "Asia/Jerusalem";
const today = () => isoDay(localParts(Date.now(), TZ));
let n = 0;
const person = (tag: string) => ({ sub: `dddddddd-${String(++n).padStart(4, "0")}-4000-8000-0000000000${tag}`, email: n === 1 ? OWNER_EMAIL : `rec-${tag}-${n}@example.test` });
type Rec = { entity: string; id: string; data: Record<string, unknown>; rev: number };
const keyOf = (prompt: string, name: string) => new RegExp(`(p\\d+) \\| ${name} \\|`).exec(prompt.replace(/\\n/g, "\n"))?.[1] ?? "p0";
const SEEDLINGS = Array.from({ length: 8 }, (_, i) => `s${i + 1}`);
const OTHERS = ["m1", "m2", "po", "fi"];

async function say(c: Client, chatId: string, text: string, plantId: string | null = null) {
  const messageId = randomUUID();
  const r = await c.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, messageId, plantId, text, tz: TZ }) });
  const body = await r.text();
  const t = body.split("\n\n").filter((b) => /^event: delta/m.test(b)).map((b) => JSON.parse(/^data: (.+)$/m.exec(b)![1]).t).join("");
  return { status: r.status, text: t, answerId: `${messageId}-a` };
}
const records = async (c: Client) => (await c.pullAll()) as Rec[];
const msg = async (c: Client, id: string) => (await records(c)).find((r) => r.entity === "message" && r.id === id)?.data as { text: string; proposal?: ActionProposal | null; clarify?: unknown } | undefined;
const card = async (c: Client, id: string) => (await msg(c, id))!.proposal!;
const exec = (c: Client, body: Record<string, unknown>) => c.req("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function confirm(c: Client, p: ActionProposal, plantIds = p.targets.filter((t) => t.selected).map((t) => t.plantId), followUp = false) {
  let r = await exec(c, { messageId: p.id, revision: p.revision, plantIds, followUp });
  let body = (await r.json()) as { status: string; remaining: number; message: string | null; results: Record<string, string>; failures: { plantId: string; reason: string }[] };
  for (let i = 0; r.ok && body.remaining > 0 && i < 60; i++) { r = await exec(c, { messageId: p.id, revision: p.revision }); body = await r.json() as typeof body; }
  return { ...body, http: r.status };
}
const all = async (c: Client) => {
  const rs = await records(c);
  const of = <T>(e: string) => rs.filter((x) => x.entity === e).map((x) => x.data as unknown as T);
  return { rs, plants: of<Plant>("plant"), events: of<PlantEvent>("event"), cases: of<HealthCase>("health"), reminders: of<Reminder>("reminder") };
};

/** 8 seedlings + 4 other plants, then the confirmed bulk treatment (as on 2026-10-18) with follow-up inspections. */
async function seedWithTreatment(c: Client) {
  const at = new Date(Date.now() - 40 * 86_400_000).toISOString();
  await c.push([mut("profile", "me", { id: "me", onboardingDone: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6 })]);
  await c.push(SEEDLINGS.map((id, i) => mut("plant", id, { id, commonName: `עגבנייה ${i + 1}`, scientificName: "Solanum lycopersicum", status: "seedling", ordinal: 1, createdAt: at })));
  await c.push([
    mut("plant", "m1", { id: "m1", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 1, createdAt: at }),
    mut("plant", "m2", { id: "m2", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 2, nickname: "מוצי", createdAt: at }),
    mut("plant", "po", { id: "po", commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "plant", ordinal: 1, createdAt: at }),
    mut("plant", "fi", { id: "fi", commonName: "פיקוס", scientificName: "Ficus lyrata", status: "plant", ordinal: 1, createdAt: at }),
  ]);
  h.actionParse = { action: "treatment", scope: "all", pest: "אקריות", product: "קונפידור", date_text: "ב־13.10.26", already_done: true };
  const r = await say(c, randomUUID(), "טיפלתי בכל הצמחים נגד אקריות עם קונפידור ב־13.10.26");
  const p = await card(c, r.answerId);
  const res = await confirm(c, p, p.targets.map((t) => t.plantId), true);
  expect(res.message).toContain("עודכנו 12 צמחים בהצלחה");
  return p;
}

beforeAll(async () => { h = await startWorker({ anthropicKey: true }); }, 120_000);
afterAll(async () => { await h?.mf.dispose(); });

describe("'תורידי את האקריות מהשתילים' — the reported case: only seedlings, ask which meaning, then remove the wrong record", () => {
  let A: Client;
  const chatId = randomUUID();
  let removeCard: ActionProposal;
  beforeAll(async () => { A = await Client.signIn(h, person("a1")); await seedWithTreatment(A); });

  it("ambiguous removal → one short question with the real count; nothing changes", async () => {
    const plantData = async () => (await records(A)).filter((x) => ["event", "health", "reminder", "plant"].includes(x.entity)).map((x) => x.rev).sort().join();
    const before = await plantData();
    h.actionParse = { action: "remove_issue", scope: "status", status_filter: "seedling", pest: "אקריות", removal_meaning: "unclear" };
    const r = await say(A, chatId, "תורידי את האקריות מהשתילים");
    expect(r.text).toBe("מצאתי 8 שתילים עם רישום אקריות. לסמן שהחלימו, או למחוק את הרישום כי הוא היה שגוי?");
    expect((await msg(A, r.answerId))!.proposal ?? null).toBeNull();
    expect(await plantData()).toBe(before); // plant records untouched
  });

  it("'הרישום היה טעות' → card with exactly the 8 seedlings and their real records (treatment kept, inspection cancelled)", async () => {
    let sawContext = false;
    h.actionParse = (prompt) => { sawContext = prompt.includes("תורידי את האקריות מהשתילים"); return { action: "remove_issue", scope: "status", status_filter: "seedling", pest: "אקריות", removal_meaning: "erroneous" }; };
    const r = await say(A, chatId, "הרישום היה טעות");
    expect(sawContext).toBe(true);
    removeCard = await card(A, r.answerId);
    expect(removeCard.action).toBe("remove_issue");
    expect(removeCard.targets.map((t) => t.plantId).sort()).toEqual(SEEDLINGS);
    for (const t of removeCard.targets) {
      expect(t.records!.map((x) => `${x.entity}:${x.op}`).sort()).toEqual(["event:soft_delete", "event:unlink_pest", "health:soft_delete", "reminder:cancel"]);
    }
    expect(r.text).toContain("מצאתי רישומי אקריות ב־8 שתילים");
    expect(r.text).toContain("הטיפולים עצמם יישארו");
    expect(removeCard.warnings.join(" ")).toContain("אפשר לבטל");
  });

  it("exclude one seedling in the chat, confirm → 7 records sets changed; History/Journal/Sick/Today/AI context follow; idempotent", async () => {
    h.actionParse = (prompt) => ({ intent: "modify_pending", exclude: [{ text: "עגבנייה 8", keys: [keyOf(prompt, "עגבנייה 8")], all_matching: false }] });
    const r = await say(A, chatId, "חוץ מעגבנייה 8");
    expect(r.text).toContain("בסדר, נשארו 7 צמחים.");
    const p = await card(A, r.answerId);
    const res = await confirm(A, p);
    expect(res.http).toBe(200);
    expect(res.message).toBe("הרישום השגוי הוסר ב־7 צמחים. הטיפולים נשארו. אפשר לבטל: \"תבטלי את מה שעשית\".");
    const d = await all(A);
    const seven = SEEDLINGS.slice(0, 7);
    // Health case: soft-deleted (still in D1 for audit), not resolved.
    for (const id of seven) {
      const c = d.cases.find((x) => x.plantId === id)!;
      expect(c.deletedAt).toBeTruthy();
      expect((c as unknown as { deletedBy: string }).deletedBy).toBe("ai_chat");
      const t = d.events.find((e) => e.plantId === id && e.type === "treatment_started")!;
      expect(t.deletedAt ?? null).toBeNull(); // the real treatment stays
      expect(t.payload).toMatchObject({ pest: null, healthCaseId: null, pestCorrected: "אקריות", product: "קונפידור", title: "טיפול בקונפידור" });
      expect(d.events.find((e) => e.plantId === id && e.type === "diagnosis")!.deletedAt).toBeTruthy();
      expect(d.reminders.find((x) => x.plantId === id)!.active).toBe(false);
    }
    // s8 (excluded) and the non-seedlings are untouched.
    expect(d.cases.find((x) => x.plantId === "s8")!.deletedAt ?? null).toBeNull();
    expect(d.cases.filter((x) => OTHERS.includes(x.plantId)).every((x) => !x.deletedAt && x.state === "active")).toBe(true);
    // Sick plants (derived from live cases), Today (active reminders).
    const live = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);
    expect([...needsCarePlantIds(d.plants, live(d.cases))].sort()).toEqual(["fi", "m1", "m2", "po", "s8"]);
    const tasks = todayTasks(d.plants, [], live(d.reminders), () => undefined, Date.parse("2026-10-21T09:00:00Z")).filter((t) => t.kind === "reminder");
    expect(tasks.map((t) => t.plantId).sort()).toEqual(["fi", "m1", "m2", "po", "s8"]);
    // AI context for a cleaned seedling: no spider-mite case, the treatment without the pest.
    h.chatReply = { text: "ok" };
    h.anthropic.length = 0;
    await say(A, randomUUID(), "מה המצב שלה?", "s1");
    const turn = JSON.stringify(h.anthropic.at(-1)!.body.messages);
    expect(turn).toContain("קונפידור");
    expect(turn).not.toContain("healthCases");
    expect(turn).not.toMatch(/"pest":"אקריות"/);
    // Confirming again changes nothing.
    const plantRevs = async () => (await records(A)).filter((x) => ["event", "health", "reminder", "plant"].includes(x.entity)).map((x) => `${x.id}:${x.rev}`).sort().join();
    const revs = await plantRevs();
    const again = await confirm(A, p);
    expect(again.message).toBe(res.message);
    expect(await plantRevs()).toBe(revs);
  });

  it("'תבטלי את מה שעשית' → undo card for exactly that action; confirm restores every record; card marked undone", async () => {
    h.actionParse = { action: "undo" };
    const r = await say(A, chatId, "תבטלי את מה שעשית עכשיו");
    const u = await card(A, r.answerId);
    expect(u.action).toBe("undo");
    expect(u.details.undoTitle).toContain("מחיקת רישום בעיה שגוי");
    expect(u.targets.map((t) => t.plantId).sort()).toEqual(SEEDLINGS.slice(0, 7));
    const res = await confirm(A, u);
    expect(res.message).toContain("שוחזרו");
    const d = await all(A);
    for (const id of SEEDLINGS.slice(0, 7)) {
      expect(d.cases.find((x) => x.plantId === id)!.deletedAt ?? null).toBeNull();
      expect(d.events.find((e) => e.plantId === id && e.type === "treatment_started")!.payload).toMatchObject({ pest: "אקריות", product: "קונפידור" });
      expect(d.events.find((e) => e.plantId === id && e.type === "diagnosis")!.deletedAt ?? null).toBeNull();
      expect(d.reminders.find((x) => x.plantId === id)!.active).toBe(true);
    }
    const orig = (d.rs.find((x) => x.entity === "message" && (x.data as { proposal?: ActionProposal }).proposal?.action === "remove_issue" && (x.data as { proposal: ActionProposal }).proposal.status === "done")!.data as { proposal: ActionProposal }).proposal;
    expect(orig.undoneBy).toBe(u.id);
    expect([...needsCarePlantIds(d.plants, d.cases.filter((c) => !c.deletedAt))]).toHaveLength(12);
  });
});

describe("resolve, delete a treatment, correct dates, edit, cancel reminders, conflicts, ambiguity", () => {
  let A: Client;
  const chatId = randomUUID();
  beforeAll(async () => { A = await Client.signIn(h, person("a2")); await seedWithTreatment(A); });

  it("ambiguous plant name (two Monsteras) → a question, nothing changes", async () => {
    h.actionParse = (prompt) => ({ action: "resolve_issue", scope: "named", plants: [{ text: "המונסטרה", keys: [keyOf(prompt, "מונסטרה"), keyOf(prompt, "מוצי")], all_matching: false }], pest: "אקריות" });
    const r = await say(A, chatId, "תסמני שהמונסטרה החלימה");
    expect(r.text).toContain("2 צמחים");
    expect((await msg(A, r.answerId))!.proposal ?? null).toBeNull();
  });

  it("'תסמני שמוצי החלימה' → case resolved (kept in history), treatment_ended event, out of Sick; treatment untouched", async () => {
    h.actionParse = (prompt) => ({ action: "resolve_issue", scope: "named", plants: [{ text: "מוצי", keys: [keyOf(prompt, "מוצי")], all_matching: false }], removal_meaning: "resolved" });
    const p = await card(A, (await say(A, chatId, "תסמני שמוצי החלימה")).answerId);
    expect(p.targets.map((t) => t.plantId)).toEqual(["m2"]);
    const res = await confirm(A, p);
    expect(res.message).toContain("סומן שהחלימו");
    const d = await all(A);
    const c = d.cases.find((x) => x.plantId === "m2")!;
    expect(c).toMatchObject({ state: "resolved" });
    expect(c.deletedAt ?? null).toBeNull();
    expect(d.events.some((e) => e.plantId === "m2" && e.type === "treatment_ended")).toBe(true);
    expect(d.events.find((e) => e.plantId === "m2" && e.type === "treatment_started")!.payload.pest).toBe("אקריות");
    expect(needsCarePlantIds(d.plants, d.cases).has("m2")).toBe(false);
  });

  it("'לא טיפלתי בקונפידור בפוטוס, תמחקי' → treatment soft-deleted + its follow-up cancelled; the health issue is NOT deleted with it", async () => {
    h.actionParse = (prompt) => ({ action: "delete_records", record_kind: "treatment", product: "קונפידור", scope: "named", plants: [{ text: "פוטוס", keys: [keyOf(prompt, "פוטוס")], all_matching: false }] });
    const p = await card(A, (await say(A, chatId, "לא טיפלתי בקונפידור בפוטוס, תמחקי את הרישום")).answerId);
    expect(p.targets[0].records!.map((x) => `${x.entity}:${x.op}`).sort()).toEqual(["event:soft_delete", "reminder:cancel"]);
    await confirm(A, p);
    const d = await all(A);
    expect(d.events.find((e) => e.plantId === "po" && e.type === "treatment_started")!.deletedAt).toBeTruthy();
    expect(d.reminders.find((x) => x.plantId === "po")!.active).toBe(false);
    expect(d.cases.find((x) => x.plantId === "po")!.deletedAt ?? null).toBeNull(); // issue stays until the user says otherwise
  });

  it("'טעיתי, השקיתי את הצמחים אתמול ולא היום' → only today's waterings move to yesterday; last-watered follows", async () => {
    const now = new Date().toISOString();
    await A.push([
      mut("event", "w-fi", { id: "w-fi", plantId: "fi", type: "watering", occurredAt: now, precision: "exact", payload: {}, source: "user", inJournal: false, inHistory: true }),
      mut("event", "w-m1", { id: "w-m1", plantId: "m1", type: "watering", occurredAt: now, precision: "exact", payload: {}, source: "user", inJournal: false, inHistory: true }),
      mut("event", "w-old", { id: "w-old", plantId: "m1", type: "watering", occurredAt: new Date(Date.now() - 6 * 86_400_000).toISOString(), precision: "exact", payload: {}, source: "user", inJournal: false, inHistory: true }),
    ]);
    h.actionParse = { action: "redate_records", record_kind: "watering", scope: "all", record_date_text: "היום", new_date_text: "אתמול" };
    const p = await card(A, (await say(A, chatId, "טעיתי, השקיתי את הצמחים אתמול ולא היום")).answerId);
    expect(p.targets.map((t) => t.plantId).sort()).toEqual(["fi", "m1"]);
    expect(p.targets.flatMap((t) => t.records!.map((x) => x.id)).sort()).toEqual(["w-fi", "w-m1"]);
    await confirm(A, p);
    const d = await all(A);
    const yest = addDaysToDay(today(), -1);
    for (const id of ["w-fi", "w-m1"]) expect(isoDay(localParts(Date.parse(d.events.find((e) => e.id === id)!.occurredAt), TZ))).toBe(yest);
    expect(d.events.find((e) => e.id === "w-old")!.occurredAt).not.toContain(yest);
    const m1 = d.plants.find((x) => x.id === "m1")!;
    const plan = soilCheckPlan(m1, d.events.filter((e) => e.plantId === "m1"), undefined, Date.now());
    expect(isoDay(localParts(plan.lastWateringAt!, TZ))).toBe(yest);
  });

  it("'תשני את תאריך הטיפול של הפיקוס ל־12.10.26' and edit the product → both persisted", async () => {
    h.actionParse = (prompt) => ({ action: "redate_records", record_kind: "treatment", scope: "named", plants: [{ text: "פיקוס", keys: [keyOf(prompt, "פיקוס")], all_matching: false }], new_date_text: "12.10.26" });
    const said = await say(A, chatId, "תשני את תאריך הטיפול של הפיקוס ל־12.10.26");
    expect(said.text).toContain("מצאתי");
    const p = await card(A, said.answerId);
    await confirm(A, p);
    h.actionParse = (prompt) => ({ action: "edit_records", record_kind: "treatment", scope: "named", plants: [{ text: "פיקוס", keys: [keyOf(prompt, "פיקוס")], all_matching: false }], new_product: "שמן נים" });
    const p2 = await card(A, (await say(A, chatId, "בפיקוס השתמשתי בשמן נים ולא בקונפידור")).answerId);
    await confirm(A, p2);
    const t = (await all(A)).events.find((e) => e.plantId === "fi" && e.type === "treatment_started")!;
    expect(isoDay(localParts(Date.parse(t.occurredAt), TZ))).toBe("2026-10-12");
    expect(t.payload).toMatchObject({ product: "שמן נים", pest: "אקריות" });
  });

  it("'תבטלי את התזכורות לטיפול באקריות' → every active spider-mite inspection cancelled; Today empty", async () => {
    h.actionParse = { action: "cancel_reminders", record_kind: "reminder", scope: "all", pest: "אקריות" };
    const p = await card(A, (await say(A, chatId, "תבטלי את התזכורות לטיפול באקריות")).answerId);
    expect(p.targets.length).toBe(11); // po's was already cancelled with its deleted treatment
    await confirm(A, p);
    const d = await all(A);
    expect(d.reminders.every((r) => !r.active)).toBe(true);
    expect(todayTasks(d.plants, [], d.reminders, () => undefined, Date.parse("2026-10-21T09:00:00Z")).filter((t) => t.kind === "reminder")).toHaveLength(0);
  });

  it("a record changed after the card was shown is NOT overwritten (reported), the others are applied", async () => {
    h.actionParse = { action: "remove_issue", scope: "status", status_filter: "seedling", pest: "אקריות", removal_meaning: "erroneous" };
    const p = await card(A, (await say(A, chatId, "לא היו אקריות בשתילים, הרישום היה טעות")).answerId);
    const c1 = (await all(A)).cases.find((x) => x.plantId === "s1")!;
    await A.push([mut("health", c1.id, { notes: "עדכון ידני אחרי הכרטיס", title: "אקריות (נבדק)" }, 2 ** 31)]);
    // A guarded field on s1's case did not change (deletedAt), so the case delete still applies; make a guarded field change instead:
    const t1 = (await all(A)).events.find((e) => e.plantId === "s2" && e.type === "treatment_started")!;
    await A.push([mut("event", t1.id, { payload: { ...t1.payload, notes: "ידני" } }, 2 ** 31)]);
    const res = await confirm(A, p);
    expect(res.message).toContain("רישום אחד השתנה מאז ולא נגעתי בו");
    const t1after = (await all(A)).events.find((e) => e.id === t1.id)!;
    expect(t1after.payload).toMatchObject({ notes: "ידני", pest: "אקריות" }); // untouched
  });
});

describe("undo from the card button, legacy cards and isolation", () => {
  let A: Client, B: Client;
  let treatment: ActionProposal;
  beforeAll(async () => {
    A = await Client.signIn(h, person("a3"));
    B = await Client.signIn(h, person("b3"));
    treatment = await seedWithTreatment(A);
    await B.push([mut("plant", "b1", { id: "b1", commonName: "צמח של בי", status: "seedling", ordinal: 1 })]);
  });

  it("POST /actions/undo makes an undo card (no change yet); confirming removes everything that card created", async () => {
    const before = await all(A);
    const r = await A.req("/api/v1/actions/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: treatment.id, tz: TZ }) });
    expect(r.status).toBe(200);
    const { messageId, records: count } = await r.json() as { messageId: string; records: number };
    expect(count).toBe(12 * 4);
    expect((await all(A)).events.filter((e) => !e.deletedAt).length).toBe(before.events.filter((e) => !e.deletedAt).length);
    const u = await card(A, messageId);
    const res = await confirm(A, u);
    expect(res.message).toContain("48 רישומים שוחזרו");
    const d = await all(A);
    expect(d.events.filter((e) => e.type === "treatment_started" && !e.deletedAt)).toHaveLength(0);
    expect(d.cases.filter((c) => !c.deletedAt)).toHaveLength(0);
    expect(d.reminders.filter((x) => !x.deletedAt)).toHaveLength(0);
    expect(d.plants.filter((p) => !p.deletedAt)).toHaveLength(12); // plants themselves untouched
    const again = await A.req("/api/v1/actions/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: treatment.id }) });
    expect(again.status).toBe(409);
  });

  it("a card saved before the change log existed (the production card) is undoable from its deterministic record ids", async () => {
    const legacy = { ...(await card(A, treatment.id)), applied: undefined };
    const ids = new Set<string>();
    const rid = async (...parts: string[]) => parts.join("/");
    for (const pid of Object.keys(legacy.results ?? {})) for (const k of ["e", "hc", "dx", "fu"]) ids.add(`${k === "hc" ? "health" : k === "fu" ? "reminder" : "event"}|${legacy.id}/${pid}/${k}`);
    const { applied } = await appliedOf(legacy, async (keys) => new Set(keys.filter((k) => ids.has(k))), rid);
    expect(applied).toHaveLength(12 * 4);
    expect(applied.every((a) => a.created)).toBe(true);
  });

  it("another user can neither confirm, cancel nor undo A's cards; B's requests only see B's plants", async () => {
    for (const path of ["/api/v1/actions/execute", "/api/v1/actions/cancel", "/api/v1/actions/undo"]) {
      const x = await B.req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: treatment.id, revision: 1, plantIds: ["s1"] }) });
      expect(x.status).toBe(404);
    }
    h.actionParse = { action: "remove_issue", scope: "status", status_filter: "seedling", pest: "אקריות", removal_meaning: "erroneous" };
    const r = await say(B, randomUUID(), "תמחקי את האקריות מהשתילים");
    expect(r.text).toContain("לא מצאתי"); // B has no such records; A's are invisible
    h.actionParse = { action: "undo" };
    expect((await say(B, randomUUID(), "תבטלי את מה שעשית")).text).toContain("לא מצאתי פעולה");
  });
});
