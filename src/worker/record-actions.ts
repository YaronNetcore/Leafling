import {
  actionTitle, appliedOf, isoDay, localDayOf, localParts, normName, occurredAtFor, dueAtFor, pestInfo, productInfo, proposalQuestion, resolveHebrewDate, samePest, targetFor,
  type ActionProposal, type Applied, type PlantLite, type ProposalTarget, type RecordKind, type RecordRef,
} from "../shared/actions.ts";
import type { Entity, HealthCase, PlantEvent, Reminder } from "../shared/types.ts";
import type { RecordType } from "./action-schema.ts";
import { list, resolveScope, type Decision, type DecideInput } from "./actions.ts";

// AI Botanist: changes to EXISTING records — resolve / remove a health issue, delete, re-date or edit events,
// cancel or re-schedule reminders, undo the last confirmed card.
// - Which records: deterministic matching over THIS user's records of the plants in scope (pest, product, type,
//   date, "the last one"); Claude only names them in words. Plants without a matching record are not shown.
// - Every change is a guarded field update: `set` only if the record still has the `expect` values (captured when
//   the card was built) — a record edited in the meantime is reported, never overwritten.
// - Deleting is a soft delete (`deletedAt`, who and which card): the record leaves History, Journal, Sick, Today and
//   the AI context, but stays in D1 for audit and undo. A real treatment is never deleted because its diagnosis is.
// - Every executed card keeps the list of what it changed (`applied`) — undo reverses exactly that.

export interface PlantRecords { events: PlantEvent[]; cases: HealthCase[]; reminders: Reminder[] }

const EVENT_TYPES = ["treatment_started", "diagnosis", "watering", "fertilizing", "soil_check", "note", "milestone", "treatment_ended", "location_changed"];

