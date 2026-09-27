// Leafling Phase 0 spike Worker — throwaway platform-validation code, PREVIEW ONLY.
import { aiTest } from "./ai.ts";
import { authenticate } from "./auth.ts";
import type { Ctx, Env } from "./env.ts";
import { keygenPage, keygenScript } from "./keygen.ts";
import { getPhoto, listPhotos, uploadPhoto } from "./photos.ts";
import { publicKey, subscribe, testPush } from "./push.ts";
import { SPIKE_TABLES, ensureSchema } from "./schema.ts";
import { listConflicts, restoreConflict, syncPull, syncPush } from "./sync.ts";
import { HttpError, json, logEvent, readJson } from "./util.ts";
import { exportZip } from "./zip.ts";

async function route(req: Request, ctx: Ctx): Promise<Response> {
  const { pathname } = ctx.url;
  const m = req.method;

  if (pathname === "/keygen" && m === "GET") return keygenPage(ctx);
  if (pathname === "/keygen.js" && m === "GET") return keygenScript(ctx);

  await ensureSchema(ctx.env.DB);

  if (pathname === "/api/whoami" && m === "GET") {
    return json({
      email: ctx.email,
      serverTime: new Date().toISOString(),
      colo: (req.cf as { colo?: string } | undefined)?.colo ?? null,
      config: {
        ownerEmail: Boolean(ctx.env.OWNER_EMAIL),
        accessAud: Boolean(ctx.env.ACCESS_AUD),
        vapidPublicKey: Boolean(ctx.env.VAPID_PUBLIC_KEY),
        vapidPrivateKey: Boolean(ctx.env.VAPID_PRIVATE_KEY),
        anthropicKey: Boolean(ctx.env.ANTHROPIC_API_KEY),
      },
    });
  }
  if (pathname === "/api/sync/push" && m === "POST") return syncPush(req, ctx);
  if (pathname === "/api/sync/pull" && m === "GET") return syncPull(ctx);
  if (pathname === "/api/sync/conflicts" && m === "GET") return listConflicts(ctx);
  let mm = pathname.match(/^\/api\/sync\/conflicts\/(\d+)\/restore$/);
  if (mm && m === "POST") return restoreConflict(Number(mm[1]), ctx);

  if (pathname === "/api/photos" && m === "GET") return listPhotos(ctx);
  mm = pathname.match(/^\/api\/photos\/([0-9a-f-]{36})\/(original|display|thumb)$/);
  if (mm && m === "PUT") return uploadPhoto(req, ctx, mm[1], mm[2]);
  if (mm && m === "GET") return getPhoto(ctx, mm[1], mm[2]);
  if (pathname === "/api/export/photos.zip" && m === "GET") return exportZip(ctx);

  if (pathname === "/api/push/public-key" && m === "GET") return publicKey(ctx);
  if (pathname === "/api/push/subscribe" && m === "POST") return subscribe(req, ctx);
  if (pathname === "/api/push/test" && m === "POST") return testPush(req, ctx);

  if (pathname === "/api/ai/test" && m === "POST") return aiTest(req, ctx);

  if (pathname === "/api/light/readings" && m === "POST") {
    const b = await readJson<{ label?: string; meanLuma?: number; meta?: unknown }>(req, 32 * 1024);
    await ctx.env.DB.prepare(`INSERT INTO light_readings (at, label, mean_luma, meta) VALUES (?, ?, ?, ?)`)
      .bind(new Date().toISOString(), String(b.label ?? "").slice(0, 60), Number(b.meanLuma) || 0, JSON.stringify(b.meta ?? {}).slice(0, 8000)).run();
    return json({ saved: true });
  }
  if (pathname === "/api/light/readings" && m === "GET") {
    return json({ readings: (await ctx.env.DB.prepare(`SELECT * FROM light_readings ORDER BY id DESC LIMIT 100`).all()).results });
  }
  if (pathname === "/api/results" && m === "POST") {
    const b = await readJson<{ testId?: string; device?: string; payload?: unknown }>(req, 64 * 1024);
    await ctx.env.DB.prepare(`INSERT INTO test_results (at, test_id, device, payload) VALUES (?, ?, ?, ?)`)
      .bind(new Date().toISOString(), String(b.testId ?? "").slice(0, 20), String(b.device ?? "").slice(0, 200), JSON.stringify(b.payload ?? {}).slice(0, 60000)).run();
    return json({ saved: true });
  }
  if (pathname === "/api/results" && m === "GET") {
    return json({ results: (await ctx.env.DB.prepare(`SELECT * FROM test_results ORDER BY id DESC LIMIT 200`).all()).results });
  }
  if (pathname === "/api/test/cleanup" && m === "POST") {
    const b = await readJson<{ confirm?: string }>(req, 1024);
    if (b.confirm !== "DELETE-SPIKE-DATA") throw new HttpError(400, "confirmation_required");
    let deleted = 0;
    let cursor: string | undefined;
    do {
      const list = await ctx.env.PHOTOS.list({ prefix: "spike/", cursor, limit: 500 });
      if (list.objects.length) {
        await ctx.env.PHOTOS.delete(list.objects.map((o) => o.key));
        deleted += list.objects.length;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    await ctx.env.DB.batch(SPIKE_TABLES.map((t) => ctx.env.DB.prepare(`DELETE FROM ${t}`)));
    logEvent("test.cleanup", { r2Deleted: deleted });
    return json({ cleaned: true, r2ObjectsDeleted: deleted });
  }
  throw new HttpError(404, "not_found");
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const started = Date.now();
    try {
      const email = await authenticate(req, env, url);
      const res = await route(req, { env, exec, url, email });
      logEvent("request", { path: url.pathname, method: req.method, status: res.status, ms: Date.now() - started });
      return res;
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "internal_error");
      if (!(e instanceof HttpError)) console.error(JSON.stringify({ spike: "phase0", route: url.pathname, error: (e as Error)?.name ?? "Error" }));
      logEvent("request", { path: url.pathname, method: req.method, status: err.status, error: err.code, ms: Date.now() - started });
      return json({ error: err.code }, err.status);
    }
  },
} satisfies ExportedHandler<Env>;
