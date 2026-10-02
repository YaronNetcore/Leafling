// FROZEN COPY of the context builder before 2026-10 (src/worker/ai.ts at b1b214d), kept ONLY to measure
// the context-size / round-trip change. Not used by the app.
import { HttpError } from "../../src/worker/http.ts";
type PlantRow = { [k: string]: unknown };
type Env = { DB: { prepare: (q: string) => { bind: (...a: unknown[]) => { first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }> } } } };
export async function oldBuildPlantContext(env: Env, userId: string, plantId: string, question: string) {
  const sections: string[] = [];
  const rec = await env.DB.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'plant' AND id = ?`).bind(userId, plantId).first<{ data: string }>();
  if (!rec) throw new HttpError(404, "plant_not_found");
  const p = JSON.parse(rec.data) as PlantRow;
  if (p.deletedAt) throw new HttpError(404, "plant_not_found");
  const ctx: Record<string, unknown> = {
    plant: {
      name: p.nickname || (Number(p.ordinal) > 1 ? `${p.commonName} #${p.ordinal}` : p.commonName),
      species: { he: p.commonName, scientific: p.scientificName },
      status: p.status, acquiredAt: p.acquiredAt ?? null, potDiameterCm: p.potDiameterCm ?? null, potMaterial: p.potMaterial ?? null,
      substrate: p.substrate ?? null, sowDate: p.sowDate ?? null, seedCount: p.seedCount ?? null, germinatedCount: p.germinatedCount ?? null,
      propagationMethod: p.propagationMethod ?? null, rootState: p.rootState ?? null,
    },
  };
  sections.push("plant");
  if (p.locationId) {
    const loc = await env.DB.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'location' AND id = ?`).bind(userId, String(p.locationId)).first<{ data: string }>();
    if (loc) { const l = JSON.parse(loc.data); ctx.location = { name: l.name, kind: l.kind, lightCategory: l.lightCategory ?? null, windowDirection: l.windowDirection ?? null, directSun: l.directSun ?? null }; sections.push("location"); }
  }
  const evRows = (await env.DB.prepare(
    `SELECT data FROM user_records WHERE user_id = ? AND entity = 'event' AND json_extract(data, '$.plantId') = ? ORDER BY json_extract(data, '$.occurredAt') DESC LIMIT 40`,
  ).bind(userId, plantId).all<{ data: string }>()).results;
  const events = evRows.map((r) => JSON.parse(r.data)).filter((e) => !e.deletedAt)
    .map((e) => ({ date: String(e.occurredAt).slice(0, 10), type: e.type, details: e.payload ?? {} }));
  if (events.length) { ctx.recentHistory = events; sections.push("history"); }
  const health = (await env.DB.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'health' AND json_extract(data, '$.plantId') = ? ORDER BY rev DESC LIMIT 5`).bind(userId, plantId).all<{ data: string }>()).results
    .map((r) => JSON.parse(r.data)).filter((h) => !h.deletedAt).map((h) => ({ title: h.title, state: h.state, likelyCause: h.likelyCause ?? null, source: h.source }));
  if (health.length) { ctx.healthCases = health; sections.push("health"); }
  // Light observations for THIS plant (or its location). Estimates are labelled as estimates, never as lux.
  const lightRows = (await env.DB.prepare(
    `SELECT data FROM user_records WHERE user_id = ? AND entity = 'light' AND (json_extract(data, '$.plantId') = ? OR (? IS NOT NULL AND json_extract(data, '$.locationId') = ?)) ORDER BY json_extract(data, '$.measuredAt') DESC LIMIT 6`,
  ).bind(userId, plantId, p.locationId ? String(p.locationId) : null, p.locationId ? String(p.locationId) : null).all<{ data: string }>()).results
    .map((r) => JSON.parse(r.data)).filter((l) => !l.deletedAt);
  if (lightRows.length) {
    ctx.lightObservations = lightRows.map((l) => ({
      date: String(l.measuredAt).slice(0, 10), category: l.category, forThisPlant: l.plantId === plantId,
      source: l.method === "camera_live_dark" ? "rough estimate: the live phone camera stayed dark at its sensitivity limit, i.e. a dim spot (NOT a calibrated light meter)"
        : l.method === "camera_live_user" ? "user's own visual estimate of the spot (hand-shadow test), NOT a measurement"
        : l.method === "camera_exposure" ? "rough estimate from phone camera exposure (NOT a calibrated light meter)"
        : l.method === "user_choice" ? "user's own estimate" : l.method === "manual_lux" ? "external lux meter (user-entered)" : "older rough estimate",
    }));
    sections.push("light");
  }
  const prof = await env.DB.prepare(`SELECT data FROM user_records WHERE user_id = ? AND entity = 'profile' AND id = 'me'`).bind(userId).first<{ data: string }>();
  if (prof) {
    const pr = JSON.parse(prof.data);
    ctx.user = { region: [pr.region, pr.country].filter(Boolean).join(", ") || null, experience: pr.experience ?? null };
    // Pets: kinds with counts only (toxicity depends on the species of animal; names are not needed).
    if (/חי|חתול|כלב|ציפור|ארנב|מכרסם|זוחל|רעיל|בטיח|pet|toxic/i.test(question) && Array.isArray(pr.pets)) {
      const counts: Record<string, number> = {};
      for (const x of pr.pets as { kind?: unknown }[]) if (typeof x?.kind === "string") counts[x.kind] = (counts[x.kind] ?? 0) + 1;
      ctx.user = { ...(ctx.user as object), pets: Object.entries(counts).map(([kind, count]) => ({ kind, count })) };
    }
    sections.push("user");
  }
  return { ctx, sections };
}
