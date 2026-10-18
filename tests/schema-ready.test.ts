// Regression for the 2026-10-18 blank app: a request that is cancelled while checking the schema must not leave a
// pending promise that every later request awaits (Workers ties a promise's I/O to the request that created it).
import { describe, expect, it } from "vitest";
import { ensureAppSchema } from "../src/worker/schema.ts";

const stmt = (first: () => Promise<unknown>) => ({ bind: () => stmt(first), first, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) });
// A D1 whose queries never answer — like the I/O of a request that was cancelled mid-flight.
const stuck = { prepare: () => stmt(() => new Promise(() => undefined)) } as unknown as D1Database;
// A healthy D1 at schema v3.
let reads = 0;
const healthy = { prepare: (sql: string) => stmt(async () => { reads++; return /sqlite_master/.test(sql) ? { n: 1 } : { value: "3" }; }) } as unknown as D1Database;

describe("ensureAppSchema", () => {
  it("a later request is not blocked by an earlier request's unfinished schema check", async () => {
    void ensureAppSchema(stuck); // first request of a fresh isolate — never completes (cancelled)
    const second = Promise.race([ensureAppSchema(healthy).then(() => "ok"), new Promise((r) => setTimeout(() => r("hung"), 1000))]);
    expect(await second).toBe("ok");
  });
  it("after one successful check, later requests skip the database entirely", async () => {
    const before = reads;
    await ensureAppSchema(healthy);
    await ensureAppSchema(stuck); // would hang if it touched the database
    expect(reads).toBe(before);
  });
});
