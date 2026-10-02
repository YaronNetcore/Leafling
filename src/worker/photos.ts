import type { AppEnv } from "./env.ts";
import { HttpError, json, logEvent } from "./http.ts";

// Originals are streamed byte-for-byte into private R2 with an R2-verified SHA-256 and are
// write-once. Display/thumb copies are produced on the phone. Photos are served only
// through this Worker (behind Access) — no public bucket, no presigned URLs.
// OWNERSHIP: the object key is built here from the verified user id + a validated UUID + a fixed
// variant: users/{userId}/photos/{photoId}/{variant}. The browser never supplies a path. Objects
// uploaded before multi-user (app/photos/…) are readable only by the claimed legacy owner.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VARIANTS = new Set(["original", "display", "thumb"]);
const MIME = /^image\/(jpeg|png|heic|heif|webp|gif)$/;
export const photoKey = (userId: string, id: string, v: string) => `users/${userId}/photos/${id}/${v}`;
export const legacyPhotoKey = (id: string, v: string) => `app/photos/${id}/${v}`;
export interface PhotoOwner { id: string; isLegacyOwner: boolean }
const hex = (b?: ArrayBuffer) => (b ? [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("") : "");

export async function uploadPhoto(req: Request, env: AppEnv, user: PhotoOwner, id: string, variant: string): Promise<Response> {
  if (!UUID.test(id) || !VARIANTS.has(variant)) throw new HttpError(400, "bad_photo_path");
  const len = Number(req.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(len) || len <= 0) throw new HttpError(411, "content_length_required");
  if (len > (variant === "original" ? 60 : 5) * 1024 * 1024) throw new HttpError(413, "too_large");
  const mime = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!MIME.test(mime) || !req.body) throw new HttpError(415, "unsupported_type");
  const key = photoKey(user.id, id, variant);
  if (variant === "original") {
    const sha256 = (req.headers.get("x-sha256") ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, "sha256_required");
    const existing = (await env.PHOTOS.head(key)) ?? (user.isLegacyOwner ? await env.PHOTOS.head(legacyPhotoKey(id, variant)) : null);
    if (existing) {
      // Idempotent retry of the same original is fine; anything else is refused (write-once).
      if (hex(existing.checksums.sha256) === sha256) {
        await req.body.cancel();
        return json({ stored: true, id, size: existing.size, existed: true });
      }
      throw new HttpError(409, "original_exists_write_once");
    }
    try {
      const obj = await env.PHOTOS.put(key, req.body, { sha256, httpMetadata: { contentType: mime }, customMetadata: { crc32: (req.headers.get("x-crc32") ?? "").slice(0, 8) } });
      logEvent("photo.upload", { variant, bytes: obj?.size ?? 0 });
      return json({ stored: true, id, size: obj?.size ?? 0 });
    } catch {
      throw new HttpError(422, "checksum_mismatch");
    }
  }
  const obj = await env.PHOTOS.put(key, req.body, { httpMetadata: { contentType: mime } });
  logEvent("photo.upload", { variant, bytes: obj?.size ?? 0 });
  return json({ stored: true, id, variant });
}

async function getOwned(env: AppEnv, user: PhotoOwner, id: string, variant: string, opts?: R2GetOptions) {
  const own = await env.PHOTOS.get(photoKey(user.id, id, variant), opts);
  if (own || !user.isLegacyOwner) return own;
  return env.PHOTOS.get(legacyPhotoKey(id, variant), opts);
}

export async function getPhoto(env: AppEnv, user: PhotoOwner, id: string, variant: string, req: Request): Promise<Response> {
  if (!UUID.test(id) || !VARIANTS.has(variant)) throw new HttpError(400, "bad_photo_path");
  const obj = await getOwned(env, user, id, variant, { onlyIf: req.headers });
  if (!obj) throw new HttpError(404, "not_found");
  const headers = new Headers({
    "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    // Same URL for every user → the browser must revalidate (ETag) with the server on each use, so a
    // shared device never serves one user's cached photo to another. Offline display uses the
    // per-user IndexedDB blob store instead of the HTTP cache.
    "cache-control": "private, no-cache",
    vary: "Cf-Access-Jwt-Assertion, Cookie",
    "x-content-type-options": "nosniff",
    etag: obj.httpEtag,
  });
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  return new Response((obj as R2ObjectBody).body, { headers });
}

export async function readDisplayAsBase64(env: AppEnv, user: PhotoOwner, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const obj = await getOwned(env, user, id, "display");
  if (!obj) return null;
  const buf = new Uint8Array(await obj.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
