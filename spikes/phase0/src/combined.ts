// Preview Worker entry: the Leafling app API (/api/v1/*, from the repo-root src/worker) plus the
// Phase 0 harness API (/api/*, /keygen). Static files: the app at "/" and the Phase 0 harness at "/phase0/".
// Hosted on the existing preview resources until production resources are approved (see PROJECT_STATE.md).
import { handleApp } from "../../../src/worker/app.ts";
import type { Env } from "./env.ts";
import spike from "./worker.ts";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const app = await handleApp(req, env, url, ctx);
    if (app) return app;
    return spike.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
