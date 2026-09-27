import type { Ctx } from "./env.ts";
import { HttpError, json, logEvent, readJson } from "./util.ts";

// P0-2 / P0-3: idempotent push, server-ordered conflict resolution, conflict preservation.
// Ordering uses ONLY server revisions (change_log.seq) and server receipt order.
// client_time is stored as metadata and never used for ordering.
// Spike limitation (documented): read-then-batch is not a single atomic compare-and-set;
// acceptable for a single-user spike, the application uses conditional writes.

interface Mutation {
  mutationId: string;
  entity: string;
  entityId: string;
  field: string;
  value: string | null;
  baseRev: number;
  clientTime?: string;
  deviceId?: string;
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_BATCH = 50;

function validate(m: Mutation): void {
  if (!m || typeof m !== "object") throw new HttpError(400, "bad_mutation");
  for (const k of ["mutationId", "entity", "entityId", "field"] as const) {
    if (typeof m[k] !== "string" || !ID_RE.test(m[k])) throw new HttpError(400, `bad_${k}`);
  }
  if (m.value !== null && (typeof m.value !== "string" || m.value.length > 2000)) throw new HttpError(400, "bad_value");
  if (!Number.isInteger(m.baseRev) || m.baseRev < 0) throw new HttpError(400, "bad_baseRev");
}

const key = (e: string, id: string, f: string) => `${e}|${id}|${f}`;

async function apply(ctx: Ctx, mutations: Mutation[]) {
  const db = ctx.env.DB;
  const now = new Date().toISOString();
  let queries = 0;

  const ids = mutations.map((m) => m.mutationId);
  const seen = await db
    .prepare(`SELECT mutation_id, received_seq, result FROM sync_mutations WHERE mutation_id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ mutation_id: string; received_seq: number | null; result: string }>();
  queries++;
  const dup = new Map(seen.results.map((r) => [r.mutation_id, r]));
  const fresh = mutations.filter((m) => !dup.has(m.mutationId));

  const keys = [...new Set(fresh.map((m) => key(m.entity, m.entityId, m.field)))];
  const current = new Map<string, { value: string | null; rev: number }>();
  if (keys.length) {
    const rows = await db
      .prepare(`SELECT entity, entity_id, field, value, rev FROM field_state WHERE (entity || '|' || entity_id || '|' || field) IN (${keys.map(() => "?").join(",")})`)
      .bind(...keys)
      .all<{ entity: string; entity_id: string; field: string; value: string | null; rev: number }>();
    queries++;
    for (const r of rows.results) current.set(key(r.entity, r.entity_id, r.field), { value: r.value, rev: r.rev });
  }

  // Track fields changed earlier in this batch, so a device's own consecutive queued edits
  // (same baseRev) are treated as sequential, not as conflicts.
  const touched = new Map<string, { deviceId: string; baseRev: number; value: string | null }>();
  const stmts: D1PreparedStatement[] = [];
  const planned: { m: Mutation; result: string }[] = [];
  const MAXSEQ = `(SELECT MAX(seq) FROM change_log)`;

  for (const m of fresh) {
    const k = key(m.entity, m.entityId, m.field);
    const cur = current.get(k);
    const prior = touched.get(k);
    const serverRev = cur?.rev ?? 0;
    const currentValue = prior ? prior.value : cur?.value ?? null;

    let conflict: boolean;
    if (prior) conflict = !(prior.deviceId === (m.deviceId ?? "") && prior.baseRev === m.baseRev) && m.value !== currentValue;
    else conflict = serverRev !== m.baseRev && m.value !== currentValue;

    if (!prior && m.value === currentValue) {
      stmts.push(db.prepare(`INSERT INTO sync_mutations (mutation_id, received_seq, result, received_at) VALUES (?, NULL, 'noop', ?)`).bind(m.mutationId, now));
      planned.push({ m, result: "noop" });
      continue;
    }
    stmts.push(
      db.prepare(`INSERT INTO change_log (entity, entity_id, field, mutation_id, received_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(m.entity, m.entityId, m.field, m.mutationId, now),
    );
    if (conflict) {
      stmts.push(
        db.prepare(
          `INSERT INTO sync_conflicts (entity, entity_id, field, overwritten_value, overwritten_rev, new_value, base_rev, applied_rev, mutation_id, device_id, client_time, received_at)
           VALUES (?, ?, ?, (SELECT value FROM field_state WHERE entity=? AND entity_id=? AND field=?), (SELECT rev FROM field_state WHERE entity=? AND entity_id=? AND field=?), ?, ?, ${MAXSEQ}, ?, ?, ?, ?)`,
        ).bind(m.entity, m.entityId, m.field, m.entity, m.entityId, m.field, m.entity, m.entityId, m.field,
          m.value, m.baseRev, m.mutationId, m.deviceId ?? null, m.clientTime ?? null, now),
      );
    }
    stmts.push(
      db.prepare(
        `INSERT INTO field_state (entity, entity_id, field, value, rev, client_time, device_id) VALUES (?, ?, ?, ?, ${MAXSEQ}, ?, ?)
         ON CONFLICT (entity, entity_id, field) DO UPDATE SET value=excluded.value, rev=excluded.rev, client_time=excluded.client_time, device_id=excluded.device_id`,
      ).bind(m.entity, m.entityId, m.field, m.value, m.clientTime ?? null, m.deviceId ?? null),
    );
    const result = conflict ? "applied_conflict_recorded" : "applied";
    stmts.push(
      db.prepare(`INSERT INTO sync_mutations (mutation_id, received_seq, result, received_at) VALUES (?, ${MAXSEQ}, ?, ?)`)
        .bind(m.mutationId, result, now),
    );
    planned.push({ m, result });
    touched.set(k, { deviceId: m.deviceId ?? "", baseRev: m.baseRev, value: m.value });
  }

  if (stmts.length) {
    await db.batch(stmts);
    queries += stmts.length;
  }

  const results: { mutationId: string; result: string; appliedRev: number | null; baseRev: number; field: string; entity: string; entityId: string }[] = [];
  const freshIds = planned.map((p) => p.m.mutationId);
  const revs = new Map<string, number | null>();
  if (freshIds.length) {
    const rows = await db
      .prepare(`SELECT mutation_id, received_seq FROM sync_mutations WHERE mutation_id IN (${freshIds.map(() => "?").join(",")})`)
      .bind(...freshIds)
      .all<{ mutation_id: string; received_seq: number | null }>();
    queries++;
    for (const r of rows.results) revs.set(r.mutation_id, r.received_seq);
  }
  for (const m of mutations) {
    const d = dup.get(m.mutationId);
    const p = planned.find((x) => x.m.mutationId === m.mutationId);
    results.push({
      mutationId: m.mutationId,
      entity: m.entity,
      entityId: m.entityId,
      field: m.field,
      baseRev: m.baseRev,
      result: d ? `duplicate:${d.result}` : p!.result,
      appliedRev: d ? d.received_seq : revs.get(m.mutationId) ?? null,
    });
  }
  return { results, queries, statements: stmts.length };
}

export async function syncPush(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<{ mutations: Mutation[] }>(req, 512 * 1024);
  if (!Array.isArray(body.mutations) || body.mutations.length === 0) throw new HttpError(400, "no_mutations");
  if (body.mutations.length > MAX_BATCH) throw new HttpError(400, "batch_too_large");
  body.mutations.forEach(validate);
  const t0 = Date.now();
  const out = await apply(ctx, body.mutations);
  logEvent("sync.push", { batch: body.mutations.length, statements: out.statements, queries: out.queries, ms: Date.now() - t0 });
  return json({ results: out.results, batch: body.mutations.length, d1Queries: out.queries, d1Statements: out.statements });
}

export async function syncPull(ctx: Ctx): Promise<Response> {
  const since = Math.max(0, Number(ctx.url.searchParams.get("since") ?? "0") | 0);
  const rows = await ctx.env.DB
    .prepare(`SELECT entity, entity_id AS entityId, field, value, rev FROM field_state WHERE rev > ? ORDER BY rev LIMIT 500`)
    .bind(since)
    .all();
  const max = await ctx.env.DB.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log`).first<{ seq: number }>();
  logEvent("sync.pull", { rows: rows.results.length });
  return json({ changes: rows.results, serverSeq: max?.seq ?? 0 });
}

export async function listConflicts(ctx: Ctx): Promise<Response> {
  const rows = await ctx.env.DB.prepare(`SELECT * FROM sync_conflicts ORDER BY id DESC LIMIT 100`).all();
  return json({ conflicts: rows.results });
}

export async function restoreConflict(id: number, ctx: Ctx): Promise<Response> {
  const c = await ctx.env.DB.prepare(`SELECT * FROM sync_conflicts WHERE id = ?`).bind(id).first<{
    entity: string; entity_id: string; field: string; overwritten_value: string | null; resolved: number;
  }>();
  if (!c) throw new HttpError(404, "conflict_not_found");
  const cur = await ctx.env.DB.prepare(`SELECT rev FROM field_state WHERE entity=? AND entity_id=? AND field=?`)
    .bind(c.entity, c.entity_id, c.field).first<{ rev: number }>();
  // A restore is a normal new change based on the current server revision.
  const out = await apply(ctx, [{
    mutationId: `restore-${id}-${crypto.randomUUID()}`,
    entity: c.entity, entityId: c.entity_id, field: c.field,
    value: c.overwritten_value, baseRev: cur?.rev ?? 0, deviceId: "server-restore",
  }]);
  await ctx.env.DB.prepare(`UPDATE sync_conflicts SET resolved = 1 WHERE id = ?`).bind(id).run();
  logEvent("sync.restore", { conflictId: id });
  return json({ restored: true, result: out.results[0] });
}
