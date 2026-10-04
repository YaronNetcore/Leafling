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

// ---------- Live automatic light meter (מד אור, 2026-10) ----------
//
// WHAT THE BROWSER GIVES US (verified against WebKit's MediaTrackCapabilities IDL, 2026-10):
// - iPhone Safari / Home-Screen PWA (every iOS browser is WebKit): live frames, width/height/frameRate/facingMode,
//   focusDistance, whiteBalanceMode, zoom, torch, backgroundBlur, powerEfficient. NO exposureMode, exposureTime,
//   iso, exposureCompensation or aperture — and exposure cannot be locked. Native iOS apps read exposure duration,
//   ISO and aperture from AVFoundation; a PWA cannot. So Leafling CANNOT compute a defensible lux value on iPhone.
// - Frames are auto-exposed: the camera scales the whole picture toward a normal brightness, so the absolute
//   brightness of a pixel says little about how much light falls on the spot.
//
// WHAT SURVIVES AUTO-EXPOSURE (and is measured here, continuously):
// 1. Shadow contrast inside the target circle. Auto-exposure multiplies the lit and the shadowed part of the same
//    frame by the same gain, so their RATIO is preserved. Light = direct + diffuse; a shadow removes most of the
//    direct part: lit/shadow ≈ (direct + diffuse) / diffuse. Direct sun gives deep shadows (ratio ≈ 4–10), bright
//    window light clear but soft ones (≈ 1.8–4), weaker room light faint ones (≈ 1.3–1.8), dim even light almost
//    none. This is the camera version of the horticultural hand-shadow test.
// 2. Shadow edge sharpness: a small source (the sun, a close lamp) casts a crisp edge, a large one (a window, the
//    sky) a wide penumbra. Crisp + deep is required before "direct light" is shown.
// 3. The camera's limit: if the whole frame stays dark although auto-exposure has raised sensitivity as far as it
//    can, the spot is genuinely dim (far below the "אור חלש" band) — the one absolute signal available.
// Nothing here is lux and it is never shown or stored as lux. Thresholds are physical approximations, not a
// calibration; they must be confirmed on a real iPhone (see docs). A bright-looking frame alone never means sun.

export type LightConfidence = "high" | "medium" | "low";

/** Statistics of the analysed target (pixels inside the circle), linear-light luma 0..1. */
export interface TargetStats { p5: number; p95: number; clipped: number; sharp: number; n: number }
/** One live sample: the target circle + a coarse view of the whole frame (for the dark check). */
export interface LiveSample { target: TargetStats; frameMean: number; frameP95: number }

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const LIN = Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const lumaByte = (d: ArrayLike<number>, i: number) => Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
function percentile(xs: Float32Array | number[], q: number) {
  const a = Float32Array.from(xs).sort();
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : 0;
}

/**
 * Target statistics of a w×h RGBA patch (the bounding square of the circle). Only pixels inside the inscribed circle
 * count. Values are linearised (sRGB → linear) and box-blurred 3×3 so fine texture does not look like a shadow.
 */
export function analyzeTarget(rgba: ArrayLike<number>, w: number, h: number): TargetStats {
  const lin = new Float32Array(w * h);
  let clippedN = 0, n = 0;
  const cx = (w - 1) / 2, cy = (h - 1) / 2, r2 = (Math.min(w, h) / 2) ** 2;
  const inside = (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const yb = lumaByte(rgba, (y * w + x) * 4);
    lin[y * w + x] = LIN[yb];
    if (inside(x, y)) { n++; if (yb >= 248) clippedN++; }
  }
  const blur = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += lin[yy * w + xx]; c++; }
    }
    blur[y * w + x] = s / c;
  }
  const vals: number[] = [], grads: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (!inside(x, y)) continue;
    const i = y * w + x;
    vals.push(blur[i]);
    const gx = (blur[i + 1] - blur[i - 1]) / 2, gy = (blur[i + w] - blur[i - w]) / 2;
    grads.push(Math.hypot(gx, gy));
  }
  const p5 = percentile(vals, 0.05), p95 = percentile(vals, 0.95);
  // Edge sharpness: the strongest gradients (top 1.5 % — a shadow edge is a thin line) relative to the light range.
  // A crisp edge spread over ~3 blurred pixels gives ≈ 0.3; a wide penumbra a few hundredths.
  const sharp = percentile(grads, 0.985) / Math.max(p95 - p5, 0.02) * (Math.min(w, h) / 48);
  return { p5, p95, clipped: n ? clippedN / n : 0, sharp, n };
}

