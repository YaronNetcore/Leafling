import { blobToBase64, decode, resizeJpeg } from "./media.ts";

// Images attached to AI requests (identify / pest / "what is this" / botanist / diagnose).
// - The user's original file is never modified; we send a NEW downsized JPEG made by drawing the decoded
//   pixels onto a canvas, which carries no EXIF at all (so no GPS/location), no cropping, no enhancement.
// - Previews are made the same way (small JPEG), so a preview only appears for a file we can really decode.

export const MAX_IMAGES = 4;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|gif)$/i;

export type ImageError = "not_image" | "too_large" | "unreadable" | "too_many";
export const IMAGE_ERROR_TEXT: Record<ImageError, string> = {
  not_image: "הקובץ שנבחר אינו תמונה.",
  too_large: "התמונה גדולה מדי (מעל 40MB).",
  unreadable: "לא הצלחנו לקרוא את התמונה. אפשר לנסות לצלם שוב או לבחור תמונה אחרת.",
  too_many: `אפשר לצרף עד ${MAX_IMAGES} תמונות.`,
};

export function checkFile(f: File): ImageError | null {
  if (!(f.type.startsWith("image/") || (!f.type && IMAGE_EXT.test(f.name)))) return "not_image";
  if (f.size > MAX_FILE_BYTES) return "too_large";
  if (f.size === 0) return "unreadable";
  return null;
}

/** Which of `incoming` fit under the limit, in order. */
export function planAdd<T>(current: number, incoming: T[], max = MAX_IMAGES): { accept: T[]; overflow: number } {
  const room = Math.max(0, max - current);
  return { accept: incoming.slice(0, room), overflow: Math.max(0, incoming.length - room) };
}

/** Small preview JPEG (object URL). Throws "unreadable" if the browser cannot decode the file. */
export async function makePreview(f: File): Promise<string> {
  try {
    const img = await decode(f);
    const { blob } = await resizeJpeg(img, 320, 0.8);
    return URL.createObjectURL(blob);
  } catch { throw new Error("unreadable"); }
}

/** EXIF-free downsized JPEG copies as base64 for the Worker (≤1568 px long edge). */
export async function prepareForUpload(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files.slice(0, MAX_IMAGES)) {
    let blob: Blob;
    try { blob = (await resizeJpeg(f, 1568, 0.82)).blob; } catch { throw new Error("image_unreadable"); }
    out.push(await blobToBase64(blob));
  }
  return out;
}
