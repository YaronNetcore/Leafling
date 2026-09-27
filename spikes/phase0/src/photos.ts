import type { Ctx } from "./env.ts";
import { HttpError, UUID_RE, json, logEvent } from "./util.ts";

// P0-5 / P0-6: originals streamed byte-for-byte into R2 with an R2-verified SHA-256
// checksum (the Worker does not hash photo bytes). Originals are write-once.

const MAX_ORIGINAL = 60 * 1024 * 1024;
const MAX_VARIANT = 5 * 1024 * 1024;
const VARIANTS = new Set(["original", "display", "thumb"]);
const ALLOWED_MIME = /^image\/(jpeg|png|heic|heif|webp|gif)$/;

export const photoKey = (id: string, variant: string) => `spike/photos/${id}/${variant}`;

export async function uploadPhoto(req: Request, ctx: Ctx, id: string, variant: string): Promise<Response> {
  if (!UUID_RE.test(id) || !VARIANTS.has(variant)) throw new HttpError(400, "bad_photo_path");
  const len = Number(req.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(len) || len <= 0) throw new HttpError(411, "content_length_required");
  const mime = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!ALLOWED_MIME.test(mime)) throw new HttpError(415, "unsupported_type");
  if (!req.body) throw new HttpError(400, "empty_body");
  const t0 = Date.now();

  if (variant === "original") {
    if (len > MAX_ORIGINAL) throw new HttpError(413, "too_large");
    const sha256 = (req.headers.get("x-sha256") ?? "").toLowerCase();
    const crcHex = (req.headers.get("x-crc32") ?? "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256) || !/^[0-9a-f]{8}$/.test(crcHex)) throw new HttpError(400, "checksums_required");
    const existing = await ctx.env.DB.prepare(`SELECT id FROM photos WHERE id = ?`).bind(id).first();
    if (existing) throw new HttpError(409, "original_exists_write_once");
    if (await ctx.env.PHOTOS.head(photoKey(id, "original"))) throw new HttpError(409, "original_exists_write_once");

    let obj: R2Object | null;
    try {
      obj = await ctx.env.PHOTOS.put(photoKey(id, "original"), req.body, {
        sha256,
        httpMetadata: { contentType: mime },
        customMetadata: { crc32: crcHex },
      });
    } catch (e) {
      logEvent("photo.upload", { variant, bytes: len, outcome: "checksum_or_put_failed", ms: Date.now() - t0 });
      throw new HttpError(422, "checksum_mismatch_or_put_failed");
    }
    if (!obj) throw new HttpError(500, "put_failed");
    const name = decodeURIComponent(req.headers.get("x-original-name") ?? "").slice(0, 200);
    const captured = (req.headers.get("x-captured-at") ?? "").slice(0, 40) || null;
    await ctx.env.DB.prepare(
      `INSERT INTO photos (id, mime, size, sha256, crc32, original_name, captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, mime, obj.size, sha256, parseInt(crcHex, 16), name, captured, new Date().toISOString()).run();
    logEvent("photo.upload", { variant, bytes: obj.size, outcome: "stored", ms: Date.now() - t0 });
    return json({ stored: true, id, size: obj.size, sha256 });
  }

  if (len > MAX_VARIANT) throw new HttpError(413, "too_large");
  const row = await ctx.env.DB.prepare(`SELECT id FROM photos WHERE id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, "original_missing");
  const obj = await ctx.env.PHOTOS.put(photoKey(id, variant), req.body, { httpMetadata: { contentType: mime } });
  await ctx.env.DB.prepare(`UPDATE photos SET ${variant === "display" ? "has_display" : "has_thumb"} = 1 WHERE id = ?`).bind(id).run();
  logEvent("photo.upload", { variant, bytes: obj?.size ?? 0, outcome: "stored", ms: Date.now() - t0 });
  return json({ stored: true, id, variant, size: obj?.size ?? 0 });
}

export async function getPhoto(ctx: Ctx, id: string, variant: string): Promise<Response> {
  if (!UUID_RE.test(id) || !VARIANTS.has(variant)) throw new HttpError(400, "bad_photo_path");
  const obj = await ctx.env.PHOTOS.get(photoKey(id, variant));
  if (!obj) throw new HttpError(404, "not_found");
  logEvent("photo.get", { variant, bytes: obj.size });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "content-length": String(obj.size),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag: obj.httpEtag,
    },
  });
}

export async function listPhotos(ctx: Ctx): Promise<Response> {
  const rows = await ctx.env.DB.prepare(
    `SELECT id, mime, size, sha256, crc32, original_name, captured_at, created_at, has_display, has_thumb FROM photos ORDER BY created_at`,
  ).all();
  return json({ photos: rows.results });
}
