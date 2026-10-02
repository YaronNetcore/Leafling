// The tests run in Node but import Worker modules (schema.ts, merge.ts) that name Workers runtime types.
type D1Database = import("@cloudflare/workers-types/index.ts").D1Database;
