import { defineConfig } from "vitest/config";

// Browser test of same-device user switching (needs `npm run build` first; see package.json "test:e2e").
export default defineConfig({ test: { include: ["tests/e2e/**/*.e2e.ts"], testTimeout: 120_000, hookTimeout: 180_000 } });
