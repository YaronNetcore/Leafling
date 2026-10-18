import { STATUS_LABEL, displayName } from "./domain.ts";
import type { DatePrecision, HealthCase, Location, Plant, PlantEvent, Reminder, Status } from "./types.ts";

// Natural-language plant updates from the AI Botanist chat ("השקתי את כל הצמחים במרפסת").
// Pure, deterministic rules shared by the Worker (which decides) and the app (which renders):
// - Claude only turns the sentence into a constrained structure (action from an allowlist + name/date phrases).
// - Which plants, which date and what is safe are decided HERE, deterministically, against the user's own records.
// - Nothing is written until the user confirms the proposal card (Worker: actions.ts).

export type CreateKind = "water" | "fertilize" | "soil_check" | "treatment" | "move" | "reminder" | "note";
/** Changes to EXISTING records (2026-10): each one previews the actual records and runs only after confirmation. */
export type RecordKind = "resolve_issue" | "remove_issue" | "delete_records" | "redate_records" | "edit_records" | "cancel_reminders" | "redate_reminders" | "undo";
export type ActionKind = CreateKind | RecordKind;
export const CREATE_KINDS: CreateKind[] = ["water", "fertilize", "soil_check", "treatment", "move", "reminder", "note"];
export const RECORD_KINDS: RecordKind[] = ["resolve_issue", "remove_issue", "delete_records", "redate_records", "edit_records", "cancel_reminders", "redate_reminders", "undo"];
export const ACTION_KINDS: ActionKind[] = [...CREATE_KINDS, ...RECORD_KINDS];
export const isRecordKind = (a: ActionKind): a is RecordKind => (RECORD_KINDS as string[]).includes(a);
export const ACTION_LABEL: Record<ActionKind, string> = {
  water: "השקיה", fertilize: "דישון", soil_check: "בדיקת אדמה", treatment: "טיפול", move: "העברת מיקום", reminder: "תזכורת", note: "הערה",
  resolve_issue: "סימון החלמה", remove_issue: "מחיקת רישום בעיה שגוי", delete_records: "מחיקת רישומים", redate_records: "תיקון תאריך",
  edit_records: "תיקון רישום", cancel_reminders: "ביטול תזכורות", redate_reminders: "שינוי מועד תזכורת", undo: "ביטול פעולה קודמת",
};
/** Destructive kinds get a clear warning in the card (they are still recoverable: soft delete + undo). */
export const DESTRUCTIVE: ActionKind[] = ["remove_issue", "delete_records"];

/**
 * One existing record a record-action touches (shown in the card, executed only if its plant stays selected).
 * Every change is "set these fields, but only if the record still has the `expect` values" — so a record edited
 * in the meantime is reported, never overwritten. "$now" in `set` is the execution time.
 */
export interface RecordRef {
  entity: "event" | "health" | "reminder" | "plant";
  id: string;
  label: string;
  op: "resolve" | "soft_delete" | "unlink_pest" | "redate" | "edit" | "cancel" | "reschedule" | "restore";
  set: Record<string, unknown>;
  expect: Record<string, unknown>;
}
/** What one executed card changed — the basis of undo (server-side, per record, never the chat text). */
export interface Applied { entity: RecordRef["entity"]; id: string; plantId: string; label: string; created?: boolean; before?: Record<string, unknown>; after?: Record<string, unknown> }
export type SoilState = "dry" | "slightly_moist" | "very_moist";
export const SOIL_LABEL: Record<SoilState, string> = { dry: "יבשה", slightly_moist: "לחה", very_moist: "לחה מאוד" };

export interface ProposalTarget {
  plantId: string;
  name: string;
  /** Species line when the name is a nickname, or "#2" duplicates — keeps same-species plants distinguishable. */
  sub?: string;
  location?: string | null;
  /** Pre-selected for saving. Unselected = shown but left out (user exclusion, or already recorded that day). */
  selected: boolean;
  note?: "already_recorded" | "already_there" | "excluded";
  /** Record actions: the plant's existing records that will change. */
  records?: RecordRef[];
}

export type ProposalStatus = "pending" | "executing" | "done" | "partial" | "cancelled" | "superseded";

