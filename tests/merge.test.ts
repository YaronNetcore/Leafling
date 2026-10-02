import { describe, expect, it } from "vitest";
import type { Mutation } from "../src/shared/types.ts";
import { planBatch, type StoredRecord } from "../src/worker/merge.ts";

const m = (over: Partial<Mutation>): Mutation => ({
  mutationId: Math.random().toString(36).slice(2), entity: "plant", recordId: "p1", patch: {}, baseRev: 0,
  clientTime: "2026-10-01T10:00:00Z", deviceId: "phone", ...over,
});

describe("server-ordered field merge", () => {
  it("applies a clean edit without conflict", () => {
    const cur = new Map<string, StoredRecord>([["plant|p1", { data: { nickname: "a" }, fieldRevs: { nickname: 5 }, rev: 5 }]]);
    const [p] = planBatch([m({ patch: { nickname: "b" }, baseRev: 5 })], cur, 6);
    expect(p.seq).toBe(6);
    expect(p.conflicts).toEqual([]);
    expect(p.next!.data.nickname).toBe("b");
  });

  it("orders by server receipt, never by device clocks, and preserves the overwritten value", () => {
    const cur = new Map<string, StoredRecord>([["plant|p1", { data: { nickname: "from-desktop" }, fieldRevs: { nickname: 7 }, rev: 7 }]]);
    // The phone's clock is years in the past; it still wins because it was received later — and the old value is kept.
    const [p] = planBatch([m({ patch: { nickname: "from-phone" }, baseRev: 5, clientTime: "2001-01-01T00:00:00Z" })], cur, 8);
    expect(p.next!.data.nickname).toBe("from-phone");
    expect(p.conflicts).toEqual([{ field: "nickname", overwritten: "from-desktop", incoming: "from-phone", overwrittenRev: 7 }]);
  });

  it("treats a device's own consecutive queued edits as sequential, not conflicts", () => {
    const cur = new Map<string, StoredRecord>([["plant|p1", { data: { status: "plant" }, fieldRevs: { status: 3 }, rev: 3 }]]);
    const out = planBatch([m({ patch: { status: "sick" }, baseRev: 3 }), m({ patch: { status: "plant" }, baseRev: 3 })], cur, 4);
    expect(out.map((o) => o.conflicts.length)).toEqual([0, 0]);
    expect(out[1].next!.data.status).toBe("plant");
  });

  it("does not record a conflict when the other field changed", () => {
    const cur = new Map<string, StoredRecord>([["plant|p1", { data: { nickname: "x", status: "plant" }, fieldRevs: { nickname: 9, status: 2 }, rev: 9 }]]);
    const [p] = planBatch([m({ patch: { status: "sick" }, baseRev: 2 })], cur, 10);
    expect(p.conflicts).toEqual([]);
    expect(p.next!.data).toMatchObject({ nickname: "x", status: "sick" });
  });

  it("identical values are a no-op", () => {
    const cur = new Map<string, StoredRecord>([["plant|p1", { data: { nickname: "a" }, fieldRevs: { nickname: 4 }, rev: 4 }]]);
    const [p] = planBatch([m({ patch: { nickname: "a" }, baseRev: 1 })], cur, 5);
    expect(p.seq).toBeNull();
  });

  it("new records and append-only events never conflict", () => {
    const out = planBatch([m({ entity: "event", recordId: "e1", patch: { type: "watering" } }), m({ entity: "event", recordId: "e2", patch: { type: "soil_check" } })], new Map(), 1);
    expect(out.map((o) => o.seq)).toEqual([1, 2]);
    expect(out.every((o) => !o.conflicts.length)).toBe(true);
  });
});
