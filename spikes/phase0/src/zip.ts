import type { Ctx } from "./env.ts";
import { photoKey } from "./photos.ts";
import { HttpError, logEvent } from "./util.ts";

// P0-7 FEASIBILITY TEST ONLY (not an approved implementation).
// Streams a store-only ZIP of originals from R2, using CRC-32 and sizes recorded at upload.
// The Worker does not hash photo bytes, but still does per-entry work and per-chunk piping,
// and every R2 read is a subrequest. These costs are what this test measures.
// Optional repeatToMB cycles through the uploaded photos (as distinct ZIP entries) so large
// test sizes can be reached without uploading hundreds of photos.

interface PhotoRow { id: string; mime: string; size: number; crc32: number; sha256: string; captured_at: string | null; original_name: string | null }
interface Entry { name: Uint8Array; photo: PhotoRow | null; data: Uint8Array | null; size: number; crc: number; offset: number }

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp", "image/gif": "gif" };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): [number, number] {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return [time, date];
}

function localHeader(e: Entry, t: number, d: number): Uint8Array {
  const b = new Uint8Array(30 + e.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 10, true);        // version needed (stored)
  v.setUint16(6, 0x0800, true);    // UTF-8 names
  v.setUint16(8, 0, true);         // method: stored
  v.setUint16(10, t, true);
  v.setUint16(12, d, true);
  v.setUint32(14, e.crc, true);
  v.setUint32(18, e.size, true);
  v.setUint32(22, e.size, true);
  v.setUint16(26, e.name.length, true);
  v.setUint16(28, 0, true);
  b.set(e.name, 30);
  return b;
}

function centralHeader(e: Entry, t: number, d: number): Uint8Array {
  const b = new Uint8Array(46 + e.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 10, true);
  v.setUint16(8, 0x0800, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, t, true);
  v.setUint16(14, d, true);
  v.setUint32(16, e.crc, true);
  v.setUint32(20, e.size, true);
  v.setUint32(24, e.size, true);
  v.setUint16(28, e.name.length, true);
  v.setUint32(42, e.offset, true);
  b.set(e.name, 46);
  return b;
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const b = new Uint8Array(22);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  return b;
}

export async function exportZip(ctx: Ctx): Promise<Response> {
  const p = ctx.url.searchParams;
  const maxEntries = Math.min(Math.max(Number(p.get("maxEntries") ?? "40") | 0, 1), 400);
  const repeatToMB = Math.min(Math.max(Number(p.get("repeatToMB") ?? "0") || 0, 0), 1024);
  const rows = (await ctx.env.DB.prepare(
    `SELECT id, mime, size, crc32, sha256, captured_at, original_name FROM photos ORDER BY created_at`,
  ).all<PhotoRow>()).results;
  if (!rows.length) throw new HttpError(404, "no_photos");

  const enc = new TextEncoder();
  const entries: Entry[] = [];
  let payloadBytes = 0;
  const target = repeatToMB * 1024 * 1024;
  for (let i = 0; entries.length < maxEntries; i++) {
    if (!repeatToMB && i >= rows.length) break;
    if (repeatToMB && payloadBytes >= target) break;
    const r = rows[i % rows.length];
    const date = (r.captured_at ?? "unknown").slice(0, 10).replace(/[^0-9-]/g, "") || "unknown";
    const name = `${String(entries.length + 1).padStart(4, "0")}_${date}_${r.id}.${EXT[r.mime] ?? "bin"}`;
    entries.push({ name: enc.encode(name), photo: r, data: null, size: r.size, crc: r.crc32 >>> 0, offset: 0 });
    payloadBytes += r.size;
  }
  const index = enc.encode(JSON.stringify({
    format: "leafling-phase0-photo-export-test",
    createdAt: new Date().toISOString(),
    note: "Feasibility test. Entries may repeat the same photo to reach the test size.",
    entries: entries.map((e) => ({ file: new TextDecoder().decode(e.name), photoId: e.photo!.id, sha256: e.photo!.sha256, capturedAt: e.photo!.captured_at, size: e.size })),
  }, null, 1));
  entries.push({ name: enc.encode("photos-index.json"), photo: null, data: index, size: index.length, crc: crc32(index), offset: 0 });

  let offset = 0;
  for (const e of entries) { e.offset = offset; offset += 30 + e.name.length + e.size; }
  const cdOffset = offset;
  const cdSize = entries.reduce((s, e) => s + 46 + e.name.length, 0);
  const total = cdOffset + cdSize + 22;
  if (total > 0xfffffff0) throw new HttpError(400, "zip_too_large_for_zip32");

  const [t, d] = dosDateTime(new Date());
  const { readable, writable } = new FixedLengthStream(total);
  const started = Date.now();
  let r2Gets = 0;

  const pump = (async () => {
    let writer = writable.getWriter();
    try {
      for (const e of entries) {
        await writer.write(localHeader(e, t, d));
        if (e.data) {
          await writer.write(e.data);
          continue;
        }
        const obj = await ctx.env.PHOTOS.get(photoKey(e.photo!.id, "original"));
        r2Gets++;
        if (!obj || obj.size !== e.size) throw new Error("object_missing_or_size_mismatch");
        writer.releaseLock();
        await obj.body.pipeTo(writable, { preventClose: true });
        writer = writable.getWriter();
      }
      for (const e of entries) await writer.write(centralHeader(e, t, d));
      await writer.write(endRecord(entries.length, cdSize, cdOffset));
      await writer.close();
      logEvent("export.zip", { entries: entries.length, bytes: total, r2Gets, subrequestsApprox: r2Gets + 1, ms: Date.now() - started, outcome: "complete" });
    } catch (err) {
      logEvent("export.zip", { entries: entries.length, bytes: total, r2Gets, ms: Date.now() - started, outcome: `failed:${(err as Error).message}` });
      try { await writer.abort(err); } catch {
        try { await writable.abort(err); } catch { /* stream already errored */ }
      }
    }
  })();
  ctx.exec.waitUntil(pump);

  return new Response(readable, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="leafling-photos-test-${entries.length - 1}.zip"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-export-entries": String(entries.length - 1),
      "x-export-bytes": String(total),
    },
  });
}
