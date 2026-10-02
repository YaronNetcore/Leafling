import type { Species } from "./species.ts";
import type { Confidence, Plant, PlantEvent, Reminder, Status } from "./types.ts";

// Pure domain rules shared by client and Worker. No I/O.

export const DAY = 86_400_000;
export const STATUS_LABEL: Record<Status, string> = { rooting: "בהשרשה", seedling: "שתיל", plant: "צמח", sick: "חולה" };

/** "Monstera deliciosa", "#2", "#3" … never "#1". Nickname replaces the display name only. */
export function displayName(p: Pick<Plant, "nickname" | "commonName" | "ordinal">): string {
  if (p.nickname?.trim()) return p.nickname.trim();
  return p.ordinal > 1 ? `${p.commonName} #${p.ordinal}` : p.commonName;
}

/** Ordinals are per species, monotonic and never reused (deleted plants keep theirs). */
export function nextOrdinal(all: Pick<Plant, "speciesId" | "scientificName" | "ordinal">[], speciesKey: string): number {
  const same = all.filter((p) => (p.speciesId ?? p.scientificName) === speciesKey);
  return same.reduce((m, p) => Math.max(m, p.ordinal), 0) + 1;
}

export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const daysBetween = (a: number, b: number) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const isCoolSeason = (t: number) => { const m = new Date(t).getMonth() + 1; return m >= 11 || m <= 3; };

export interface DryDown { cycles: number[]; typicalMin?: number; typicalMax?: number; confidence: Confidence }

/**
 * Personal dry-down cycles: days from a watering to the next soil check recorded as "dry".
 * A pattern is only claimed with >= 3 cycles; one event is never a pattern.
 */
export function dryDown(events: PlantEvent[]): DryDown {
  const ev = events.filter((e) => !e.deletedAt).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const cycles: number[] = [];
  let lastWater: number | null = null;
  for (const e of ev) {
    const t = Date.parse(e.occurredAt);
    if (e.type === "watering") lastWater = t;
    else if (e.type === "soil_check" && e.payload.result === "dry" && lastWater != null) {
      const d = (t - lastWater) / DAY;
      if (d >= 0.5 && d <= 60) cycles.push(Math.round(d * 10) / 10);
      lastWater = null;
    }
  }
  if (cycles.length < 3) return { cycles, confidence: "insufficient" };
  const s = [...cycles].sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.2)], hi = s[Math.ceil(s.length * 0.8) - 1];
  const spread = (hi - lo) / Math.max(1, median(s));
  const confidence: Confidence = s.length >= 8 && spread < 0.5 ? "known" : s.length >= 5 ? "likely" : "possible";
  return { cycles, typicalMin: Math.round(lo), typicalMax: Math.round(hi), confidence };
}

export interface SoilCheckPlan {
  nextCheckAt: number;
  basis: "species" | "blended" | "default";
  personalWeight: number;
  lastWateringAt?: number;
  lastCheckAt?: number;
  dry: DryDown;
}

/** Soil-check model (never "water every X days"): when to *check*, not when to water. */
export function soilCheckPlan(plant: Plant, events: PlantEvent[], sp: Species | undefined, now: number): SoilCheckPlan {
  const ev = events.filter((e) => e.plantId === plant.id && !e.deletedAt).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const dry = dryDown(ev);
  const prior = sp?.checkDays ?? [5, 9];
  const n = dry.cycles.length;
  const personal = n ? median(dry.cycles) : prior[0];
  const w = n >= 3 ? n / (n + 4) : 0;
  let interval = w * personal + (1 - w) * prior[0];
  if (isCoolSeason(now)) interval *= 1.4;
  interval = Math.max(1, Math.round(interval));

  const last = (types: string[]) => [...ev].reverse().find((e) => types.includes(e.type));
  const lastWater = last(["watering"]);
  const lastCheck = last(["soil_check"]);
  const lastPostpone = last(["task_postponed"]);
  const created = Date.parse(plant.createdAt);
  let next: number;
  const lw = lastWater ? Date.parse(lastWater.occurredAt) : undefined;
  const lc = lastCheck ? Date.parse(lastCheck.occurredAt) : undefined;
  if (lc && (!lw || lc > lw)) {
    const r = lastCheck!.payload.result;
    next = r === "very_moist" ? lc + Math.max(2, Math.round(interval / 2)) * DAY
      : r === "slightly_moist" ? lc + Math.max(1, Math.round(interval / 3)) * DAY
      : lc + 1 * DAY; // dry but not watered → look again tomorrow
  } else if (lw) next = lw + interval * DAY;
  else next = created + Math.min(interval, 2) * DAY;
  if (lastPostpone) {
    const until = Date.parse(String(lastPostpone.payload.until ?? ""));
    if (lastPostpone.payload.task === "soil_check" && until > next && Date.parse(lastPostpone.occurredAt) >= (lc ?? 0)) next = until;
  }
  return { nextCheckAt: next, basis: w > 0 ? "blended" : sp ? "species" : "default", personalWeight: w, lastWateringAt: lw, lastCheckAt: lc, dry };
}