/** The confirmation card. Stored inside the server-written assistant message (clients cannot write messages). */
export interface ActionProposal {
  id: string;
  revision: number;
  status: ProposalStatus;
  action: ActionKind;
  scopeLabel: string;
  /** Local calendar day (user's time zone) the action happened / is due. */
  day: string;
  occurredAt: string;
  precision: DatePrecision;
  dateLabel: string;
  tz: string;
  details: {
    soil?: SoilState;
    pest?: string | null;
    product?: string | null;
    productActive?: string | null;
    reportedBy?: "user";
    toLocationId?: string;
    toLocationName?: string;
    reminderText?: string;
    reminderKind?: "inspect" | "custom";
    note?: string;
    // Record actions
    /** What is matched, in words ("רישומי אקריות", "השקיות מהיום"). */
    recordsLabel?: string;
    newDay?: string;
    newDateLabel?: string;
    newProduct?: string | null;
    newPest?: string | null;
    /** remove_issue: the treatments themselves stay (only their link to the wrong diagnosis is removed). */
    keepTreatments?: boolean;
    undoOf?: string;
    undoTitle?: string;
  };
  warnings: string[];
  /** Offered follow-up: always an INSPECTION reminder — never a repeat pesticide application. */
  followUp: { days: number; text: string; dueAt: string } | null;
  targets: ProposalTarget[];
  createdAt: string;
  // Filled when the user confirms / while saving.
  confirmedIds?: string[];
  followUpChosen?: boolean;
  results?: Record<string, "saved" | "skipped" | "failed">;
  failures?: { plantId: string; name: string; reason: string }[];
  finishedAt?: string;
  /** Record changes committed by this card (append-only while executing) — undo uses it. */
  applied?: Applied[];
  /** Record actions: how many of the confirmed records were processed, and each one's outcome. */
  opsDone?: number;
  opResults?: string[];
  /** Set on a card that was later undone (id of the undo card). */
  undoneBy?: string | null;
}

// ---------------------------------------------------------------- time zones & dates

export const DEFAULT_TZ = "Asia/Jerusalem";
export function safeTz(tz: unknown): string {
  if (typeof tz !== "string" || !/^[A-Za-z_+\-/0-9]{1,64}$/.test(tz)) return DEFAULT_TZ;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return DEFAULT_TZ; }
}

