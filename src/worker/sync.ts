import type { Entity, Mutation, MutationResult } from "../shared/types.ts";
import type { AppEnv } from "./env.ts";
import { HttpError, json, logEvent, readJson } from "./http.ts";
import { planBatch, type StoredRecord } from "./merge.ts";

// Idempotent push + delta pull over the generic record store.
// Concurrency: change sequences are assigned explicitly (read max + 1 …). Two concurrent
// batches would claim the same seq; the PRIMARY KEY makes the later batch fail atomically,
// and the client simply retries with fresh state — an optimistic compare-and-set.

const ENTITIES = new Set<Entity>(["plant", "event", "location", "light", "photo", "wishlist", "health", "profile", "reminder"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_BATCH = 8; // keeps statements per invocation well under the Free plan's 50 D1 queries

function validate(m: Mutation): void {
  if (!m || typeof m !== "object") throw new HttpError(400, "bad_mutation");
  if (typeof m.mutationId !== "string" || !ID_RE.test(m.mutationId)) throw new HttpError(400, "bad_mutation_id");
  if (!ENTITIES.has(m.entity)) throw new HttpError(400, "bad_entity");
  if (typeof m.recordId !== "string" || !ID_RE.test(m.recordId)) throw new HttpError(400, "bad_record_id");
  if (!m.patch || typeof m.patch !== "object" || Array.isArray(m.patch)) throw new HttpError(400, "bad_patch");
  if (JSON.stringify(m.patch).length > 32_000) throw new HttpError(413, "patch_too_large");
  if (!Number.isInteger(m.baseRev) || m.baseRev < 0) throw new HttpError(400, "bad_base_rev");
}

export async function push(req: Request, env: AppEnv): Promise<Response> {
  const body = await readJson<{ mutations: Mutation[] }>(req, 300_000);
  if (!Array.isArray(body.mutations) || !body.mutations.length) throw new HttpError(400, "no_mutations");
  if (body.mutations.length > MAX_BATCH) throw new HttpError(400, "batch_too_large");
  body.mutations.forEach(validate);
  const db = env.DB;
  const now = new Date().toISOString();

  const ids = body.mutations.map((m) => m.mutationId);
  const dupRows = (await db.prepare(`SELECT mutation_id, seq, result FROM app_mutations WHERE mutation_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids).all<{ mutation_id: string; seq: number | null; result: string }>()).results;
  const dup = new Map(dupRows.map((r) => [r.mutation_id, r]));
  const fresh = body.mutations.filter((m) => !dup.has(m.mutationId));

  const keys = [...new Set(fresh.map((m) => `${m.entity}|${m.recordId}`))];
  const current = new Map<string, StoredRecord>();
  if (keys.length) {
    const rows = (await db.prepare(`SELECT entity, id, data, field_revs, rev FROM app_records WHERE (entity || '|' || id) IN (${keys.map(() => "?").join(",")})`)
      .bind(...keys).all<{ entity: string; id: string; data: string; field_revs: string; rev: number }>()).results;
    for (const r of rows) current.set(`${r.entity}|${r.id}`, { data: JSON.parse(r.data), fieldRevs: JSON.parse(r.field_revs), rev: r.rev });
  }
  const maxRow = await db.prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM app_changes`).first<{ s: number }>();
  const plan = planBatch(fresh, current, (maxRow?.s ?? 0) + 1);

  const stmts: D1PreparedStatement[] = [];
  for (const p of plan) {
    const m = p.mutation;
    if (p.seq == null || !p.next) {
      stmts.push(db.prepare(`INSERT INTO app_mutations (mutation_id, seq, result, at) VALUES (?, NULL, 'noop', ?)`).bind(m.mutationId, now));
      continue;
    }
    stmts.push(db.prepare(`INSERT INTO app_changes (seq, entity, id, mutation_id, at) VALUES (?, ?, ?, ?, ?)`).bind(p.seq, m.entity, m.recordId, m.mutationId, now));
    stmts.push(db.prepare(
      `INSERT INTO app_records (entity, id, data, field_revs, rev, updated_at, device_id, client_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (entity, id) DO UPDATE SET data=excluded.data, field_revs=excluded.field_revs, rev=excluded.rev, updated_at=excluded.updated_at, device_id=excluded.device_id, client_time=excluded.client_time`,
    ).bind(m.entity, m.recordId, JSON.stringify(p.next.data), JSON.stringify(p.next.fieldRevs), p.seq, now, m.deviceId, m.clientTime));
    for (const c of p.conflicts) {
      stmts.push(db.prepare(
        `INSERT INTO app_conflicts (entity, record_id, field, overwritten, incoming, base_rev, overwritten_rev, applied_rev, mutation_id, device_id, client_time, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(m.entity, m.recordId, c.field, JSON.stringify(c.overwritten ?? null), JSON.stringify(c.incoming ?? null), m.baseRev, c.overwrittenRev, p.seq, m.mutationId, m.deviceId, m.clientTime, now));
    }
    stmts.push(db.prepare(`INSERT INTO app_mutations (mutation_id, seq, result, at) VALUES (?, ?, ?, ?)`)
      .bind(m.mutationId, p.seq, p.conflicts.length ? "applied_with_conflict" : "applied", now));
  }
  if (stmts.length) {
    try { await db.batch(stmts); } catch (e) {
      logEvent("sync.push", { outcome: "retry_needed", batch: body.mutations.length });
      throw new HttpError(409, "concurrent_write_retry");
    }
  }

  const results: MutationResult[] = body.mutations.map((m) => {
    const d = dup.get(m.mutationId);
    if (d) return { mutationId: m.mutationId, entity: m.entity, recordId: m.recordId, baseRev: m.baseRev, result: `duplicate:${d.result}`, appliedRev: d.seq, conflicts: 0 };
    const p = plan.find((x) => x.mutation.mutationId === m.mutationId)!;
    return {
      mutationId: m.mutationId, entity: m.entity, recordId: m.recordId, baseRev: m.baseRev,
      result: p.seq == null ? "noop" : p.conflicts.length ? "applied_with_conflict" : "applied",
      appliedRev: p.seq ?? current.get(`${m.entity}|${m.recordId}`)?.rev ?? null,
      conflicts: p.conflicts.length,
    };
  });
  logEvent("sync.push", { batch: body.mutations.length, statements: stmts.length, conflicts: results.reduce((n, r) => n + r.conflicts, 0) });
  return json({ results });
}

export async function pull(url: URL, env: AppEnv): Promise<Response> {
  const since = Math.max(0, Number(url.searchParams.get("since") ?? "0") | 0);
  const rows = (await env.DB.prepare(`SELECT entity, id, data, rev FROM app_records WHERE rev > ? ORDER BY rev LIMIT 300`).bind(since)
    .all<{ entity: string; id: string; data: string; rev: number }>()).results;
  const more = rows.length === 300;
  return json({ records: rows.map((r) => ({ entity: r.entity, id: r.id, data: JSON.parse(r.data), rev: r.rev })), more, until: rows.length ? rows[rows.length - 1].rev : since });
}

export async function conflicts(env: AppEnv): Promise<Response> {
  const rows = (await env.DB.prepare(`SELECT id, entity, record_id, field, overwritten, incoming, applied_rev, client_time, at, resolved FROM app_conflicts ORDER BY id DESC LIMIT 100`).all()).results;
  return json({ conflicts: rows });
}

export async function markConflictResolved(id: number, env: AppEnv): Promise<Response> {
  await env.DB.prepare(`UPDATE app_conflicts SET resolved = 1 WHERE id = ?`).bind(id).run();
  return json({ resolved: true });
}
