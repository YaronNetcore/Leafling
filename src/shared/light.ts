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

/** The user-facing labels (four categories only). */
export const LIGHT_CATEGORY_LABEL: Record<LightCat, string> = {
  low: "אור חלש",
  medium: "אור בינוני",
  bright_indirect: "אור חזק",
  direct: "שמש ישירה",
};

/** How a reading was obtained — always carried to the UI and to the AI context. */
export const LIGHT_SOURCE_LABEL: Record<string, string> = {
  camera_exposure: "הערכה מצילום (לא מד אור מכויל)",
  user_choice: "הערכה שלך",
  manual_lux: "מד לוקס חיצוני",
  questionnaire: "שאלון (גרסה קודמת)",
  camera_relative: "מחוון מצלמה (גרסה קודמת)",
};