/** This user's live records of these plants (one batch; every statement bound to the verified user id). */
export async function loadPlantRecords(db: D1Database, userId: string, plantIds: string[]): Promise<PlantRecords> {
  const out: PlantRecords = { events: [], cases: [], reminders: [] };
  for (let i = 0; i < plantIds.length; i += 90) {
    const ids = plantIds.slice(i, i + 90);
    const q = ids.map(() => "?").join(",");
    const [e, c, r] = await db.batch([
      db.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'event' AND json_extract(data, '$.plantId') IN (${q}) AND json_extract(data, '$.deletedAt') IS NULL
        AND json_extract(data, '$.type') IN (${EVENT_TYPES.map(() => "?").join(",")})`).bind(userId, ...ids, ...EVENT_TYPES),
      db.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'health' AND json_extract(data, '$.plantId') IN (${q}) AND json_extract(data, '$.deletedAt') IS NULL`).bind(userId, ...ids),
      db.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'reminder' AND json_extract(data, '$.plantId') IN (${q}) AND json_extract(data, '$.deletedAt') IS NULL`).bind(userId, ...ids),
    ]);
    out.events.push(...(e.results as { data: string }[]).map((x) => JSON.parse(x.data) as PlantEvent));
    out.cases.push(...(c.results as { data: string }[]).map((x) => JSON.parse(x.data) as HealthCase));
    out.reminders.push(...(r.results as { data: string }[]).map((x) => JSON.parse(x.data) as Reminder));
  }
  return out;
}

/** The most recent committed AI card of this user that has not been undone (any conversation). */
export async function lastCommittedCard(db: D1Database, userId: string): Promise<{ messageId: string; proposal: ActionProposal } | null> {
  const row = await db.prepare(`SELECT id, data FROM user_records WHERE user_id = ? AND entity = 'message' AND json_extract(data, '$.proposal.status') IN ('done', 'partial')
    AND json_extract(data, '$.proposal.undoneBy') IS NULL AND json_extract(data, '$.deletedAt') IS NULL ORDER BY json_extract(data, '$.proposal.finishedAt') DESC LIMIT 1`).bind(userId).first<{ id: string; data: string }>();
  if (!row) return null;
  return { messageId: row.id, proposal: (JSON.parse(row.data) as { proposal: ActionProposal }).proposal };
}

// ------------------------------------------------------------------ labels

const dm = (iso: string, tz: string) => { const p = localParts(Date.parse(iso), tz); return `${p.d}.${p.m}`; };
const EV: Record<string, string> = { treatment_started: "טיפול", diagnosis: "דיווח על בעיה", watering: "השקיה", fertilizing: "דישון", soil_check: "בדיקת אדמה", note: "הערה", milestone: "אבן דרך", treatment_ended: "סיום מעקב", location_changed: "שינוי מיקום" };
function eventLabel(e: PlantEvent, tz: string) {
  const pl = e.payload ?? {};
  const s = (k: string) => (typeof pl[k] === "string" ? String(pl[k]) : "");
  if (e.type === "treatment_started") return `טיפול${s("product") ? ` ב${s("product")}` : ""}${s("pest") ? ` נגד ${s("pest")}` : ""} · ${dm(e.occurredAt, tz)}`;
  if (e.type === "diagnosis") return `${EV.diagnosis}: ${s("title")} · ${dm(e.occurredAt, tz)}`;
  if (e.type === "note") return `הערה: ${s("text").slice(0, 40)} · ${dm(e.occurredAt, tz)}`;
  return `${EV[e.type] ?? e.type} · ${dm(e.occurredAt, tz)}`;
}
const caseLabel = (c: HealthCase, tz: string) => `בעיה: ${c.title} · ${c.source === "user" ? "דיווח שלך" : c.source === "ai" ? "אבחון AI" : "איש מקצוע"} · ${c.state === "resolved" ? "נסגרה" : "פעילה"} · ${dm(c.openedAt ?? c.createdAt, tz)}`;
const reminderLabel = (r: Reminder, tz: string) => `תזכורת: ${r.text.slice(0, 50)} · ${dm(r.nextAt, tz)}`;

// ------------------------------------------------------------------ matching

const softDelete = (label: string, entity: RecordRef["entity"], id: string, cur: { deletedAt?: string | null }): RecordRef =>
  ({ entity, id, label, op: "soft_delete", set: { deletedAt: "$now", deletedBy: "ai_chat", deletedVia: "$card" }, expect: { deletedAt: cur.deletedAt ?? null } });
const cancelReminder = (r: Reminder, tz: string): RecordRef =>
  ({ entity: "reminder", id: r.id, label: reminderLabel(r, tz), op: "cancel", set: { active: false, cancelledAt: "$now" }, expect: { active: r.active } });

function matches(text: string | null | undefined, wanted: { pest?: ReturnType<typeof pestInfo>; match?: string | null }) {
  const t = String(text ?? "");
  if (wanted.pest && !samePest(t, wanted.pest) && !normName(t).includes(normName(wanted.pest.label))) return false;
  if (wanted.match && !normName(t).includes(normName(wanted.match))) return false;
  return true;
}
const sameProduct = (a: unknown, wanted: string | null) => {
  if (!wanted) return true;
  const pa = productInfo(String(a ?? ""));
  const pw = productInfo(wanted);
  return Boolean(pa && pw && (pa.label === pw.label || normName(pa.label).includes(normName(pw.label))));
};
const latest = <T>(xs: T[], at: (x: T) => string) => [...xs].sort((a, b) => at(b).localeCompare(at(a))).slice(0, 1);

const TYPE_OF: Partial<Record<RecordType, string[]>> = { treatment: ["treatment_started"], watering: ["watering"], fertilizing: ["fertilizing"], soil_check: ["soil_check"], note: ["note", "milestone"] };

/** Records of one plant for a record action (pure; exported for tests). */
export function recordsForPlant(kind: RecordKind, q: DecideInput["parsed"], recs: PlantRecords, plantId: string, tz: string, recordDay: string | null, extra: { newOccurred?: { occurredAt: string; precision: string }; newDueAt?: string }): RecordRef[] {
  const pest = q.pest ? pestInfo(q.pest) : null;
  const events = recs.events.filter((e) => e.plantId === plantId && (!recordDay || localDayOf(e.occurredAt, tz) === recordDay));
  const cases = recs.cases.filter((c) => c.plantId === plantId);
  const rems = recs.reminders.filter((r) => r.plantId === plantId && r.active);
  const pick = <T>(xs: T[], at: (x: T) => string) => (q.which === "last" ? latest(xs, at) : xs);
  const out: RecordRef[] = [];

  if (kind === "resolve_issue") {
    for (const c of pick(cases.filter((c) => c.state !== "resolved" && matches(c.title, { pest })), (c) => c.openedAt ?? c.createdAt)) {
      out.push({ entity: "health", id: c.id, label: caseLabel(c, tz), op: "resolve", set: { state: "resolved", resolvedAt: "$now" }, expect: { state: c.state, resolvedAt: c.resolvedAt ?? null } });
    }
    return out;
  }
  if (kind === "remove_issue") {
    const wrong = pick(cases.filter((c) => matches(c.title, { pest })), (c) => c.openedAt ?? c.createdAt);
    for (const c of wrong) {
      out.push(softDelete(caseLabel(c, tz), "health", c.id, c));
      for (const d of events.filter((e) => e.type === "diagnosis" && normName(String(e.payload?.title ?? "")) === normName(c.title))) out.push(softDelete(eventLabel(d, tz), "event", d.id, d));
      // The treatment really happened → keep it, only drop the wrong pest link (unless the user said to delete it too).
      for (const t of events.filter((e) => e.type === "treatment_started" && (e.payload?.healthCaseId === c.id || (!e.payload?.healthCaseId && matches(String(e.payload?.pest ?? ""), { pest: pestInfo(c.title) }))))) {
        if (!q.keep_treatment) { out.push(softDelete(eventLabel(t, tz), "event", t.id, t)); continue; }
        const product = typeof t.payload?.product === "string" ? t.payload.product : "";
        out.push({ entity: "event", id: t.id, label: `${eventLabel(t, tz)} — נשאר, בלי ${c.title}`, op: "unlink_pest",
          set: { payload: { ...t.payload, pest: null, healthCaseId: null, pestCorrected: t.payload?.pest ?? c.title, title: product ? `טיפול ב${product}` : "טיפול" } }, expect: { payload: t.payload } });
      }
      // Inspections for a problem that never existed are cancelled with it.
      for (const r of rems.filter((r) => matches(r.text, { pest: pestInfo(c.title) }))) out.push(cancelReminder(r, tz));
    }
    return [...new Map(out.map((r) => [`${r.entity}|${r.id}`, r])).values()];
  }
  if (kind === "cancel_reminders" || kind === "redate_reminders") {
    const match = q.match_text ?? q.reminder_text;
    for (const r of pick(rems.filter((r) => matches(r.text, { pest, match })), (r) => r.nextAt)) {
      out.push(kind === "cancel_reminders" ? cancelReminder(r, tz)
        : { entity: "reminder", id: r.id, label: reminderLabel(r, tz), op: "reschedule", set: { nextAt: extra.newDueAt, active: true }, expect: { nextAt: r.nextAt, active: r.active } });
    }
    return out;
  }
  // delete / redate / edit events
  const types = TYPE_OF[q.record_kind] ?? [];
  const evs = pick(events.filter((e) => types.includes(e.type) && sameProduct(e.payload?.product, q.product) && (!pest || matches(String(e.payload?.pest ?? ""), { pest }))
    && (!q.match_text || normName(String(e.payload?.text ?? "")).includes(normName(q.match_text)))), (e) => e.occurredAt);
  for (const e of evs) {
    if (kind === "delete_records") {
      out.push(softDelete(eventLabel(e, tz), "event", e.id, e));
      // Follow-up inspections created together with a deleted treatment would be orphans.
      if (e.type === "treatment_started" && e.payload?.actionId) for (const r of rems.filter((r) => r.groupId === e.payload.actionId)) out.push(cancelReminder(r, tz));
    } else if (kind === "redate_records" && extra.newOccurred) {
      out.push({ entity: "event", id: e.id, label: eventLabel(e, tz), op: "redate", set: { occurredAt: extra.newOccurred.occurredAt, precision: extra.newOccurred.precision }, expect: { occurredAt: e.occurredAt, precision: e.precision ?? null } });
    } else if (kind === "edit_records" && e.type === "treatment_started") {
      const pl = { ...e.payload };
      if (q.new_product) { const np = productInfo(q.new_product)!; pl.product = np.label; pl.productActive = np.active; }
      if (q.new_pest) pl.pest = pestInfo(q.new_pest)!.label;
      pl.title = pl.pest ? `טיפול נגד ${String(pl.pest)}` : pl.product ? `טיפול ב${String(pl.product)}` : "טיפול";
      out.push({ entity: "event", id: e.id, label: eventLabel(e, tz), op: "edit", set: { payload: pl }, expect: { payload: e.payload } });
      if (q.new_pest && e.payload?.healthCaseId) {
        const c = cases.find((x) => x.id === e.payload.healthCaseId);
        if (c) out.push({ entity: "health", id: c.id, label: caseLabel(c, tz), op: "edit", set: { title: pestInfo(q.new_pest)!.label }, expect: { title: c.title } });
      }
    }
  }
  return [...new Map(out.map((r) => [`${r.entity}|${r.id}`, r])).values()];
}

// ------------------------------------------------------------------ decide

const WHAT: Record<string, string> = { health_issue: "רישומי בעיה", treatment: "רישומי טיפול", watering: "השקיות", fertilizing: "דישונים", soil_check: "בדיקות אדמה", note: "הערות", reminder: "תזכורות" };

export async function decideRecords(i: DecideInput): Promise<Decision> {
  const q = { ...i.parsed };
  let kind = q.action as RecordKind;
  // Normalise: one meaning per action.
  if (kind === "remove_issue" && q.removal_meaning === "resolved") kind = "resolve_issue";
  if (kind === "delete_records" && q.record_kind === "health_issue") kind = "remove_issue";
  if (kind === "delete_records" && q.record_kind === "reminder") kind = "cancel_reminders";
  if (kind === "redate_records" && q.record_kind === "reminder") kind = "redate_reminders";
  if (kind === "undo") return decideUndo(i);
  if (!i.records) return { kind: "chat" };
  if ((kind === "delete_records" || kind === "redate_records" || kind === "edit_records") && !TYPE_OF[q.record_kind]) {
    return { kind: "clarify", text: kind === "delete_records" ? "מה למחוק — טיפול, השקיה, דישון, בדיקת אדמה, הערה, בעיה או תזכורת?" : "איזה רישום לתקן — טיפול, השקיה, דישון או בדיקת אדמה?" };
  }
  if ((kind === "resolve_issue" || kind === "remove_issue") && !q.pest && q.record_kind !== "health_issue") q.record_kind = "health_issue";

  const sc = resolveScope(i, "all");
  if ("clarify" in sc) return { kind: "clarify", text: sc.clarify };

  // Dates: the records' current date (filter) and the corrected one.
  let recordDay: string | null = null;
  if (q.record_date_text) {
    const d = resolveHebrewDate(q.record_date_text, i.now, i.tz, kind === "redate_reminders" || kind === "cancel_reminders" ? "future" : "past");
    if (!d.ok) return { kind: "clarify", text: d.message };
    recordDay = kind === "redate_reminders" || kind === "cancel_reminders" ? null : d.day;
  }
  const extra: { newOccurred?: { occurredAt: string; precision: string }; newDueAt?: string } = {};
  let newDay: string | undefined;
  let newDateLabel: string | undefined;
  if (kind === "redate_records" || kind === "redate_reminders") {
    if (!q.new_date_text) return { kind: "clarify", text: "לאיזה תאריך להעביר?" };
    const d = resolveHebrewDate(q.new_date_text, i.now, i.tz, kind === "redate_reminders" ? "future" : "past");
    if (!d.ok) return { kind: "clarify", text: d.message };
    newDay = d.day; newDateLabel = d.label;
    if (kind === "redate_records") extra.newOccurred = occurredAtFor(d.day, i.now, i.tz);
    else extra.newDueAt = dueAtFor(d.day, i.tz);
    // "השקיתי אתמול ולא היום": without an explicit old date, the records being moved are the ones of the newest day.
    if (!recordDay && q.which !== "last") q.which = "last";
  }
  if (kind === "edit_records" && !q.new_product && !q.new_pest) return { kind: "clarify", text: "מה לתקן ברישום — את החומר או את הבעיה?" };

  const recs = await i.records(sc.targets.map((p) => p.id));
  const locName = (id?: string | null) => i.owned.locations.find((l) => l.id === id)?.name ?? null;
  const rows: ProposalTarget[] = [];
  for (const p of sc.targets) {
    const records = recordsForPlant(kind, q, recs, p.id, i.tz, recordDay, extra);
    if (records.length) rows.push({ ...targetFor(p, locName), records });
  }
  const pest = q.pest ? pestInfo(q.pest)!.label : null;
  const what = pest ? `רישומי ${pest}` : q.product ? `רישומי ${productInfo(q.product)!.label}` : kind === "resolve_issue" || kind === "remove_issue" ? "בעיות פעילות" : WHAT[q.record_kind] ?? "רישומים";
  const where = sc.status === "seedling" ? "שתילים" : sc.status === "rooting" ? "ייחורים" : sc.locName ? `צמחים ב${sc.locName}` : "צמחים";
  if (!rows.length) return { kind: "clarify", text: `לא מצאתי ${kind === "resolve_issue" ? `בעיה פעילה${pest ? ` של ${pest}` : ""}` : what} ב${where === "צמחים" ? "צמחים שלך" : where}${recordDay ? " באותו תאריך" : ""}.` };

  // "תורידי את האקריות" — resolved, or recorded by mistake? Ask once (the answer completes this request).
  if (kind === "remove_issue" && q.removal_meaning !== "erroneous") {
    return { kind: "clarify", text: `מצאתי ${rows.length === 1 ? `רישום ${pest ?? "בעיה"} ב${rows[0].name}` : `${rows.length} ${where} עם רישום ${pest ?? "בעיה"}`}. לסמן ש${rows.length === 1 ? "הצמח החלים" : "החלימו"}, או למחוק את הרישום כי הוא היה שגוי?` };
  }

  const n = rows.length;
  const scopeLabel = `מצאתי ${what} ב${n === 1 ? rows[0].name : `־${n} ${where}`}`;
  const warnings: string[] = [];
  if (kind === "remove_issue" || kind === "delete_records") warnings.push("מחיקה מסירה את הרישום מההיסטוריה, מהיומן, מ'חולים' ומ'היום'. הוא נשמר בארכיון פנימי — אפשר לבטל עם \"תבטלי את מה שעשית\".");
  if (kind === "remove_issue" && q.keep_treatment && rows.some((r) => r.records!.some((x) => x.op === "unlink_pest"))) warnings.push(`הטיפולים עצמם נשארים ברישום — רק הקישור ל${pest ?? "בעיה"} יוסר.`);
  if (kind === "resolve_issue") warnings.push("הבעיה נסגרת ונשארת בהיסטוריה; הצמחים יוצאים מ'חולים'.");
  const today = isoDay(localParts(i.now, i.tz));
  const proposal: ActionProposal = {
    id: i.proposalId, revision: 1, status: "pending", action: kind, scopeLabel, day: today, ...occurredAtFor(today, i.now, i.tz), dateLabel: newDateLabel ?? "", tz: i.tz,
    details: { recordsLabel: what, newDay, newDateLabel, newProduct: q.new_product ? productInfo(q.new_product)!.label : null, newPest: q.new_pest ? pestInfo(q.new_pest)!.label : null, keepTreatments: kind === "remove_issue" ? q.keep_treatment : undefined, pest },
    warnings, followUp: null, targets: rows, createdAt: new Date(i.now).toISOString(),
  };
  return { kind: "proposal", proposal, text: proposalQuestion(proposal) };
}

// ------------------------------------------------------------------ undo

async function decideUndo(i: DecideInput): Promise<Decision> {
  const last = await i.lastCard?.();
  if (!last) return { kind: "clarify", text: "לא מצאתי פעולה של הבוטנאית שאפשר לבטל." };
  return { kind: "proposal", ...(await undoProposal(last.messageId, last.proposal, i.proposalId, i.now, i.tz, i.undoHelpers!)) };
}

export interface UndoHelpers { existing: (keys: string[]) => Promise<Set<string>>; rid: (...parts: string[]) => Promise<string>; names: (plantIds: string[]) => Promise<Map<string, string>> }

/** The undo card for one committed card: every record it changed, per plant, reversed only where unchanged since. */
export async function undoProposal(cardMessageId: string, card: ActionProposal, proposalId: string, now: number, tz: string, h: UndoHelpers): Promise<{ proposal: ActionProposal; text: string }> {
  const { applied, notUndoable } = await appliedOf(card, h.existing, h.rid);
  const names = await h.names([...new Set(applied.map((a) => a.plantId))]);
  const byPlant = new Map<string, RecordRef[]>();
  for (const a of applied) {
    const ref: RecordRef = a.created
      ? { entity: a.entity, id: a.id, label: `${a.label} — יוסר`, op: "restore", set: { deletedAt: "$now", deletedBy: "ai_chat_undo", deletedVia: "$card" }, expect: { deletedAt: null } }
      : { entity: a.entity, id: a.id, label: `${a.label} — יוחזר`, op: "restore", set: a.before ?? {}, expect: a.after ?? {} };
    if (!byPlant.has(a.plantId)) byPlant.set(a.plantId, []);
    byPlant.get(a.plantId)!.push(ref);
  }
  const title = actionTitle(card);
  const when = card.finishedAt ? `${localParts(Date.parse(card.finishedAt), tz).d}.${localParts(Date.parse(card.finishedAt), tz).m}` : "";
  const targets: ProposalTarget[] = [...byPlant.entries()].map(([pid, records]) => ({ plantId: pid, name: names.get(pid) ?? card.targets.find((t) => t.plantId === pid)?.name ?? "", selected: true, records }));
  const today = isoDay(localParts(now, tz));
  const proposal: ActionProposal = {
    id: proposalId, revision: 1, status: "pending", action: "undo", scopeLabel: `הפעולה האחרונה: "${title}"${when ? ` (${when})` : ""}`, day: today, ...occurredAtFor(today, now, tz), dateLabel: "", tz,
    details: { undoOf: cardMessageId, undoTitle: title, recordsLabel: title }, followUp: null, targets, createdAt: new Date(now).toISOString(),
    warnings: [...notUndoable, "רישומים שהשתנו מאז לא יידרסו — הם יוצגו כ'לא שוחזרו'."],
  };
  const text = targets.length ? proposalQuestion(proposal) : "בפעולה האחרונה אין רישומים שאפשר לשחזר.";
  return { proposal, text };
}

// ------------------------------------------------------------------ execute (guarded field updates)

type Item = { entity: Entity; id: string; patch: Record<string, unknown>; mutationId: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fill = (v: Record<string, unknown>, now: string, card: string) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "$now" ? now : x === "$card" ? card : x]));

export interface Op { plantId: string; ref: RecordRef; index: number }
export const opsOf = (p: ActionProposal): Op[] => {
  const ops: Op[] = [];
  for (const pid of p.confirmedIds ?? []) for (const ref of p.targets.find((t) => t.plantId === pid)?.records ?? []) ops.push({ plantId: pid, ref, index: ops.length });
  return ops;
};

/** One chunk of guarded updates. Returns the writes plus each op's outcome and the change log. */
export async function recordChunk(db: D1Database, userId: string, p: ActionProposal, ops: Op[], rid: (...parts: string[]) => Promise<string>, budget: number) {
  const keys = ops.map((o) => `${o.ref.entity}|${o.ref.id}`);
  const rows = keys.length ? (await db.prepare(`SELECT entity, id, data FROM user_records WHERE user_id = ? AND (entity || '|' || id) IN (${keys.map(() => "?").join(",")})`).bind(userId, ...keys)
    .all<{ entity: string; id: string; data: string }>()).results : [];
  const cur = new Map(rows.map((r) => [`${r.entity}|${r.id}`, JSON.parse(r.data) as Record<string, unknown>]));
  const at = new Date().toISOString();
  const items: Item[] = [];
  const outcomes: string[] = [];
  const applied: Applied[] = [];
  for (const o of ops) {
    const need = o.ref.op === "resolve" ? 2 : 1;
    if (items.length && items.length + need > budget) break;
    const rec = cur.get(`${o.ref.entity}|${o.ref.id}`);
    // Ownership: the row was read under this user id; a plant-id mismatch means the card does not describe this record.
    if (!rec || (o.ref.entity !== "plant" && rec.plantId !== o.plantId)) { outcomes.push("failed:missing"); continue; }
    const changed = Object.entries(o.ref.expect).some(([k, v]) => !same(rec[k], v));
    const set = fill(o.ref.set, at, p.id);
    if (changed) {
      // Already in the wanted state (e.g. resolved elsewhere) → nothing to do; otherwise it was changed since → never overwrite.
      const already = Object.entries(o.ref.set).every(([k, v]) => (v === "$now" || v === "$card" ? rec[k] != null : same(rec[k], v)));
      outcomes.push(already ? "skipped" : "failed:changed");
      continue;
    }
    const mid = `act-${await rid(p.id, o.ref.entity, o.ref.id, String(o.index))}`;
    items.push({ entity: o.ref.entity as Entity, id: o.ref.id, mutationId: mid, patch: set });
    applied.push({ entity: o.ref.entity, id: o.ref.id, plantId: o.plantId, label: o.ref.label.split(" — ")[0], before: Object.fromEntries(Object.keys(set).map((k) => [k, rec[k] ?? null])), after: set });
    if (o.ref.op === "resolve") {
      const id = await rid(p.id, o.plantId, o.ref.id, "end");
      items.push({ entity: "event", id, mutationId: `act-${id}`, patch: { id, plantId: o.plantId, type: "treatment_ended", payload: { title: rec.title, via: "ai_chat", actionId: p.id }, createdAt: at, occurredAt: at, precision: "exact", source: "ai_confirmed", inJournal: true, inHistory: true } });
      applied.push({ entity: "event", id, plantId: o.plantId, label: "סיום מעקב", created: true });
    }
    outcomes.push("saved");
  }
  return { items, outcomes, applied };
}

export function recordFinalText(p: ActionProposal): string {
  const out = p.opResults ?? [];
  const ok = out.filter((x) => x === "saved").length;
  const same = out.filter((x) => x === "skipped").length;
  const changed = out.filter((x) => x === "failed:changed").length;
  const missing = out.filter((x) => x === "failed:missing").length;
  const plants = Object.values(p.results ?? {}).filter((r) => r === "saved").length;
  const inPlants = plants > 1 ? ` ב־${plants} צמחים` : "";
  const head = !ok ? "לא שונה אף רישום."
    : p.action === "resolve_issue" ? `סומן שהחלימו${inPlants} 🌿`
    : p.action === "remove_issue" ? `הרישום השגוי הוסר${inPlants}.${p.details.keepTreatments ? " הטיפולים נשארו." : ""}`
    : p.action === "delete_records" ? `נמחקו ${ok} רישומים${inPlants}.`
    : p.action === "redate_records" ? `התאריך תוקן ב־${ok} רישומים.`
    : p.action === "edit_records" ? `עודכנו ${ok} רישומים.`
    : p.action === "cancel_reminders" ? `בוטלו ${ok} תזכורות.`
    : p.action === "redate_reminders" ? `הועברו ${ok} תזכורות.`
    : `בוטל: ${p.details.undoTitle ?? ""} — ${ok} רישומים שוחזרו.`;
  const tail: string[] = [];
  if (same) tail.push(same === 1 ? "רישום אחד כבר היה במצב הזה." : `${same} רישומים כבר היו במצב הזה.`);
  if (changed) tail.push(changed === 1 ? "רישום אחד השתנה מאז ולא נגעתי בו." : `${changed} רישומים השתנו מאז ולא נגעתי בהם.`);
  if (missing) tail.push(missing === 1 ? "רישום אחד לא נמצא." : `${missing} רישומים לא נמצאו.`);
  if (ok && p.action !== "undo") tail.push("אפשר לבטל: \"תבטלי את מה שעשית\".");
  return [head, ...tail].join(" ");
}
