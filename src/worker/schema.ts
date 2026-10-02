// Leafling app tables in D1. Additive only (CREATE ... IF NOT EXISTS); never drops or rewrites
// existing data. Mirrors migrations/0001_app_records.sql. The Phase 0 spike tables are untouched.

export const APP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_records (
     entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, field_revs TEXT NOT NULL DEFAULT '{}',
     rev INTEGER NOT NULL, updated_at TEXT NOT NULL, device_id TEXT, client_time TEXT,
     PRIMARY KEY (entity, id))`,
  `CREATE INDEX IF NOT EXISTS app_records_rev ON app_records (rev)`,
  `CREATE TABLE IF NOT EXISTS app_changes (seq INTEGER PRIMARY KEY, entity TEXT NOT NULL, id TEXT NOT NULL, mutation_id TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS app_mutations (mutation_id TEXT PRIMARY KEY, seq INTEGER, result TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS app_conflicts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, record_id TEXT NOT NULL, field TEXT NOT NULL,
     overwritten TEXT, incoming TEXT, base_rev INTEGER, overwritten_rev INTEGER, applied_rev INTEGER,
     mutation_id TEXT, device_id TEXT, client_time TEXT, at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS app_ai_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, feature TEXT, model TEXT, plant_id TEXT,
     input_tokens INTEGER, output_tokens INTEGER, image_count INTEGER, est_cost_usd REAL, latency_ms INTEGER,
     status TEXT, context_sections TEXT)`,
];

let ready: Promise<void> | null = null;
export function ensureAppSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('app_records','app_changes','app_mutations','app_conflicts','app_ai_usage')`).first<{ n: number }>();
      if ((r?.n ?? 0) < 5) await db.batch(APP_SCHEMA.map((s) => db.prepare(s)));
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
