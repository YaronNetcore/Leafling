import { LIVE_SAMPLE, type FrameStats, frameStats } from "../../shared/light.ts";

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Samples the live preview for a short interval (≈1.4 s) and returns per-frame statistics. Each frame is drawn
 * into a 64×48 in-memory canvas, reduced to numbers and overwritten by the next; the canvas is released at the end.
 * `isCancelled` lets the caller abort when the screen is left or hidden mid-measurement.
 */
export async function sampleFrames(video: HTMLVideoElement, isCancelled: () => boolean): Promise<FrameStats[]> {
  const canvas = document.createElement("canvas");
  canvas.width = LIVE_SAMPLE.width;
  canvas.height = LIVE_SAMPLE.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const out: FrameStats[] = [];
  try {
    if (!g) return out;
    for (let i = 0; i < LIVE_SAMPLE.frames && !isCancelled(); i++) {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        out.push(frameStats(g.getImageData(0, 0, canvas.width, canvas.height).data));
      }
      await wait(LIVE_SAMPLE.intervalMs);
    }
    return out;
  } finally {
    g?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
  }
}
