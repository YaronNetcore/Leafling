// Minimal EXIF reader (no dependency): finds the "Exif\0\0" TIFF block in a JPEG APP1 segment or a
// HEIC item and reads the few tags Leafling uses. Never throws; missing/invalid data → nulls.

export interface ExifInfo {
  dateTimeOriginal: string | null; // ISO string (device-local time interpreted as local)
  exposureTime: number | null;     // seconds
  fNumber: number | null;
  iso: number | null;
  hasGps: boolean;
}

const EMPTY: ExifInfo = { dateTimeOriginal: null, exposureTime: null, fNumber: null, iso: null, hasGps: false };

export function readExif(u8: Uint8Array): ExifInfo {
  const lim = Math.min(u8.length, 512 * 1024);
  let s = -1;
  for (let i = 0; i < lim - 6; i++) if (u8[i] === 0x45 && u8[i + 1] === 0x78 && u8[i + 2] === 0x69 && u8[i + 3] === 0x66 && u8[i + 4] === 0 && u8[i + 5] === 0) { s = i + 6; break; }
  if (s < 0) return { ...EMPTY };
  try {
    const dv = new DataView(u8.buffer, u8.byteOffset + s, Math.min(u8.length - s, 256 * 1024));
    const le = dv.getUint16(0) === 0x4949;
    const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
    type Tag = { type: number; count: number; at: number };
    const ifd = (off: number) => { const tags: Record<number, Tag> = {}; const n = u16(off); for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 }; } return tags; };
    const ascii = (t?: Tag) => { if (!t) return null; const o = t.count > 4 ? u32(t.at) : t.at; let r = ""; for (let i = 0; i < t.count - 1; i++) r += String.fromCharCode(dv.getUint8(o + i)); return r; };
    const rational = (t?: Tag) => { if (!t || (t.type !== 5 && t.type !== 10)) return null; const o = u32(t.at); const n = t.type === 10 ? dv.getInt32(o, le) : u32(o); const d = t.type === 10 ? dv.getInt32(o + 4, le) : u32(o + 4); return d ? n / d : null; };
    const short = (t?: Tag) => (!t ? null : t.type === 3 ? u16(t.at) : t.type === 4 ? u32(t.at) : null);
    const ifd0 = ifd(u32(4));
    const exif = ifd0[0x8769] ? ifd(u32(ifd0[0x8769].at)) : {};
    const raw = ascii(exif[0x9003]) ?? ascii(ifd0[0x0132]);
    const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
    return {
      dateTimeOriginal: m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).toISOString() : null,
      exposureTime: rational(exif[0x829a]),
      fNumber: rational(exif[0x829d]),
      iso: short(exif[0x8827]),
      hasGps: Boolean(ifd0[0x8825]),
    };
  } catch { return { ...EMPTY }; }
}

/** Builds a JPEG APP1 EXIF segment (used by tests to fabricate camera files). */
export function buildExifApp1(o: { exposureTime?: [number, number]; fNumber?: [number, number]; iso?: number; date?: string; gps?: boolean }): Uint8Array {
  const entries0: [number, number, number, number | null][] = []; // tag, type, count, value(inline)
  const exifEntries: { tag: number; type: number; count: number; data: number[] | null; inline?: number }[] = [];
  if (o.exposureTime) exifEntries.push({ tag: 0x829a, type: 5, count: 1, data: o.exposureTime });
  if (o.fNumber) exifEntries.push({ tag: 0x829d, type: 5, count: 1, data: o.fNumber });
  if (o.iso) exifEntries.push({ tag: 0x8827, type: 3, count: 1, data: null, inline: o.iso });
  const dateBytes = o.date ? [...new TextEncoder().encode(o.date), 0] : null;
  if (dateBytes) exifEntries.push({ tag: 0x9003, type: 2, count: dateBytes.length, data: null });
  void entries0;
  // Layout (big endian "MM"): header(8) | IFD0 | ExifIFD | GPS IFD | data
  const ifd0Count = 1 + (o.gps ? 1 : 0);
  const ifd0Off = 8, ifd0Size = 2 + ifd0Count * 12 + 4;
  const exifOff = ifd0Off + ifd0Size, exifSize = 2 + exifEntries.length * 12 + 4;
  const gpsOff = exifOff + exifSize, gpsSize = o.gps ? 2 + 1 * 12 + 4 : 0;
  let dataOff = gpsOff + gpsSize;
  const buf = new DataView(new ArrayBuffer(dataOff + 64));
  buf.setUint16(0, 0x4d4d); buf.setUint16(2, 42); buf.setUint32(4, ifd0Off);
  let p = ifd0Off; buf.setUint16(p, ifd0Count); p += 2;
  buf.setUint16(p, 0x8769); buf.setUint16(p + 2, 4); buf.setUint32(p + 4, 1); buf.setUint32(p + 8, exifOff); p += 12;
  if (o.gps) { buf.setUint16(p, 0x8825); buf.setUint16(p + 2, 4); buf.setUint32(p + 4, 1); buf.setUint32(p + 8, gpsOff); p += 12; }
  buf.setUint32(p, 0);
  p = exifOff; buf.setUint16(p, exifEntries.length); p += 2;
  for (const e of exifEntries) {
    buf.setUint16(p, e.tag); buf.setUint16(p + 2, e.type); buf.setUint32(p + 4, e.count);
    if (e.type === 3) buf.setUint16(p + 8, e.inline ?? 0);
    else if (e.type === 5) { buf.setUint32(p + 8, dataOff); buf.setUint32(dataOff, e.data![0]); buf.setUint32(dataOff + 4, e.data![1]); dataOff += 8; }
    else if (e.type === 2 && dateBytes) { buf.setUint32(p + 8, dataOff); dateBytes.forEach((b, i) => buf.setUint8(dataOff + i, b)); dataOff += dateBytes.length; }
    p += 12;
  }
  buf.setUint32(p, 0);
  if (o.gps) { p = gpsOff; buf.setUint16(p, 1); p += 2; buf.setUint16(p, 0x0000); buf.setUint16(p + 2, 1); buf.setUint32(p + 4, 4); buf.setUint32(p + 8, 0x02020000); p += 12; buf.setUint32(p, 0); }
  const tiff = new Uint8Array(buf.buffer, 0, dataOff);
  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]); payload.set(tiff, 6);
  const seg = new Uint8Array(4 + payload.length);
  seg.set([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]); seg.set(payload, 4);
  return seg;
}

/** Inserts an APP1 segment right after the JPEG SOI marker. */
export function withExif(jpeg: Uint8Array, app1: Uint8Array): Uint8Array {
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2)); out.set(app1, 2); out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}