/** Coarse whole-frame statistics (for the dark check), linear luma. */
export function frameLevel(rgba: ArrayLike<number>): { mean: number; p95: number } {
  const n = Math.floor(rgba.length / 4);
  const v: number[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) { const x = LIN[lumaByte(rgba, i * 4)]; v.push(x); s += x; }
  return { mean: n ? s / n : 0, p95: percentile(v, 0.95) };
}

export const SHADOW_EPS = 0.004;
/** Lit/shadow ratio inside the target (≥ 1). */
export const shadowContrast = (t: TargetStats) => (t.p95 + SHADOW_EPS) / (t.p5 + SHADOW_EPS);
/** Whole frame dark at the camera's sensitivity limit (linear mean ≈ sRGB 0.11, p95 ≈ sRGB 0.27). */
export const isDark = (s: LiveSample) => s.frameMean < 0.012 && s.frameP95 < 0.06;

/** Category boundaries on log2(lit/shadow): 1.3 → 0.38, 1.8 → 0.85, 4 → 2.0. Direct additionally needs a crisp edge. */
export const BOUNDS = { faint: Math.log2(1.3), medium: Math.log2(1.8), strong: Math.log2(4) } as const;
export const SHARP_EDGE = 0.15;
const HYST = 0.1; // log2 units beyond a boundary before switching category
export const HOLD_MS = 600; // a new category must persist this long before it is shown

export type AutoCategory = LightCat | "no_shadow";
export interface LiveState {
  ready: boolean;
  /** 0 (dark) … 1 (deep, crisp shadow) — position on the "חשוך … שמש" scale. Relative, NOT lux. */
  position: number;
  category: AutoCategory | null;
  confidence: LightConfidence;
  dark: boolean;
  /** Smoothed lit/shadow ratio and edge sharpness (relative signals, saved with a reading). */
  contrast: number;
  sharp: number;
  samples: number;
}

function rawCategory(l2: number, sharp: number, prev: AutoCategory | null): AutoCategory {
  // Hysteresis: the current category keeps a margin of HYST around its own boundaries.
  const m = (c: AutoCategory) => (prev === c ? HYST : 0);
  if (l2 >= BOUNDS.strong - m("direct") && sharp >= SHARP_EDGE - (prev === "direct" ? 0.03 : 0)) return "direct";
  if (l2 >= BOUNDS.medium - m("bright_indirect") - m("direct")) return "bright_indirect";
  if (l2 >= BOUNDS.faint - m("medium")) return "medium";
  return "no_shadow";
}

/**
 * Continuous smoothing: exponential moving averages (time constant ~0.7 s) of log2(contrast) and sharpness, a
 * debounced dark flag (majority of the last ~1 s), and a category that changes only after it has been the
 * candidate for HOLD_MS (plus a hysteresis margin around boundaries) — responsive, without flicker.
 */
