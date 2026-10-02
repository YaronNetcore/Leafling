import { aiRequest } from "./ai.ts";
import { authenticate } from "./auth.ts";
import type { AppEnv } from "./env.ts";
import { HttpError, json, logEvent } from "./http.ts";
import { getPhoto, uploadPhoto } from "./photos.ts";
import { ensureAppSchema } from "./schema.ts";
import { conflicts, markConflictResolved, pull, push } from "./sync.ts";
import { resolveUser } from "./users.ts";

// Leafling application API under /api/v1/*.
// Every request: verify the Access JWT → resolve the internal user from the verified `sub` → pass
// ONLY that user id to the handlers. Nothing in the URL, headers or body can choose the owner.
//
// `X-Leafling-User` is a client-side safety latch, not an identity: the browser sends the user id
// its local database belongs to. If it differs from the signed-in user (e.g. the Access session
// switched accounts on a shared device), the request is refused, so queued changes of one user can
// never be written under another. Required on every write; checked on reads when present.

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Returns null for paths it does not own. */
export async function handleApp(req: Request, env: AppEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/v1/")) return null;
  const started = Date.now();
  try {
    const who = await authenticate(req, env, url);
    await ensureAppSchema(env.DB);
    const user = await resolveUser(env, who);
    const p = url.pathname.slice("/api/v1".length);
    const m = req.method;

    const claimed = req.headers.get("x-leafling-user");
    if (claimed !== null && claimed !== user.id) throw new HttpError(409, "user_mismatch");
    if (claimed === null && WRITE.has(m)) throw new HttpError(428, "user_header_required");

    let res: Response;
    let mm: RegExpMatchArray | null;
    if (p === "/me" && m === "GET") res = json({ userId: user.id, email: user.email, isLegacyOwner: user.isLegacyOwner, ai: Boolean(env.ANTHROPIC_API_KEY), serverTime: new Date().toISOString() });
    else if (p === "/sync/push" && m === "POST") res = await push(req, env, user.id);
    else if (p === "/sync/pull" && m === "GET") res = await pull(url, env, user.id);
    else if (p === "/sync/conflicts" && m === "GET") res = await conflicts(env, user.id);
    else if ((mm = p.match(/^\/sync\/conflicts\/(\d{1,15})\/resolved$/)) && m === "POST") res = await markConflictResolved(Number(mm[1]), env, user.id);
    else if ((mm = p.match(/^\/photos\/([0-9a-f-]{36})\/(original|display|thumb)$/)) && m === "PUT") res = await uploadPhoto(req, env, user, mm[1], mm[2]);
    else if (mm && m === "GET") res = await getPhoto(env, user, mm[1], mm[2], req);
    else if (p === "/ai" && m === "POST") res = await aiRequest(req, env, user);
    else throw new HttpError(404, "not_found");
    logEvent("request", { path: p.replace(/[0-9a-f-]{36}/g, ":id"), method: m, status: res.status, ms: Date.now() - started });
    return res;
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, "internal_error");
    if (!(e instanceof HttpError)) console.error(JSON.stringify({ app: "leafling", error: (e as Error)?.name ?? "Error" }));
    logEvent("request", { path: url.pathname.replace(/[0-9a-f-]{36}/g, ":id").replace(/\/\d+\//g, "/:n/"), method: req.method, status: err.status, error: err.code, ms: Date.now() - started });
    return json({ error: err.code }, err.status);
  }
}
