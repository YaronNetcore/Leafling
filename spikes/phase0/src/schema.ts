// Spike-only schema, created lazily on first API request. Not the application schema.
// Note: nothing here stores any private key or secret (VAPID private key lives only in
// the encrypted Worker secret VAPID_PRIVATE_KEY).

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS change_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL, field TEXT NOT NULL, mutation_id TEXT NOT NULL, received_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS field_state (entity TEXT NOT NULL, entity_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT, rev INTEGER NOT NULL, client_time TEXT, device_id TEXT, PRIMARY KEY (entity, entity_id, field))`,
  `CREATE TABLE IF NOT EXISTS sync_mutations (mutation_id TEXT PRIMARY KEY, received_seq INTEGER, result TEXT NOT NULL, received_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sync_conflicts (id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT, entity_id TEXT, field TEXT, overwritten_value TEXT, overwritten_rev INTEGER, new_value TEXT, base_rev INTEGER, applied_rev INTEGER, mutation_id TEXT, device_id TEXT, client_time TEXT, received_at TEXT, resolved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, mime TEXT, size INTEGER, sha256 TEXT, crc32 INTEGER, original_name TEXT, captured_at TEXT, created_at TEXT, has_display INTEGER NOT NULL DEFAULT 0, has_thumb INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device_label TEXT, created_at TEXT, last_status INTEGER, failure_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, model TEXT, input_tokens INTEGER, output_tokens INTEGER, image_count INTEGER, est_cost_usd REAL, latency_ms INTEGER, status TEXT)`,
  `CREATE TABLE IF NOT EXISTS light_readings (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, label TEXT, mean_luma REAL, meta TEXT)`,
  `CREATE TABLE IF NOT EXISTS test_results (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, test_id TEXT, device TEXT, payload TEXT)`,
];

export const SPIKE_TABLES = [
  "change_log", "field_state", "sync_mutations", "sync_conflicts", "photos",
  "push_subscriptions", "ai_usage", "light_readings", "test_results",
];

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN (${SPIKE_TABLES.map(() => "?").join(",")})`)
        .bind(...SPIKE_TABLES)
        .first<{ n: number }>();
      if ((row?.n ?? 0) < SPIKE_TABLES.length) {
        await db.batch(STATEMENTS.map((s) => db.prepare(s)));
      }
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
