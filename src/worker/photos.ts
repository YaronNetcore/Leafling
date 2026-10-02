import type { AppEnv } from "./env.ts";
import { HttpError, json, logEvent } from "./http.ts";

// Originals are streamed byte-for-byte into private R2 with an R2-verified SHA-256 and are
// write-once. Display/thumb copies are produced on the phone. Photos are served only
// through this Worker (behind Access) — no public bucket, no presigned URLs.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VARIANTS = new Set(["original", "display", "thumb"]);
const MIME = /^image\/(jpeg|png|heic|heif|webp|gif)$/;
export const photoKey = (id: string, v: string) => `app/photos/${id}/${v}`;

export async function uploadPhoto(req: Request, env: AppEnv, id: string, variant: string): Promise<Response> {
  if (!UUID.test(id) || !VARIANTS.has(variant)) throw new HttpError(400, "bad_photo_path");
  const len = Number(req.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(len) || len <= 0) throw new HttpError(411, "content_length_required");
  if (len > (variant === "original" ? 60 : 5) * 1024 * 1024) throw new HttpError(413, "too_large");
  const mime = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!MIME.test(mime) || !req.body) throw new HttpError(415, "unsupported_type");
  const key = photoKey(id, variant);
  if (variant === "original") {
    const sha256 = (req.headers.get("x-sha256") ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, "sha256_required");
    const existing = await env.PHOTOS.head(key);
    if (existing) {
      // Idempotent retry of the same original is fine; anything else is refused (write-once).
      if (existing.checksums.sha256 && [...new Uint8Array(existing.checksums.sha256)].map((b) => b.toString(16).padStart(2, "0")).join("") === sha256) {
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

export async function getPhoto(env: AppEnv, id: string, variant: string, req: Request): Promise<Response> {
  if (!UUID.test(id) || !VARIANTS.has(variant)) throw new HttpError(400, "bad_photo_path");
  const obj = await env.PHOTOS.get(photoKey(id, variant), { onlyIf: req.headers });
  if (!obj) throw new HttpError(404, "not_found");
  const headers = new Headers({
    "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    etag: obj.httpEtag,
  });
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  return new Response((obj as R2ObjectBody).body, { headers });
}

export async function readDisplayAsBase64(env: AppEnv, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const obj = await env.PHOTOS.get(photoKey(id, "display"));
  if (!obj) return null;
  const buf = new Uint8Array(await obj.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
