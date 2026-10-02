import type { Mutation } from "../shared/types.ts";

// Pure, testable field-level merge. Ordering comes ONLY from server revisions and
// server receipt order; client timestamps are metadata. Every overwritten value of a
// concurrent edit is returned as a conflict record so it can be preserved and restored.

export interface StoredRecord { data: Record<string, unknown>; fieldRevs: Record<string, number>; rev: number }
export interface ConflictOut { field: string; overwritten: unknown; incoming: unknown; overwrittenRev: number }
export interface PlannedWrite {
  mutation: Mutation;
  seq: number | null; // null = noop (nothing changed)
  next: StoredRecord | null;
  conflicts: ConflictOut[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SERVER_FIELDS = new Set(["_rev"]);

/**
 * Plans writes for a batch in receipt order. `current` is the stored state at read time;
 * `firstSeq` is the next free change sequence. Later mutations in the same batch see the
 * results of earlier ones. A device's own consecutive edits from the same baseRev are
 * sequential, not conflicts.
 */
export function planBatch(mutations: Mutation[], current: Map<string, StoredRecord>, firstSeq: number): PlannedWrite[] {
  const state = new Map(current);
  const touched = new Map<string, { deviceId: string; baseRev: number }>();
  let seq = firstSeq;
  const out: PlannedWrite[] = [];
  for (const m of mutations) {
    const key = `${m.entity}|${m.recordId}`;
    const cur = state.get(key) ?? { data: {}, fieldRevs: {}, rev: 0 };
    const patch = Object.fromEntries(Object.entries(m.patch).filter(([k]) => !SERVER_FIELDS.has(k)));
    const changed = Object.entries(patch).filter(([k, v]) => !same(cur.data[k], v));
    if (!changed.length && state.has(key)) { out.push({ mutation: m, seq: null, next: null, conflicts: [] }); continue; }
    const conflicts: ConflictOut[] = [];
    for (const [field, value] of changed) {
      if (field === "updatedAt") continue;
      const fieldRev = cur.fieldRevs[field] ?? 0;
      const t = touched.get(`${key}|${field}`);
      const sequentialOwnEdit = t && t.deviceId === m.deviceId && t.baseRev === m.baseRev;
      if (fieldRev > m.baseRev && !sequentialOwnEdit && field in cur.data) {
        conflicts.push({ field, overwritten: cur.data[field], incoming: value, overwrittenRev: fieldRev });
      }
    }
    const thisSeq = seq++;
    const next: StoredRecord = {
      data: { ...cur.data, ...patch, id: m.recordId },
      fieldRevs: { ...cur.fieldRevs, ...Object.fromEntries(changed.map(([k]) => [k, thisSeq])) },
      rev: thisSeq,
    };
    state.set(key, next);
    for (const [k] of changed) touched.set(`${key}|${k}`, { deviceId: m.deviceId, baseRev: m.baseRev });
    out.push({ mutation: m, seq: thisSeq, next, conflicts });
  }
  return out;
}
