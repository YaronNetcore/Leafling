import type { LightCat } from "./types.ts";

// Light estimate from a phone photo — honest by construction.
//
// What an iPhone browser/PWA can actually read: Safari exposes no ambient-light sensor and no camera
// exposure controls to web pages. What it CAN read is the EXIF exposure the camera's auto-exposure chose
// for a photo (shutter time t, aperture N, ISO S). Auto-exposure aims for a mid-grey image, so the scene
// brightness follows the standard reflected/incident-meter relation  E ≈ C · N² / (t · S)  with C ≈ 250.
// This is a ROUGH estimate (surface colour, framing, HDR processing and lens all shift it by about a stop),
// so Leafling only ever shows one of four broad categories, labelled as an estimate — never a lux number.

export interface Exposure { exposureTime: number; fNumber: number; iso: number }

const C = 250;
/** Category bands (lux) from common horticultural guidance: ~250 / ~1000 / ~2000 foot-candles. */
const BANDS: [number, LightCat][] = [[2700, "low"], [10800, "medium"], [21500, "bright_indirect"]];

export function validExposure(e: Partial<Exposure> | null | undefined): e is Exposure {
  return !!e && typeof e.exposureTime === "number" && typeof e.fNumber === "number" && typeof e.iso === "number"
    && e.exposureTime > 1e-6 && e.exposureTime <= 60 && e.fNumber >= 0.7 && e.fNumber <= 64 && e.iso >= 10 && e.iso <= 409600;
}

/** Internal only (never shown): approximate scene illuminance in lux. */
export function approxIlluminance(e: Exposure): number {
  return (C * e.fNumber * e.fNumber) / (e.exposureTime * e.iso);
}

export function categoryFromExposure(e: Exposure): LightCat {
  const lux = approxIlluminance(e);
  for (const [max, cat] of BANDS) if (lux < max) return cat;
  return "direct";
}

// ---------- Live camera (מד אור) ----------
//
// What a live camera stream in a browser really exposes (2026):
// - iPhone Safari / Home-Screen PWA: frames only. No ImageCapture API, and no exposure time, ISO or aperture on
//   MediaStreamTrack settings; exposure cannot be locked. Frames are auto-exposed (the camera brightens or
//   darkens every scene toward mid-grey) and tone-mapped, so average pixel brightness is NOT a measure of how
//   much light there is: a dim room and a sunny sill both come out "normally bright".
// - Chromium (Android/desktop) may list exposure properties, but by the spec exposureTime is meaningful only in
//   manual mode, and support differs per device — not a basis Leafling relies on.
// The one defensible signal in auto-exposed frames is the camera's LIMIT: when the frames stay dark even
// though the camera has raised its sensitivity as far as it can, the spot is genuinely dim (for a phone camera at
// 1/30 s and its highest ISO that is far below the "אור חלש" band). Everything brighter is indistinguishable
// from pixels alone, so the app says so and the user names what she sees (with the hand-shadow test as a guide).
// Very bright, clipped areas are reported only as a hint ("maybe sun or a window") — never as "direct sun".

/** Per-frame statistics of a small, in-memory downscaled frame (sRGB luma 0..1). Frames are never kept. */
export interface FrameStats { mean: number; p95: number; clipped: number }

export type LiveVerdict =
  | { kind: "dark" } // the camera could not brighten the image: little light → "low" (estimate)
  | { kind: "undetermined"; brightAreas: boolean } // auto-exposure hides the light level; the user decides
  | { kind: "unstable" } // brightness jumped between frames (phone moved / light flickered) → measure again
  | { kind: "no_frames" }; // the stream delivered too few frames to say anything

export const LIVE_SAMPLE = { warmupMs: 1000, frames: 12, intervalMs: 120, width: 64, height: 48 } as const;

/** Luma statistics of an RGBA buffer (as returned by getImageData). */
export function frameStats(rgba: ArrayLike<number>): FrameStats {
  const n = Math.floor(rgba.length / 4);
  if (!n) return { mean: 0, p95: 0, clipped: 0 };
  const hist = new Uint32Array(256);
  let sum = 0, clipped = 0;
  for (let i = 0; i < n; i++) {
    const y = Math.round(0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]);
    hist[y]++; sum += y; if (y >= 248) clipped++;
  }
  let acc = 0, p95 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.95 * n) { p95 = v; break; } }
  return { mean: sum / n / 255, p95: p95 / 255, clipped: clipped / n };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

/** Honest verdict from a short series of live frames. Never returns a lux value or a "direct sun" claim. */
export function analyzeLiveFrames(frames: FrameStats[]): LiveVerdict {
  if (frames.length < 5) return { kind: "no_frames" };
  const means = frames.map((f) => f.mean);
  const lo = Math.min(...means), hi = Math.max(...means);
  if ((hi - lo) / Math.max(median(means), 0.05) > 0.35) return { kind: "unstable" };
  // Dark even at the camera's limit: overall dark AND no bright region at all (a dark frame with a bright
  // window in it is just a high-contrast scene, not a dim spot).
  if (median(means) < 0.1 && median(frames.map((f) => f.p95)) < 0.3) return { kind: "dark" };
  return { kind: "undetermined", brightAreas: median(frames.map((f) => f.clipped)) >= 0.05 };
}

/** The hand-shadow test: a real, simple way to judge light by eye (shown next to the user's choice). */
export const SHADOW_HINT: Record<LightCat, string> = {
  low: "כמעט אין צל",
  medium: "צל רך ומטושטש",
  bright_indirect: "צל ברור, בלי שמש על המקום",
  direct: "קרני שמש על המקום, צל חד",
};

/** The user-facing labels (four categories only). */
export const LIGHT_CATEGORY_LABEL: Record<LightCat, string> = {
  low: "אור חלש",
  medium: "אור בינוני",
  bright_indirect: "אור חזק",
  direct: "שמש ישירה",
};

/** How a reading was obtained — always carried to the UI and to the AI context. */
export const LIGHT_SOURCE_LABEL: Record<string, string> = {
  camera_live_dark: "הערכה ממצלמה חיה (לא מד אור מכויל)",
  camera_live_user: "הערכה שלך במד האור",
  camera_exposure: "הערכה מצילום (לא מד אור מכויל)",
  user_choice: "הערכה שלך",
  manual_lux: "מד לוקס חיצוני",
  questionnaire: "שאלון (גרסה קודמת)",
  camera_relative: "מחוון מצלמה (גרסה קודמת)",
};
