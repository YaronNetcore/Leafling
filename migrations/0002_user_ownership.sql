-- Leafling v2: per-user ownership (multi-user isolation). ADDITIVE ONLY.
-- Applied automatically and atomically by src/worker/schema.ts (migrate) on the first API request after
-- deploy; this file is the canonical, reviewable copy. It never drops, truncates or rewrites anything:
-- the v1 tables (app_records, app_changes, app_mutations, app_conflicts, app_ai_usage) stay untouched
-- as an in-database backup. See docs/security/MULTI_USER.md for recovery steps.

CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY, access_sub TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  created_at TEXT NOT NULL, last_login_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS user_records (
  user_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, field_revs TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL, updated_at TEXT NOT NULL, device_id TEXT, client_time TEXT,
  PRIMARY KEY (user_id, entity, id));

CREATE INDEX IF NOT EXISTS user_records_rev ON user_records (user_id, rev);

CREATE TABLE IF NOT EXISTS user_changes (
  user_id TEXT NOT NULL, seq INTEGER NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, mutation_id TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (user_id, seq));

CREATE TABLE IF NOT EXISTS user_mutations (
  user_id TEXT NOT NULL, mutation_id TEXT NOT NULL, seq INTEGER, result TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (user_id, mutation_id));

CREATE TABLE IF NOT EXISTS user_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity TEXT NOT NULL, record_id TEXT NOT NULL, field TEXT NOT NULL,
  overwritten TEXT, incoming TEXT, base_rev INTEGER, overwritten_rev INTEGER, applied_rev INTEGER,
  mutation_id TEXT, device_id TEXT, client_time TEXT, at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, legacy_id INTEGER);

CREATE INDEX IF NOT EXISTS user_conflicts_user ON user_conflicts (user_id, id);

CREATE TABLE IF NOT EXISTS user_ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at TEXT NOT NULL, feature TEXT, model TEXT, plant_id TEXT,
  input_tokens INTEGER, output_tokens INTEGER, image_count INTEGER, est_cost_usd REAL, latency_ms INTEGER,
  status TEXT, context_sections TEXT, legacy_id INTEGER);

CREATE INDEX IF NOT EXISTS user_ai_usage_at ON user_ai_usage (at);

CREATE INDEX IF NOT EXISTS user_ai_usage_user ON user_ai_usage (user_id, at);

-- Copy v1 rows under the placeholder owner "__legacy__" (visible to nobody). In the Worker these
-- statements run in ONE D1 batch (a single transaction) with the schema_version marker inserted first,
-- so a concurrent second run fails on the marker and rolls back. Do not run them by hand twice.
-- The rows are handed to the original owner by the Worker only (see src/worker/users.ts).
INSERT INTO app_meta (key, value, at) VALUES ('schema_version', '2', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO app_meta (key, value, at) SELECT 'legacy_copied_records', CAST(COUNT(*) AS TEXT), strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM app_records;
INSERT OR IGNORE INTO user_records (user_id, entity, id, data, field_revs, rev, updated_at, device_id, client_time)
  SELECT '__legacy__', entity, id, data, field_revs, rev, updated_at, device_id, client_time FROM app_records;
INSERT OR IGNORE INTO user_changes (user_id, seq, entity, id, mutation_id, at)
  SELECT '__legacy__', seq, entity, id, mutation_id, at FROM app_changes;
INSERT OR IGNORE INTO user_mutations (user_id, mutation_id, seq, result, at)
  SELECT '__legacy__', mutation_id, seq, result, at FROM app_mutations;
INSERT INTO user_conflicts (user_id, entity, record_id, field, overwritten, incoming, base_rev, overwritten_rev, applied_rev, mutation_id, device_id, client_time, at, resolved, legacy_id)
  SELECT '__legacy__', entity, record_id, field, overwritten, incoming, base_rev, overwritten_rev, applied_rev, mutation_id, device_id, client_time, at, resolved, id FROM app_conflicts ORDER BY id;
INSERT INTO user_ai_usage (user_id, at, feature, model, plant_id, input_tokens, output_tokens, image_count, est_cost_usd, latency_ms, status, context_sections, legacy_id)
  SELECT '__legacy__', at, feature, model, plant_id, input_tokens, output_tokens, image_count, est_cost_usd, latency_ms, status, context_sections, id FROM app_ai_usage ORDER BY id;
