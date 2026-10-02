import { aiRequest } from "./ai.ts";
import { authenticate } from "./auth.ts";
import type { AppEnv } from "./env.ts";
import { HttpError, json, logEvent } from "./http.ts";
import { getPhoto, uploadPhoto } from "./photos.ts";
import { ensureAppSchema } from "./schema.ts";
import { conflicts, markConflictResolved, pull, push } from "./sync.ts";

/** Leafling application API under /api/v1/*. Returns null for paths it does not own. */
export async function handleApp(req: Request, env: AppEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/v1/")) return null;
  const started = Date.now();
  try {
    const email = await authenticate(req, env, url);
    await ensureAppSchema(env.DB);
    const p = url.pathname.slice("/api/v1".length);
    const m = req.method;
    let res: Response;
    let mm: RegExpMatchArray | null;
    if (p === "/me" && m === "GET") res = json({ email, ai: Boolean(env.ANTHROPIC_API_KEY), serverTime: new Date().toISOString() });
    else if (p === "/sync/push" && m === "POST") res = await push(req, env);
    else if (p === "/sync/pull" && m === "GET") res = await pull(url, env);
    else if (p === "/sync/conflicts" && m === "GET") res = await conflicts(env);
    else if ((mm = p.match(/^\/sync\/conflicts\/(\d+)\/resolved$/)) && m === "POST") res = await markConflictResolved(Number(mm[1]), env);
    else if ((mm = p.match(/^\/photos\/([0-9a-f-]{36})\/(original|display|thumb)$/)) && m === "PUT") res = await uploadPhoto(req, env, mm[1], mm[2]);
    else if (mm && m === "GET") res = await getPhoto(env, mm[1], mm[2], req);
    else if (p === "/ai" && m === "POST") res = await aiRequest(req, env);
    else throw new HttpError(404, "not_found");
    logEvent("request", { path: p.replace(/[0-9a-f-]{36}/g, ":id"), method: m, status: res.status, ms: Date.now() - started });
    return res;
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, "internal_error");
    if (!(e instanceof HttpError)) console.error(JSON.stringify({ app: "leafling", error: (e as Error)?.name ?? "Error" }));
    logEvent("request", { path: url.pathname.replace(/[0-9a-f-]{36}/g, ":id"), method: req.method, status: err.status, error: err.code, ms: Date.now() - started });
    return json({ error: err.code }, err.status);
  }
}
