import { useEffect, useState } from "react";
import type { Photo } from "../../shared/types.ts";
import { db } from "./db.ts";
import { recordEvent } from "./store.ts";
import { AuthRequired, api, mutate } from "./sync.ts";

// Photo pipeline (ARCHITECTURE §9): the original file is kept byte-identical; display
// (~1600px) and thumb (~400px) copies are made on the phone (no EXIF/GPS in copies).
// Blobs wait in IndexedDB until the server confirms the upload.

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0"); }
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Reads EXIF DateTimeOriginal from the "Exif\0\0" TIFF block (JPEG APP1 or HEIC item). */
export function exifDate(u8: Uint8Array): string | null {
  const lim = Math.min(u8.length, 512 * 1024);
  let s = -1;
  for (let i = 0; i < lim - 6; i++) if (u8[i] === 0x45 && u8[i + 1] === 0x78 && u8[i + 2] === 0x69 && u8[i + 3] === 0x66 && u8[i + 4] === 0 && u8[i + 5] === 0) { s = i + 6; break; }
  if (s < 0) return null;
  try {
    const dv = new DataView(u8.buffer, u8.byteOffset + s, Math.min(u8.length - s, 256 * 1024));
    const le = dv.getUint16(0) === 0x4949;
    const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
    const ifd = (off: number) => { const tags: Record<number, { count: number; at: number }> = {}; const n = u16(off); for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; tags[u16(e)] = { count: u32(e + 4), at: e + 8 }; } return tags; };
    const ascii = (t?: { count: number; at: number }) => { if (!t) return null; const o = t.count > 4 ? u32(t.at) : t.at; let r = ""; for (let i = 0; i < t.count - 1; i++) r += String.fromCharCode(dv.getUint8(o + i)); return r; };
    const ifd0 = ifd(u32(4));
    const exif = ifd0[0x8769] ? ifd(u32(ifd0[0x8769].at)) : {};
    const raw = ascii(exif[0x9003]) ?? ascii(ifd0[0x0132]);
    const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
    return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).toISOString() : null;
  } catch { return null; }
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try { return await createImageBitmap(file); } catch {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url); return img;
  }
}

export async function resizeJpeg(src: Blob | ImageBitmap | HTMLImageElement, longEdge: number, quality = 0.84): Promise<{ blob: Blob; width: number; height: number }> {
  const img = src instanceof Blob ? await decode(src) : src;
  const w = img.width, h = img.height, s = Math.min(1, longEdge / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode_failed"))), "image/jpeg", quality));
  return { blob, width: c.width, height: c.height };
}

export async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(b); });
}

/** Adds a personal photo; the original is stored unchanged. */
export async function addPhoto(plantId: string, file: File, opts: { setMain?: boolean; capturedAt?: string | null } = {}): Promise<Photo> {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", buf));
  const exif = exifDate(u8);
  const img = await decode(file);
  const display = await resizeJpeg(img, 1600, 0.85);
  const thumb = await resizeJpeg(img, 480, 0.8);
  const id = crypto.randomUUID();
  await db.blobs.bulkPut([
    { key: `${id}:original`, blob: file, createdAt: Date.now() },
    { key: `${id}:display`, blob: display.blob, createdAt: Date.now() },
    { key: `${id}:thumb`, blob: thumb.blob, createdAt: Date.now() },
  ]);
  const capturedAt = opts.capturedAt ?? exif;
  const photo = await mutate<Photo>("photo", id, {
    id, plantId, createdAt: new Date().toISOString(), capturedAt: capturedAt ?? null, capturedSource: opts.capturedAt ? "user" : exif ? "exif" : "upload",
    mime: file.type || "image/jpeg", size: file.size, sha256, crc32: crc32(u8), width: img.width, height: img.height, uploadState: "pending", inJournal: true,
  });
  await recordEvent(plantId, "photo_added", { photoId: id }, { occurredAt: capturedAt ?? undefined, inJournal: true });
  const plant = await db.plants.get(plantId);
  if (plant && (opts.setMain || !plant.mainPhotoId)) await mutate<import("../../shared/types.ts").Plant>("plant", plantId, { mainPhotoId: id });
  void uploadPending();
  return photo;
}

let uploading = false;
export async function uploadPending(): Promise<void> {
  if (uploading || !navigator.onLine) return;
  uploading = true;
  try {
    const pending = (await db.photos.where("uploadState").equals("pending").toArray()).filter((p) => !p.deletedAt);
    for (const p of pending) {
      const orig = await db.blobs.get(`${p.id}:original`);
      if (!orig) continue;
      const r = await api(`/api/v1/photos/${p.id}/original`, { method: "PUT", body: orig.blob, headers: { "content-type": p.mime, "x-sha256": p.sha256, "x-crc32": p.crc32 } });
      if (!r.ok) { if (r.status === 422) await mutate<Photo>("photo", p.id, { uploadState: "failed" }); continue; }
      for (const v of ["display", "thumb"] as const) {
        const b = await db.blobs.get(`${p.id}:${v}`);
        if (b) await api(`/api/v1/photos/${p.id}/${v}`, { method: "PUT", body: b.blob, headers: { "content-type": "image/jpeg" } });
      }
      await mutate<Photo>("photo", p.id, { uploadState: "uploaded" });
      await db.blobs.delete(`${p.id}:original`); // the cloud copy is confirmed; copies stay cached locally
    }
  } catch (e) { if (!(e instanceof AuthRequired)) console.warn("photo upload paused"); }
  finally { uploading = false; }
}

/** URL for a photo variant: local blob first (works offline), then the private API. */
export function usePhotoUrl(photoId: string | null | undefined, variant: "thumb" | "display" | "original" = "thumb"): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    if (!photoId) { setUrl(null); return; }
    (async () => {
      const b = (await db.blobs.get(`${photoId}:${variant}`)) ?? (variant !== "thumb" ? undefined : await db.blobs.get(`${photoId}:display`));
      if (!alive) return;
      if (b) { revoke = URL.createObjectURL(b.blob); setUrl(revoke); }
      else setUrl(`/api/v1/photos/${photoId}/${variant}`);
    })();
    return () => { alive = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [photoId, variant]);
  return url;
}
