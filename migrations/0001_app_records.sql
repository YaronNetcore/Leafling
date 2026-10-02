-- Leafling app tables (additive only). Applied lazily by src/worker/schema.ts on first API call;
-- kept here as the canonical migration. Never drops or rewrites data; Phase 0 spike tables are untouched.

CREATE TABLE IF NOT EXISTS app_records (
     entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, field_revs TEXT NOT NULL DEFAULT '{}',
     rev INTEGER NOT NULL, updated_at TEXT NOT NULL, device_id TEXT, client_time TEXT,
     PRIMARY KEY (entity, id));

CREATE INDEX IF NOT EXISTS app_records_rev ON app_records (rev);

CREATE TABLE IF NOT EXISTS app_changes (seq INTEGER PRIMARY KEY, entity TEXT NOT NULL, id TEXT NOT NULL, mutation_id TEXT NOT NULL, at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS app_mutations (mutation_id TEXT PRIMARY KEY, seq INTEGER, result TEXT NOT NULL, at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS app_conflicts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, record_id TEXT NOT NULL, field TEXT NOT NULL,
     overwritten TEXT, incoming TEXT, base_rev INTEGER, overwritten_rev INTEGER, applied_rev INTEGER,
     mutation_id TEXT, device_id TEXT, client_time TEXT, at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS app_ai_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, feature TEXT, model TEXT, plant_id TEXT,
     input_tokens INTEGER, output_tokens INTEGER, image_count INTEGER, est_cost_usd REAL, latency_ms INTEGER,
     status TEXT, context_sections TEXT);
