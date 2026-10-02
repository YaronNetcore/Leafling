-- Leafling v3 (2026-10): AI Botanist chat. ADDITIVE ONLY — nothing is dropped, rewritten or deleted.
-- Applied automatically by the Worker (migrateV3 in src/worker/schema.ts); this file is for review.
-- Conversations and messages are ordinary per-user records in user_records (entities 'chat' and 'message').

-- One row per user message sent to the AI: duplicate protection / idempotent retries (state: running|done|partial|failed).
CREATE TABLE IF NOT EXISTS user_chat_runs (
  user_id TEXT NOT NULL, message_id TEXT NOT NULL, chat_id TEXT NOT NULL, state TEXT NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT,
  PRIMARY KEY (user_id, message_id));

-- Lookups of one plant's records and one conversation's messages, always within one user.
CREATE INDEX IF NOT EXISTS user_records_plant ON user_records (user_id, entity, json_extract(data, '$.plantId'));
CREATE INDEX IF NOT EXISTS user_records_chat ON user_records (user_id, entity, json_extract(data, '$.chatId'));

-- Metadata only (no prompts/answers): time to first token, context size, phase timings.
-- (The Worker adds each column only if it is missing.)
ALTER TABLE user_ai_usage ADD COLUMN first_token_ms INTEGER;
ALTER TABLE user_ai_usage ADD COLUMN context_chars INTEGER;
ALTER TABLE user_ai_usage ADD COLUMN timings TEXT;

UPDATE app_meta SET value = '3', at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 3;