export interface FertilizePlan { applicable: boolean; inSeason: boolean; nextWindowAt?: number; lastAt?: number }

export function fertilizePlan(plant: Plant, events: PlantEvent[], sp: Species | undefined, now: number): FertilizePlan {
  if (!sp?.fertilize.intervalDays || plant.status === "rooting" || plant.status === "sick") return { applicable: false, inSeason: false };
  const month = new Date(now).getMonth() + 1;
  const inSeason = sp.fertilize.seasonMonths.includes(month);
  const last = events.filter((e) => e.plantId === plant.id && !e.deletedAt && (e.type === "fertilizing" || e.type === "fertilizer_skipped"))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const lastAt = last ? Date.parse(last.occurredAt) : undefined;
  const nextWindowAt = (lastAt ?? Date.parse(plant.createdAt)) + sp.fertilize.intervalDays * DAY;
  return { applicable: true, inSeason, nextWindowAt, lastAt };
}

export type TaskKind = "soil_check" | "fertilize" | "rooting_check" | "seedling_check" | "reminder";
export interface Task { key: string; kind: TaskKind; plantId: string; dueAt: number; overdueDays: number; important: boolean; reminderId?: string; text?: string }

/** Today's tasks. Suggestions (photos, light) are separate and never overdue. */
export function todayTasks(plants: Plant[], events: PlantEvent[], reminders: Reminder[], speciesOf: (p: Plant) => Species | undefined, now: number): Task[] {
  const endOfToday = startOfDay(now) + DAY - 1;
  const tasks: Task[] = [];
  const byPlant = new Map<string, PlantEvent[]>();
  for (const e of events) { if (!byPlant.has(e.plantId)) byPlant.set(e.plantId, []); byPlant.get(e.plantId)!.push(e); }
  for (const p of plants) {
    if (p.deletedAt || p.archivedAt) continue;
    const ev = byPlant.get(p.id) ?? [];
    const sp = speciesOf(p);
    if (p.status === "plant" || p.status === "sick" || (p.status === "seedling" && (p.germinatedCount ?? 0) > 0)) {
      const plan = soilCheckPlan(p, ev, sp, now);
      if (plan.nextCheckAt <= endOfToday) tasks.push({ key: `soil:${p.id}`, kind: "soil_check", plantId: p.id, dueAt: plan.nextCheckAt, overdueDays: Math.max(0, daysBetween(plan.nextCheckAt, now)), important: true });
      const f = fertilizePlan(p, ev, sp, now);
      if (f.applicable && f.inSeason && f.nextWindowAt && f.nextWindowAt <= endOfToday) tasks.push({ key: `fert:${p.id}`, kind: "fertilize", plantId: p.id, dueAt: f.nextWindowAt, overdueDays: 0, important: false });
    }
    if (p.status === "rooting" || (p.status === "seedling" && !(p.germinatedCount ?? 0))) {
      const kind: TaskKind = p.status === "rooting" ? "rooting_check" : "seedling_check";
      const every = p.status === "rooting" ? 4 : 2;
      const lastCheck = ev.filter((e) => ["root_check", "water_change", "germination_update", "soil_check"].includes(e.type)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
      const postponed = ev.filter((e) => e.type === "task_postponed" && e.payload.task === kind).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
      let due = (lastCheck ? Date.parse(lastCheck.occurredAt) : Date.parse(p.createdAt)) + every * DAY;
      if (postponed && Date.parse(String(postponed.payload.until)) > due) due = Date.parse(String(postponed.payload.until));
      if (due <= endOfToday) tasks.push({ key: `${kind}:${p.id}`, kind, plantId: p.id, dueAt: due, overdueDays: 0, important: true });
    }
  }
  for (const r of reminders) {
    if (!r.active || r.deletedAt) continue;
    const due = Date.parse(r.nextAt);
    if (due <= endOfToday && plants.some((p) => p.id === r.plantId && !p.deletedAt && !p.archivedAt)) {
      tasks.push({ key: `rem:${r.id}`, kind: "reminder", plantId: r.plantId, dueAt: due, overdueDays: 0, important: Boolean(r.important), reminderId: r.id, text: r.text });
    }
  }
  return tasks.sort((a, b) => a.dueAt - b.dueAt);
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  known: "ידוע / גבוה",
  likely: "סביר / בינוני",
  possible: "אפשרי / נמוך",
  insufficient: "אין מספיק מידע",
};

export function relativeDays(target: number, now: number): string {
  const d = daysBetween(now, target);
  if (d === 0) return "היום";
  if (d === 1) return "מחר";
  if (d === 2) return "בעוד יומיים";
  if (d > 2) return `בעוד ${d} ימים`;
  if (d === -1) return "אתמול";
  return `לפני ${-d} ימים`;
}
