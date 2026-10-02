// Leafling app tables in D1. Additive only: never drops, truncates or rewrites existing tables.
// Mirrors migrations/0001_app_records.sql and migrations/0002_user_ownership.sql.
//
// v1 (single owner): app_records / app_changes / app_mutations / app_conflicts / app_ai_usage.
// v2 (multi-user):   every personal row carries user_id (→ app_users.id) in owner-scoped tables
//                    user_records / user_changes / user_mutations / user_conflicts / user_ai_usage.
// The v2 migration copies v1 rows into the v2 tables under the placeholder owner '__legacy__'
// (visible to nobody) in ONE atomic D1 batch, together with the schema_version marker, so an
// interrupted migration leaves nothing half-done. The v1 tables are left untouched as an in-database
// backup. Legacy rows are handed to the original owner only by users.ts (verified Access identity
// whose email equals OWNER_EMAIL — the only identity the v1 app ever accepted), exactly once.

export const LEGACY_OWNER = "__legacy__";

export const APP_SCHEMA_V1 = [
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

export const APP_SCHEMA_V2 = [
  `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS app_users (
     id TEXT PRIMARY KEY, access_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
     created_at TEXT NOT NULL, last_login_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS user_records (
     user_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, field_revs TEXT NOT NULL DEFAULT '{}',
     rev INTEGER NOT NULL, updated_at TEXT NOT NULL, device_id TEXT, client_time TEXT,
     PRIMARY KEY (user_id, entity, id))`,
  `CREATE INDEX IF NOT EXISTS user_records_rev ON user_records (user_id, rev)`,
  `CREATE TABLE IF NOT EXISTS user_changes (
     user_id TEXT NOT NULL, seq INTEGER NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, mutation_id TEXT NOT NULL, at TEXT NOT NULL,
     PRIMARY KEY (user_id, seq))`,
  `CREATE TABLE IF NOT EXISTS user_mutations (
     user_id TEXT NOT NULL, mutation_id TEXT NOT NULL, seq INTEGER, result TEXT NOT NULL, at TEXT NOT NULL,
     PRIMARY KEY (user_id, mutation_id))`,
  `CREATE TABLE IF NOT EXISTS user_conflicts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity TEXT NOT NULL, record_id TEXT NOT NULL, field TEXT NOT NULL,
     overwritten TEXT, incoming TEXT, base_rev INTEGER, overwritten_rev INTEGER, applied_rev INTEGER,
     mutation_id TEXT, device_id TEXT, client_time TEXT, at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, legacy_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS user_conflicts_user ON user_conflicts (user_id, id)`,
  `CREATE TABLE IF NOT EXISTS user_ai_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at TEXT NOT NULL, feature TEXT, model TEXT, plant_id TEXT,
     input_tokens INTEGER, output_tokens INTEGER, image_count INTEGER, est_cost_usd REAL, latency_ms INTEGER,
     status TEXT, context_sections TEXT, legacy_id INTEGER)`,
  `CREATE INDEX IF NOT EXISTS user_ai_usage_at ON user_ai_usage (at)`,
  `CREATE INDEX IF NOT EXISTS user_ai_usage_user ON user_ai_usage (user_id, at)`,
];

/** One atomic batch: marker first (a concurrent second run fails on its PRIMARY KEY and rolls back), then copies. */
const MIGRATE_V1_TO_V2 = [
  `INSERT INTO app_meta (key, value, at) VALUES ('schema_version', '2', ?1)`,
  `INSERT INTO app_meta (key, value, at) SELECT 'legacy_copied_records', CAST(COUNT(*) AS TEXT), ?1 FROM app_records`,
  `INSERT OR IGNORE INTO user_records (user_id, entity, id, data, field_revs, rev, updated_at, device_id, client_time)
     SELECT '${LEGACY_OWNER}', entity, id, data, field_revs, rev, updated_at, device_id, client_time FROM app_records`,
  `INSERT OR IGNORE INTO user_changes (user_id, seq, entity, id, mutation_id, at)
     SELECT '${LEGACY_OWNER}', seq, entity, id, mutation_id, at FROM app_changes`,
  `INSERT OR IGNORE INTO user_mutations (user_id, mutation_id, seq, result, at)
     SELECT '${LEGACY_OWNER}', mutation_id, seq, result, at FROM app_mutations`,
  `INSERT INTO user_conflicts (user_id, entity, record_id, field, overwritten, incoming, base_rev, overwritten_rev, applied_rev, mutation_id, device_id, client_time, at, resolved, legacy_id)
     SELECT '${LEGACY_OWNER}', entity, record_id, field, overwritten, incoming, base_rev, overwritten_rev, applied_rev, mutation_id, device_id, client_time, at, resolved, id FROM app_conflicts ORDER BY id`,
  `INSERT INTO user_ai_usage (user_id, at, feature, model, plant_id, input_tokens, output_tokens, image_count, est_cost_usd, latency_ms, status, context_sections, legacy_id)
     SELECT '${LEGACY_OWNER}', at, feature, model, plant_id, input_tokens, output_tokens, image_count, est_cost_usd, latency_ms, status, context_sections, id FROM app_ai_usage ORDER BY id`,
];

async function schemaVersion(db: D1Database): Promise<number> {
  const t = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='app_meta'`).first<{ n: number }>();
  if (!t?.n) return 0;
  const v = await db.prepare(`SELECT value FROM app_meta WHERE key='schema_version'`).first<{ value: string }>();
  return Number(v?.value ?? 0);
}

export async function migrate(db: D1Database): Promise<void> {
  if ((await schemaVersion(db)) >= 2) return;
  // CREATE ... IF NOT EXISTS only — safe to repeat; existing tables and rows are never touched.
  await db.batch([...APP_SCHEMA_V1, ...APP_SCHEMA_V2].map((s) => db.prepare(s)));
  const now = new Date().toISOString();
  try {
    await db.batch(MIGRATE_V1_TO_V2.map((s) => (s.includes("?1") ? db.prepare(s).bind(now) : db.prepare(s))));
  } catch (e) {
    // Another isolate migrated first (schema_version already present) → fine; anything else is a real error.
    if ((await schemaVersion(db)) < 2) throw e;
  }
}

let ready: Promise<void> | null = null;
export function ensureAppSchema(db: D1Database): Promise<void> {
  if (!ready) ready = migrate(db).catch((e) => { ready = null; throw e; });
  return ready;
}