interface Civil { y: number; m: number; d: number }
export function localParts(t: number, tz: string): Civil & { h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute") };
}
/** UTC instant of a wall-clock time in `tz`. */
export function zonedToUtc(c: Civil, h: number, mi: number, tz: string): number {
  const want = Date.UTC(c.y, c.m - 1, c.d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const diff = want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    if (!diff) break;
    guess += diff;
  }
  return guess;
}
const civilNum = (c: Civil) => Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;
const fromNum = (n: number): Civil => { const d = new Date(n * 86_400_000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const addDays = (c: Civil, n: number) => fromNum(civilNum(c) + n);
const weekday = (c: Civil) => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
export const isoDay = (c: Civil) => `${c.y}-${String(c.m).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`;
export const parseDay = (s: string): Civil => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };

export const WEEKDAY_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const WEEKDAY_LETTER: Record<string, number> = { "א": 0, "ב": 1, "ג": 2, "ד": 3, "ה": 4, "ו": 5 };

export function dayLabel(day: string, todayDay: string): string {
  const c = parseDay(day);
  const diff = civilNum(c) - civilNum(parseDay(todayDay));
  const rel = diff === 0 ? "היום" : diff === -1 ? "אתמול" : diff === -2 ? "שלשום" : diff === 1 ? "מחר" : diff < 0 ? `לפני ${-diff} ימים` : `בעוד ${diff} ימים`;
  return `${rel} · יום ${WEEKDAY_HE[weekday(c)]}, ${c.d}.${c.m}.${c.y}`;
}

export type DateResult =
  | { ok: true; day: string; explicit: boolean; label: string }
  | { ok: false; reason: "future" | "past" | "weekday_mismatch" | "invalid" | "unknown"; message: string };

const NUM: Record<string, number> = {
  "אחד": 1, "אחת": 1, "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2, "שלושה": 3, "שלוש": 3, "ארבעה": 4, "ארבע": 4, "חמישה": 5, "חמש": 5,
  "שישה": 6, "שש": 6, "שבעה": 7, "שבע": 7, "שמונה": 8, "תשעה": 9, "תשע": 9, "עשרה": 10, "עשר": 10,
};
const cleanHe = (s: string) => s.replace(/[֑-ׇ]/g, "").replace(/[־–—]/g, " ").replace(/[׳’`]/g, "'").replace(/[״“”]/g, '"').replace(/\s+/g, " ").trim();

/**
 * Hebrew date phrase → a local calendar day in the user's time zone. Deterministic; never guesses silently:
 * anything it cannot read, or that contradicts itself, comes back as a short question to ask.
 * `dir` = "past" for things already done (watering, treatment), "future" for reminders.
 */
export function resolveHebrewDate(text: string | null | undefined, nowMs: number, tz: string, dir: "past" | "future" = "past"): DateResult {
  const today = localParts(nowMs, tz);
  const t = cleanHe(text ?? "");
  const done = (c: Civil, explicit = false): DateResult => {
    const diff = civilNum(c) - civilNum(today);
    if (dir === "past" && diff > 0) return { ok: false, reason: "future", message: `התאריך ${c.d}.${c.m}.${c.y} עוד לא הגיע — לאיזה תאריך הכוונה?` };
    if (dir === "future" && diff < 0) return { ok: false, reason: "past", message: `התאריך ${c.d}.${c.m}.${c.y} כבר עבר — מתי להזכיר?` };
    return { ok: true, day: isoDay(c), explicit, label: dayLabel(isoDay(c), isoDay(today)) };
  };
  if (!t) return dir === "past" ? done(today) : { ok: false, reason: "unknown", message: "מתי להזכיר?" };

  // Explicit date: 13.10.26 / 13/10/2026 / 13.10
  const ex = t.match(/(?:^|[^\d])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/);
  let explicitDay: Civil | null = null;
  if (ex) {
    const d = Number(ex[1]); const m = Number(ex[2]);
    let y = ex[3] ? Number(ex[3]) : today.y;
    if (ex[3] && ex[3].length === 2) y += 2000;
    if (ex[3] && ex[3].length === 3) return { ok: false, reason: "invalid", message: "לא הצלחתי לקרוא את השנה בתאריך — אפשר לכתוב למשל 13.10.26?" };
    const c = { y, m, d };
    const back = fromNum(civilNum(c));
    if (m < 1 || m > 12 || d < 1 || back.d !== d || back.m !== m) return { ok: false, reason: "invalid", message: `התאריך ${d}.${m} לא קיים בלוח — לאיזה תאריך הכוונה?` };
    if (!ex[3]) { // no year: the nearest sensible one
      if (dir === "past" && civilNum(c) > civilNum(today)) c.y -= 1;
      if (dir === "future" && civilNum(c) < civilNum(today)) c.y += 1;
    }
    explicitDay = c;
  }

  // Weekday ("ביום שלישי", "ביום ג'", "בשבת"), optionally "שעבר" / "הבא".
  let wd: number | null = null;
  const wm = t.match(/(?:^|\s)[בה]?יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?=$|[\s,.])/) ?? t.match(/(?:^|\s)[בה]?יום\s+([אבגדהו])'/) ?? t.match(/(?:^|\s)(?:ב|ה)(שבת)(?=$|[\s,.])/);
  if (wm) wd = WEEKDAY_HE.indexOf(wm[1]) >= 0 ? WEEKDAY_HE.indexOf(wm[1]) : WEEKDAY_LETTER[wm[1]];

  if (explicitDay) {
    if (wd != null && weekday(explicitDay) !== wd) {
      return { ok: false, reason: "weekday_mismatch", message: `${explicitDay.d}.${explicitDay.m}.${explicitDay.y} יצא ביום ${WEEKDAY_HE[weekday(explicitDay)]}, לא ביום ${WEEKDAY_HE[wd]} — לאיזה מהם הכוונה?` };
    }
    return done(explicitDay, true);
  }
  if (/שלשום/.test(t)) return done(addDays(today, -2));
  if (/מחרתיים/.test(t)) return done(addDays(today, 2));
  if (/אתמול/.test(t)) return done(addDays(today, -1));
  if (/(?:^|\s)מחר(?=$|[\s,.])/.test(t)) return done(addDays(today, 1));

  const rel = t.match(/(לפני|בעוד|תוך|עוד)\s+(?:(\d{1,3}|[א-ת]+)\s+)?(יום|יומיים|ימים|שבוע|שבועיים|שבועות|חודש|חודשיים|חודשים)(?=$|[\s,.])/);
  if (rel) {
    const unitDays = /שבוע/.test(rel[3]) ? 7 : /חודש/.test(rel[3]) ? 30 : 1;
    let n = rel[2] ? (/^\d+$/.test(rel[2]) ? Number(rel[2]) : NUM[rel[2]] ?? NaN) : 1;
    if (/יומיים|שבועיים|חודשיים/.test(rel[3]) && !rel[2]) n = 2;
    if (!Number.isFinite(n)) return { ok: false, reason: "unknown", message: "לא הצלחתי להבין את התאריך — אפשר לכתוב תאריך, למשל 13.10.26?" };
    const sign = rel[1] === "לפני" ? -1 : 1;
    return done(addDays(today, sign * n * unitDays));
  }
  if (/שבוע\s*שעבר/.test(t)) return done(addDays(today, -7));
  if (/שבוע\s*הבא/.test(t) && wd == null) return done(addDays(today, 7));

  if (wd != null) {
    const back = /שעבר/.test(t);
    const fwd = /הבא/.test(t);
    if (dir === "past" || back) {
      let diff = (weekday(today) - wd + 7) % 7;
      if (diff === 0) diff = 7; // "ביום ראשון" said on a Sunday about something done → last week's
      if (back && diff < 7 && /שבוע\s*שעבר/.test(t)) diff += 7;
      return done(addDays(today, -diff));
    }
    let diff = (wd - weekday(today) + 7) % 7;
    if (diff === 0) diff = 7;
    if (fwd && /שבוע\s*הבא/.test(t) && diff < 7) diff += 7;
    return done(addDays(today, diff));
  }
  if (/(?:^|\s)(היום|הבוקר|הערב|הצהריים|עכשיו|כרגע|עכשיו)(?=$|[\s,.])/.test(t)) return done(today);
  return { ok: false, reason: "unknown", message: "לא הצלחתי להבין את התאריך — אפשר לכתוב תאריך, למשל 13.10.26?" };
}

/** The instant stored on the record: now for today; local noon (day precision) for an earlier day. */
export function occurredAtFor(day: string, nowMs: number, tz: string): { occurredAt: string; precision: DatePrecision } {
  const today = isoDay(localParts(nowMs, tz));
  if (day === today) return { occurredAt: new Date(nowMs).toISOString(), precision: "exact" };
  return { occurredAt: new Date(zonedToUtc(parseDay(day), 12, 0, tz)).toISOString(), precision: "day" };
}
/** Reminder due time: 08:00 local on that day. */
export const dueAtFor = (day: string, tz: string) => new Date(zonedToUtc(parseDay(day), 8, 0, tz)).toISOString();
export const localDayOf = (iso: string, tz: string) => isoDay(localParts(Date.parse(iso), tz));
export const addDaysToDay = (day: string, n: number) => isoDay(addDays(parseDay(day), n));

// ---------------------------------------------------------------- names

const PREFIX = /^(?:ו|ה|ל|ב|מ|ש|כ)/;
export const normName = (s: string) => cleanHe(s).toLowerCase().replace(/["'.,()!?:;]/g, " ").replace(/\s+/g, " ").trim();
/** Hebrew surface forms of one token: with/without one or two prefix letters and a final ה / plural ending. */
function forms(tok: string): Set<string> {
  const out = new Set<string>();
  const add = (w: string) => {
    if (w.length < 2) return;
    out.add(w);
    for (const suf of ["ות", "ים", "ה", "ת"]) if (w.length - suf.length >= 2 && w.endsWith(suf)) out.add(w.slice(0, -suf.length));
  };
  add(tok);
  let w = tok;
  for (let i = 0; i < 2 && PREFIX.test(w) && w.length > 3; i++) { w = w.replace(PREFIX, ""); add(w); }
  return out;
}
const STOP = new Set(["את", "של", "כל", "גם", "עם", "רק", "חוץ", "מלבד", "לא", "הצמח", "צמח", "הצמחים", "צמחים", "שלי", "אצלי", "ה", "ו"]);
const toks = (s: string) => normName(s).split(" ").filter((w) => w && !STOP.has(w));
/** True when every token of `ref` matches some token of `name` (Hebrew-prefix and plural tolerant). */
function phraseMatches(ref: string, name: string): boolean {
  const r = toks(ref);
  const n = toks(name);
  if (!r.length || !n.length) return false;
  return r.every((rt) => {
    if (/^#?\d+$/.test(rt)) return n.some((nt) => nt.replace("#", "") === rt.replace("#", ""));
    const rf = forms(rt);
    return n.some((nt) => [...forms(nt)].some((f) => rf.has(f)));
  });
}

export type PlantLite = Pick<Plant, "id" | "nickname" | "commonName" | "scientificName" | "ordinal" | "status" | "locationId">;

export interface RefMatch { exactNickname: PlantLite[]; all: PlantLite[] }
/** Personal plants a phrase can mean. A personal nickname that matches wins over species names. */
export function matchPlants(ref: string, plants: PlantLite[]): RefMatch {
  const exactNickname = plants.filter((p) => p.nickname && phraseMatches(ref, p.nickname) && toks(ref).length >= toks(p.nickname).length);
  const all = plants.filter((p) => [p.nickname ?? "", p.commonName, displayName(p), p.scientificName ?? "", (p.scientificName ?? "").split(" ")[0]].some((n) => n && phraseMatches(ref, n)));
  return { exactNickname, all };
}
export const looksPlural = (ref: string) => /(?:^|\s)כל(?:\s|$)/.test(normName(ref)) || toks(ref).some((t) => t.length > 4 && /(ות|ים)$/.test(t) && !/^(?:ה)?(פוטוס)$/.test(t));

export function matchLocations(ref: string, locations: Pick<Location, "id" | "name">[]): Pick<Location, "id" | "name">[] {
  const exact = locations.filter((l) => normName(l.name) === normName(ref) || [...forms(normName(ref))].includes(normName(l.name)));
  if (exact.length) return exact;
  return locations.filter((l) => phraseMatches(ref, l.name) || phraseMatches(l.name, ref));
}

export function targetFor(p: PlantLite, locName: (id?: string | null) => string | null): ProposalTarget {
  const name = displayName(p);
  const sub = p.nickname?.trim() ? (p.ordinal > 1 ? `${p.commonName} #${p.ordinal}` : p.commonName) : undefined;
  return { plantId: p.id, name, ...(sub ? { sub } : {}), location: locName(p.locationId), selected: true };
}
export const statusLabel = (s: Status) => STATUS_LABEL[s];

// ---------------------------------------------------------------- safety (treatments)

interface ProductRule { re: RegExp; label: string; active: string; group: "neonicotinoid" | "miticide" | "oil" | "soap" | "pyrethroid" | "other" }
const PRODUCTS: ProductRule[] = [
  { re: /קונפידור|confidor|imidacloprid|אימידקלופריד|אימידאקלופריד/i, label: "קונפידור", active: "אימידקלופריד (imidacloprid)", group: "neonicotinoid" },
  { re: /אקטרה|actara|thiamethoxam|תיאמטוקסם/i, label: "אקטרה", active: "תיאמתוקסם (thiamethoxam)", group: "neonicotinoid" },
  { re: /שמן\s*נים|neem/i, label: "שמן נים", active: "שמן נים", group: "oil" },
  { re: /שמן\s*(?:קיצי|פרפין|מינרלי)|summer\s*oil/i, label: "שמן קיצי", active: "שמן מינרלי", group: "oil" },
  { re: /סבון|soap/i, label: "סבון אשלגן", active: "סבון", group: "soap" },
  { re: /ורטימק|vertimec|abamectin|אבמקטין|אקרימיט|acramite|bifenazate|מילבקנוק|milbeknock/i, label: "", active: "", group: "miticide" },
];
export interface PestInfo { key: string; label: string; kind: "mite" | "insect" | "fungus" | "other" }
const PESTS: (PestInfo & { re: RegExp })[] = [
  { re: /אקרי|קרדי|עכביש\s*אדום|עכבישים|spider\s*mite|mites?\b/i, key: "spider_mites", label: "אקריות", kind: "mite" },
  { re: /כנימ(?:ה|ות)\s*קמחי|mealy/i, key: "mealybugs", label: "כנימה קמחית", kind: "insect" },
  { re: /כנימ(?:ה|ות)\s*(?:מגן|מגינ)|scale/i, key: "scale", label: "כנימות מגן", kind: "insect" },
  { re: /כנימ(?:ת|ות)\s*(?:ה)?עלה|כנימות|כנימה|aphid/i, key: "aphids", label: "כנימות עלה", kind: "insect" },
  { re: /תריפס|thrips/i, key: "thrips", label: "תריפס", kind: "insect" },
  { re: /זבוב\s*לבן|כנימת\s*עש|whitefl/i, key: "whitefly", label: "זבוב לבן", kind: "insect" },
  { re: /יתוש(?:י)?\s*(?:ה)?פטרי|זבובונים|fungus\s*gnat/i, key: "fungus_gnats", label: "יתושי פטרייה", kind: "insect" },
  { re: /קימחון|אבקית|עובש|mildew|mold/i, key: "fungal", label: "מחלה פטרייתית", kind: "fungus" },
];
export const pestInfo = (s?: string | null): PestInfo | null => {
  if (!s?.trim()) return null;
  const r = PESTS.find((p) => p.re.test(s));
  return r ? { key: r.key, label: r.label, kind: r.kind } : { key: normName(s), label: s.trim().slice(0, 40), kind: "other" };
};
export const productInfo = (s?: string | null) => {
  if (!s?.trim()) return null;
  const r = PRODUCTS.find((p) => p.re.test(s));
  return { label: r?.label || s.trim().slice(0, 40), active: r?.active || null, group: r?.group ?? "unknown" };
};
/** Same problem? (reuse an open health case instead of opening a duplicate) */
export function samePest(caseTitle: string, pest: PestInfo): boolean {
  const other = pestInfo(caseTitle);
  return Boolean(other && (other.key === pest.key || normName(caseTitle).includes(normName(pest.label))));
}

const PESTICIDE_WORDS = /לרסס|ריסוס|ריסס|להדביר|הדבר|קונפידור|confidor|חומר\s*הדברה|טיפול\s*(?:נוסף|חוזר)|לטפל\s*שוב|לטפל\s*עוד/i;
/** A reminder asking to apply a pesticide again is turned into an inspection reminder (never an auto-repeat). */
export function safeReminderText(text: string, pest?: string | null): { text: string; changed: boolean } {
  if (!PESTICIDE_WORDS.test(text)) return { text: text.trim().slice(0, 140), changed: false };
  const what = pest?.trim() ? pestInfo(pest)!.label : "מזיקים";
  return { text: `לבדוק אם עדיין יש ${what} ולהחליט לפי התווית אם צריך טיפול נוסף`, changed: true };
}

export function treatmentSafety(opts: { product?: string | null; pest?: string | null; hasOutdoor: boolean; hasPets: boolean }) {
  const prod = productInfo(opts.product);
  const pest = pestInfo(opts.pest);
  const warnings: string[] = [];
  if (prod?.group === "neonicotinoid" && pest?.kind === "mite") {
    warnings.push(`${pest.label} הן קרדיות ולא חרקים. לפי ידע כללי, ${prod.active ?? prod.label} (החומר הפעיל ב${prod.label}) לרוב לא יעיל נגדן, ויש דיווחים שהוא אף עלול להחמיר התפרצות. לכן לא אקבע ריסוס חוזר — אציע רק בדיקה חוזרת.`);
  }
  if (prod?.group === "neonicotinoid" && opts.hasOutdoor) warnings.push("חומרים מהקבוצה הזו רעילים מאוד לדבורים — לא לרסס צמחים פורחים בחוץ.");
  if (opts.hasPets && prod) warnings.push("יש בבית חיות מחמד — להרחיק אותן מהצמחים המטופלים לפי הוראות התווית.");
  if (prod) warnings.push("מינון, מרווחים ובטיחות — רק לפי התווית של המוצר. זה מידע כללי שלא נבדק מול התווית שלך.");
  const followDays = pest?.kind === "mite" ? 7 : 7;
  const followText = pest?.kind === "mite" ? "בדיקה חוזרת לאקריות: גב העלים, קורים דקים ונקודות בהירות"
    : pest ? `בדיקה חוזרת: האם עדיין יש ${pest.label}` : "בדיקה חוזרת אחרי הטיפול";
  return { prod, pest, warnings, followDays, followText };
}

// ---------------------------------------------------------------- summary text (Hebrew, deterministic)

export const recordCount = (p: Pick<ActionProposal, "targets">) => p.targets.filter((t) => t.selected).reduce((n, t) => n + (t.records?.length ?? 0), 0);

export function proposalQuestion(p: Pick<ActionProposal, "action" | "targets" | "scopeLabel" | "dateLabel" | "details">): string {
  const n = p.targets.filter((t) => t.selected).length;
  if (isRecordKind(p.action)) {
    if (!n) return "לא נשארו צמחים ברשימה. אפשר לבטל.";
    const r = recordCount(p);
    const d = p.details;
    const q = p.action === "resolve_issue" ? `לסמן ש${n === 1 ? "הצמח החלים" : "הצמחים החלימו"}? הרישום יישאר בהיסטוריה.`
      : p.action === "remove_issue" ? `למחוק את ${r === 1 ? "הרישום" : `${r} הרישומים`} כי ${r === 1 ? "הוא היה שגוי" : "הם היו שגויים"}?${d.keepTreatments ? " הטיפולים עצמם יישארו." : ""}`
      : p.action === "delete_records" ? `למחוק ${r === 1 ? "את הרישום" : `${r} רישומים`}?`
      : p.action === "redate_records" ? `להעביר ${r === 1 ? "את הרישום" : `${r} רישומים`} ל${d.newDateLabel?.split(" · ")[1] ?? d.newDay}?`
      : p.action === "edit_records" ? `לעדכן ${r === 1 ? "את הרישום" : `${r} רישומים`}${d.newProduct ? ` — חומר: ${d.newProduct}` : ""}${d.newPest ? ` — בעיה: ${d.newPest}` : ""}?`
      : p.action === "cancel_reminders" ? `לבטל ${r === 1 ? "את התזכורת" : `${r} תזכורות`}?`
      : p.action === "redate_reminders" ? `להעביר ${r === 1 ? "את התזכורת" : `${r} תזכורות`} ל${d.newDateLabel?.split(" · ")[1] ?? d.newDay}?`
      : `לבטל את "${d.undoTitle ?? ""}"${n > 1 ? ` ב־${n} צמחים` : ""}?`;
    return `${p.scopeLabel}. ${q}`;
  }
  const what = p.action === "water" ? "השקיה" : p.action === "fertilize" ? "דישון" : p.action === "soil_check" ? `בדיקת אדמה (${SOIL_LABEL[p.details.soil ?? "slightly_moist"]})`
    : p.action === "treatment" ? `טיפול${p.details.product ? ` ב${p.details.product}` : ""}${p.details.pest ? ` נגד ${p.details.pest}` : ""}`
    : p.action === "move" ? `העברה ל${p.details.toLocationName ?? ""}` : p.action === "reminder" ? `תזכורת: ${p.details.reminderText ?? ""}` : "הערה";
  const when = p.dateLabel.split(" · ")[0];
  const count = n === 1 ? `ל${p.targets.find((t) => t.selected)!.name}` : `ל־${n} הצמחים`;
  if (!n) return "לא נשארו צמחים ברשימה. אפשר להוסיף צמחים או לבטל.";
  return `${p.scopeLabel}. לשמור ${what} ${count} ${p.action === "reminder" ? `(${when})` : `— ${when}`}?`;
}

// ---------------------------------------------------------------- the records of a confirmed card

const EVENT_TYPE: Partial<Record<ActionProposal["action"], string>> = { water: "watering", fertilize: "fertilizing", soil_check: "soil_check", treatment: "treatment_started", move: "location_changed", note: "note" };

export const actionTitle = (p: ActionProposal): string =>
  p.action === "undo" ? `ביטול: ${p.details.undoTitle ?? ""}` : isRecordKind(p.action) ? `${ACTION_LABEL[p.action]}${p.details.recordsLabel ? ` · ${p.details.recordsLabel}` : ""}` : p.action === "treatment" ? (p.details.pest ? `טיפול נגד ${p.details.pest}` : "טיפול") : p.action === "move" ? `העברה ל${p.details.toLocationName ?? ""}` : p.action === "reminder" ? `תזכורת: ${p.details.reminderText ?? ""}` : ACTION_LABEL[p.action];

export interface Affected { plant: Plant | undefined; plantId: string; name: string; event?: PlantEvent; issue?: HealthCase; reminder?: Reminder; result: string }

/** Per plant: the stored record of this card (matched by the card id, or — for cards saved before 2026-10-18 — by type, source and the exact stored instant). */
export function affectedPlants(p: ActionProposal, plants: Plant[], events: PlantEvent[], cases: HealthCase[], reminders: Reminder[]): Affected[] {
  const type = EVENT_TYPE[p.action];
  return (p.confirmedIds ?? []).map((id) => {
    const event = type ? events.find((e) => e.plantId === id && !e.deletedAt && e.type === type && e.payload?.via === "ai_chat" && (e.payload.actionId === p.id || (!e.payload.actionId && e.occurredAt === p.occurredAt))) : undefined;
    const issue = p.action === "treatment" ? cases.find((c) => c.id === event?.payload.healthCaseId) : undefined;
    const want = p.action === "reminder" ? { text: p.details.reminderText, at: p.occurredAt } : p.followUp ? { text: p.followUp.text, at: p.followUp.dueAt } : null;
    const reminder = want ? reminders.find((r) => r.plantId === id && !r.deletedAt && (r.groupId === p.id || (!r.groupId && r.source === "ai_confirmed" && r.text === want.text && r.nextAt === want.at))) : undefined;
    const plant = plants.find((x) => x.id === id);
    return { plant, plantId: id, name: plant ? displayName(plant) : p.targets.find((t) => t.plantId === id)?.name ?? "", event, issue, reminder, result: p.results?.[id] ?? "pending" };
  });
}


// ---------------------------------------------------------------- undo: what a card changed

/** Records a card changed. Cards saved before the change log existed: rebuilt from their deterministic record ids. */
export async function appliedOf(card: ActionProposal, existing: (ids: string[]) => Promise<Set<string>>, rid: (...parts: string[]) => Promise<string>): Promise<{ applied: Applied[]; notUndoable: string[] }> {
  if (card.applied?.length) return { applied: card.applied, notUndoable: [] };
  const saved = Object.entries(card.results ?? {}).filter(([, r]) => r === "saved").map(([id]) => id);
  const kinds: Record<string, [Applied["entity"], string, string][]> = {
    water: [["event", "e", "השקיה"]], fertilize: [["event", "e", "דישון"]], soil_check: [["event", "e", "בדיקת אדמה"]], note: [["event", "e", "הערה"]],
    reminder: [["reminder", "r", "תזכורת"]], move: [["event", "e", "שינוי מיקום"]],
    treatment: [["event", "e", "טיפול"], ["health", "hc", "בעיה"], ["event", "dx", "דיווח על בעיה"], ["reminder", "fu", "תזכורת לבדיקה"]],
  };
  const cand: Applied[] = [];
  for (const pid of saved) for (const [entity, n, label] of kinds[card.action] ?? []) cand.push({ entity, id: await rid(card.id, pid, n), plantId: pid, label, created: true });
  const have = await existing(cand.map((c) => `${c.entity}|${c.id}`));
  return { applied: cand.filter((c) => have.has(`${c.entity}|${c.id}`)), notUndoable: card.action === "move" ? ["המיקום הקודם של הצמחים לא נשמר בכרטיס הזה — את ההעברה עצמה צריך לתקן ידנית."] : [] };
}

