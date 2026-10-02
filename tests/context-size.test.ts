// Measures the AI context before (frozen copy of the old builder) and after (ai-context.ts) on the same,
// realistic plant history. Local SQLite timings are not production D1 latency; the comparison that matters
// is payload size and the number of sequential database round trips.
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectTopics, loadPlantContext } from "../src/worker/ai-context.ts";
import { oldBuildPlantContext } from "./helpers/old-context.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness } from "./helpers/worker.ts";

let h: Harness, A: Client;
const P = "ctx-plant";
const QUESTIONS: Record<string, string> = {
  watering: "מתי להשקות אותו? האדמה עדיין לחה",
  propagation: "אפשר להעביר את הייחור לעציץ? יש שני שורשים",
  health: "למה העלים התחתונים מצהיבים?",
  general: "מה שלומו?",
};
const results: Record<string, unknown>[] = [];

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, { sub: "aaaaaaaa-5555-4000-8000-00000000000a", email: OWNER_EMAIL });
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const types = ["watering", "soil_check", "soil_check", "watering", "fertilizing", "note", "root_check", "photo_added", "measurement", "milestone"];
  const muts: Record<string, unknown>[] = [
    mut("profile", "me", { id: "me", region: "מרכז", country: "ישראל", experience: "some", pets: [{ id: "d1", kind: "dog", name: "רקס" }] }),
    mut("location", "loc", { id: "loc", name: "חלון מזרחי בסלון", kind: "indoor", lightCategory: "bright_indirect", windowDirection: "east" }),
    mut("plant", P, { id: P, commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 1, locationId: "loc", potDiameterCm: 21, potMaterial: "פלסטיק", substrate: "מצע אראונים", acquiredAt: "2025-03-01", propagationMethod: "ייחור במים", rootState: "growing" }),
    mut("health", "h1", { id: "h1", plantId: P, title: "כתמים חומים", state: "monitoring", source: "user", likelyCause: "השקיית יתר בחורף — נראה שהשתפר אחרי שינוי בתדירות" }),
    mut("light", "l1", { id: "l1", plantId: P, locationId: "loc", category: "bright_indirect", method: "camera_live_user", estimate: true, measuredAt: day(10) }),
  ];
  for (let i = 0; i < 60; i++) muts.push(mut("event", `e${i}`, { id: `e${i}`, plantId: P, type: types[i % types.length], occurredAt: day(i * 3), payload: { note: i % 4 === 0 ? "נראה טוב, עלה חדש מתפתח ליד הבסיס ויש שורש אווירי ארוך" : undefined, result: i % 3 === 0 ? "dry" : "moist" } }));
  for (let i = 0; i < muts.length; i += 8) await A.push(muts.slice(i, i + 8));
}, 120_000);
afterAll(async () => {
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(results, null, 2));
  await h?.mf.dispose();
});

describe("context size before vs after", () => {
  for (const [topic, q] of Object.entries(QUESTIONS)) {
    it(`${topic} question`, async () => {
      const db = await h.mf.getD1Database("DB");
      let t = performance.now();
      const old = await oldBuildPlantContext({ DB: db as never }, A.userId, P, q);
      const oldMs = performance.now() - t;
      t = performance.now();
      const neu = await loadPlantContext({ DB: db } as never, A.userId, { plantId: P, topics: detectTopics(q) });
      const newMs = performance.now() - t;
      const oldChars = JSON.stringify(old.ctx).length, newChars = JSON.stringify(neu.ctx).length;
      results.push({ topic, question: q, oldChars, newChars, reduction: `${Math.round((1 - newChars / oldChars) * 100)}%`, oldRoundTrips: 6, newRoundTrips: 1, oldLocalMs: Math.round(oldMs * 10) / 10, newLocalMs: Math.round(newMs * 10) / 10, newSections: neu.sections });
      expect(newChars).toBeLessThan(oldChars);
      expect(JSON.stringify(neu.ctx)).not.toContain("photo_added");
    });
  }
});
