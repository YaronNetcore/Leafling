// The tests run in Node but import Worker modules (schema.ts, merge.ts) that name Workers runtime types.
type D1Database = import("@cloudflare/workers-types/index.ts").D1Database;
// ai-context.ts / env.ts (measured directly in context-size.test.ts).
type D1PreparedStatement = import("@cloudflare/workers-types/index.ts").D1PreparedStatement;
type R2Bucket = import("@cloudflare/workers-types/index.ts").R2Bucket;
