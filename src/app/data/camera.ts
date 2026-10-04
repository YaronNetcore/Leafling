import { analyzeTarget, frameLevel, type LiveSample } from "../../shared/light.ts";

// Live rear camera for the Light Meter (getUserMedia → MediaStream → inline <video>). Nothing here records,
// stores or uploads frames: a frame is drawn into a tiny in-memory canvas, reduced to three numbers and dropped.
// Plant identification keeps its own photo attachments (PhotoPicker); this module is only for the live meter.

export type CameraProblem = "unsupported" | "denied" | "no_camera" | "busy" | "failed";

export class CameraError extends Error {
  constructor(readonly problem: CameraProblem) { super(problem); }
}

/** Maps a getUserMedia failure to what the user can do about it. */
export function cameraProblem(e: unknown): CameraProblem {
  if (e instanceof CameraError) return e.problem;
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no_camera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "failed";
}

/** Hebrew explanations — never followed by a silent switch to the native photo camera. */
export const CAMERA_PROBLEM_TEXT: Record<CameraProblem | "interrupted", { title: string; body: string }> = {
  unsupported: { title: "הדפדפן הזה לא מאפשר מצלמה חיה", body: "מד האור עובד עם תצוגת מצלמה חיה בתוך Leafling. אפשר לפתוח את האפליקציה ב-Safari באייפון (או בדפדפן עדכני אחר) ולנסות שוב." },
  denied: { title: "אין הרשאה למצלמה", body: "כדי למדוד אור Leafling צריכה גישה למצלמה. באייפון: הגדרות ← Safari ← מצלמה ← לאפשר (או לחיצה על ״aA״ בשורת הכתובת ← הגדרות אתר). אחר כך לחצי ״לנסות שוב״." },
  no_camera: { title: "לא נמצאה מצלמה", body: "לא מצאנו מצלמה במכשיר הזה. מד האור צריך מצלמה אחורית." },
  busy: { title: "המצלמה תפוסה", body: "נראה שאפליקציה אחרת משתמשת במצלמה. אפשר לסגור אותה ולנסות שוב." },
  failed: { title: "לא הצלחנו להפעיל את המצלמה", body: "אפשר לנסות שוב בעוד רגע." },
  interrupted: { title: "המצלמה נעצרה", body: "המכשיר עצר את המצלמה (למשל בגלל שיחה או אפליקציה אחרת). אפשר להפעיל אותה שוב." },
};

/** Opens the rear camera (preferred, not required) without audio. Requires a secure (HTTPS) context. */
export async function openRearCamera(): Promise<MediaStream> {
  if (typeof window === "undefined" || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new CameraError("unsupported");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (e) {
    throw new CameraError(cameraProblem(e));
  }
}

/** Stops every track so the camera (and the iPhone's green camera indicator) turns off. */
export function stopStream(s: MediaStream | null | undefined) {
  for (const t of s?.getTracks() ?? []) t.stop();
}

/** Attaches a stream to a <video> for an inline, muted preview (iPhone Safari needs playsinline + muted). */
export async function attachPreview(video: HTMLVideoElement, s: MediaStream) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.srcObject = s;
  await video.play().catch(() => { /* autoplay of a muted inline stream is allowed; ignore spurious aborts */ });
}

export function detachPreview(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.srcObject = null;
}

/** The circle's area in VIDEO pixels. The preview uses object-fit: cover, centred, so the on-screen circle at the
 * container's centre maps to the video's centre, scaled by the cover factor. Recomputed every sample, so rotation
 * and resolution changes are followed. */
export function targetInVideo(vw: number, vh: number, boxW: number, boxH: number, circleCss: number) {
  const scale = Math.max(boxW / vw, boxH / vh);
  const size = Math.min(vw, vh, circleCss / scale);
  return { sx: (vw - size) / 2, sy: (vh - size) / 2, size };
}

const TARGET_PX = 48;
/**
 * Live sampler: each call draws ONLY the circle's square into a 48×48 in-memory canvas (and the whole frame into a
 * 16×12 one for the dark check), reduces both to a few numbers and overwrites them on the next call. No pixels
 * are kept, stored or sent anywhere. `dispose()` releases the canvases.
 */
export function createSampler() {
  const t = document.createElement("canvas"); t.width = TARGET_PX; t.height = TARGET_PX;
  const f = document.createElement("canvas"); f.width = 16; f.height = 12;
  const gt = t.getContext("2d", { willReadFrequently: true });
  const gf = f.getContext("2d", { willReadFrequently: true });
  return {
    sample(video: HTMLVideoElement, box: { w: number; h: number; circle: number }): LiveSample | null {
      if (!gt || !gf || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      const g = targetInVideo(video.videoWidth, video.videoHeight, box.w, box.h, box.circle);
      gt.drawImage(video, g.sx, g.sy, g.size, g.size, 0, 0, TARGET_PX, TARGET_PX);
      gf.drawImage(video, 0, 0, 16, 12);
      const target = analyzeTarget(gt.getImageData(0, 0, TARGET_PX, TARGET_PX).data, TARGET_PX, TARGET_PX);
      const fr = frameLevel(gf.getImageData(0, 0, 16, 12).data);
      gt.clearRect(0, 0, TARGET_PX, TARGET_PX); gf.clearRect(0, 0, 16, 12);
      return { target, frameMean: fr.mean, frameP95: fr.p95 };
    },
    dispose() { t.width = 0; t.height = 0; f.width = 0; f.height = 0; },
  };
}

/** What THIS browser really exposes about the camera (shown under "פרטים טכניים"; nothing is stored). */
export interface CameraReport { supported: string[]; capabilities: string[]; settings: Record<string, string>; exposureData: boolean }
const INTERESTING = ["exposureMode", "exposureTime", "exposureCompensation", "iso", "whiteBalanceMode", "colorTemperature", "brightness", "focusDistance", "zoom", "torch", "frameRate", "width", "height", "facingMode"];
export function cameraReport(track: MediaStreamTrack | undefined): CameraReport {
  const sup = (navigator.mediaDevices?.getSupportedConstraints?.() ?? {}) as Record<string, boolean>;
  const caps = (track?.getCapabilities?.() ?? {}) as Record<string, unknown>;
  const set = (track?.getSettings?.() ?? {}) as Record<string, unknown>;
  const settings: Record<string, string> = {};
  for (const k of INTERESTING) if (k in set) settings[k] = String(typeof set[k] === "number" ? Math.round((set[k] as number) * 100) / 100 : set[k]);
  return {
    supported: INTERESTING.filter((k) => sup[k]),
    capabilities: INTERESTING.filter((k) => k in caps),
    settings,
    exposureData: "exposureTime" in caps && "iso" in caps,
  };
}