export class LightSmoother {
  private l2 = 0; private sh = 0; private n = 0; private last = 0;
  private darkHist: { t: number; d: boolean }[] = [];
  private shown: AutoCategory | null = null; private cand: AutoCategory | null = null; private candSince = 0;
  constructor(private tau = 700) {}
  reset() { this.n = 0; this.darkHist = []; this.shown = null; this.cand = null; }
  push(s: LiveSample, t: number): LiveState {
    const l2 = Math.log2(shadowContrast(s.target));
    if (!this.n) { this.l2 = l2; this.sh = s.target.sharp; }
    else { const a = 1 - Math.exp(-Math.max(0, t - this.last) / this.tau); this.l2 += a * (l2 - this.l2); this.sh += a * (s.target.sharp - this.sh); }
    this.n++; this.last = t;
    this.darkHist.push({ t, d: isDark(s) });
    this.darkHist = this.darkHist.filter((x) => t - x.t <= 1000);
    const dark = this.darkHist.filter((x) => x.d).length * 2 > this.darkHist.length;
    const now: AutoCategory = dark ? "low" : rawCategory(this.l2, this.sh, this.shown);
    if (now !== this.cand) { this.cand = now; this.candSince = t; }
    if (this.shown === null ? this.n >= 3 : now !== this.shown && t - this.candSince >= HOLD_MS) this.shown = now;
    const position = dark ? 0.03 : Math.min(1, Math.max(0.1, 0.1 + 0.9 * (this.l2 / 3)));
    const category = this.shown;
    const confidence: LightConfidence = category === "low" && dark ? "high" : category === "no_shadow" || category === null ? "low" : "medium";
    return { ready: this.n >= 3, position, category, confidence, dark, contrast: 2 ** this.l2, sharp: this.sh, samples: this.n };
  }
}

/** Live categories in the UI (automatic; never chosen by the user). */
export const AUTO_LABEL: Record<AutoCategory, { emoji: string; title: string; text: string }> = {
  low: { emoji: "🌑", title: "אור חלש", text: "המצלמה בקושי רואה — המקום חשוך. מתאים רק לצמחים סבלניים מאוד לצל." },
  no_shadow: { emoji: "🌫️", title: "אין צל ברור בעיגול", text: "אם הצל של היד בתוך העיגול ובכל זאת כמעט לא רואים אותו — האור חלש. אם אין צל בעיגול, אי אפשר לדעת." },
  medium: { emoji: "🌥️", title: "אור בינוני", text: "צל רך ומטושטש — מתאים לרוב צמחי הבית שאוהבים אור עקיף מתון." },
  bright_indirect: { emoji: "☀️", title: "אור חזק", text: "צל ברור אבל רך — מתאים לצמחים שאוהבים הרבה אור עקיף." },
  direct: { emoji: "🌞", title: "אור ישיר", text: "צל חד וכהה — שמש ישירה (או מנורה קרובה). מתאים לצמחים שאוהבים שמש; צמחי צל עלולים להיכוות." },
};
export const CONFIDENCE_LABEL: Record<LightConfidence, string> = { high: "ודאות גבוהה", medium: "ודאות בינונית", low: "ודאות נמוכה" };

/** Which category is SAVED for an automatic state ("no shadow" is saved as low light with low confidence). */
export const savedCategory = (c: AutoCategory): LightCat => (c === "no_shadow" ? "low" : c);

/** The user-facing labels (four categories only). */
export const LIGHT_CATEGORY_LABEL: Record<LightCat, string> = {
  low: "אור חלש",
  medium: "אור בינוני",
  bright_indirect: "אור חזק",
  direct: "שמש ישירה",
};

/** How a reading was obtained — always carried to the UI and to the AI context. */
export const LIGHT_SOURCE_LABEL: Record<string, string> = {
  camera_live_auto: "מדידה אוטומטית במצלמה (לפי הצל — לא לוקס)",
  camera_live_dark: "הערכה ממצלמה חיה (לא מד אור מכויל)",
  camera_live_user: "הערכה שלך במד האור",
  camera_exposure: "הערכה מצילום (לא מד אור מכויל)",
  user_choice: "הערכה שלך",
  manual_lux: "מד לוקס חיצוני",
  questionnaire: "שאלון (גרסה קודמת)",
  camera_relative: "מחוון מצלמה (גרסה קודמת)",
};
