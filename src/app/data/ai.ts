import type { Confidence } from "../../shared/types.ts";
import { AuthRequired, api } from "./sync.ts";

// Client for the server-side Claude proxy. Sends only IDs, the question and EXIF-free
// JPEG copies (≤1568px). No API keys exist in the browser.

export interface AiCandidate { name_he: string; scientific: string; confidence: Confidence; why: string }
export interface AiResult {
  answer: string;
  observed: string[];
  interpretation: string[];
  missing: string[];
  confidence: Confidence;
  candidates: AiCandidate[];
  urgency: "none" | "green" | "yellow" | "orange" | "red";
  contagious_suspected: boolean;
  retake_request: string | null;
}

const ERRORS: Record<string, string> = {
  ai_not_configured: "ה-AI עוד לא הוגדר בשרת (חסר מפתח). שאר האפליקציה עובדת כרגיל.",
  ai_budget_reached: "הגענו לתקציב ה-AI החודשי. אפשר להמשיך להשתמש בכל השאר.",
  ai_rate_limited: "הרבה בקשות בזמן קצר — נסי שוב בעוד כמה דקות.",
  ai_refused: "לא הצלחנו לקבל תשובה לבקשה הזו.",
  ai_unparseable: "התשובה מה-AI לא הגיעה בצורה תקינה. אפשר לנסות שוב.",
  offline: "צריך חיבור לאינטרנט כדי לשאול את ה-AI. התמונות נשארו כאן — אפשר לנסות שוב.",
  needs_login: "צריך להתחבר מחדש. התמונות נשארו כאן — אחרי ההתחברות אפשר לנסות שוב.",
  image_unreadable: "לא הצלחנו לעבד אחת התמונות. אפשר להסיר אותה ולנסות שוב.",
  bad_image: "אחת התמונות לא נשלחה בצורה תקינה. אפשר להסיר אותה ולנסות שוב.",
  too_many_images: "אפשר לשלוח עד 4 תמונות.",
  body_too_large: "התמונות גדולות מדי לשליחה. אפשר לשלוח פחות תמונות.",
  question_required: "צריך לכתוב שאלה.",
  plant_not_found: "הצמח לא נמצא.",
  photo_not_of_this_plant: "התמונה שנבחרה לא שייכת לצמח הזה.",
};
export function aiErrorText(code: string): string {
  if (ERRORS[code]) return ERRORS[code];
  if (/^ai_upstream_5|ai_request_failed/.test(code)) return "שירות ה-AI לא זמין כרגע. אפשר לנסות שוב בעוד רגע.";
  if (/^ai_upstream_4/.test(code)) return "שירות ה-AI דחה את הבקשה. אפשר לנסות שוב, ואם זה חוזר — לפנות למי שמתחזק/ת את האפליקציה.";
  return "משהו השתבש. אפשר לנסות שוב.";
}

/** @deprecated use prepareForUpload from ./images.ts */
export { prepareForUpload as prepareImages } from "./images.ts";

export async function askAi(body: { mode: "ask" | "identify" | "pest" | "what" | "diagnose"; plantId?: string; question?: string; images?: string[]; photoIds?: string[]; symptoms?: string[] }): Promise<AiResult> {
  if (!navigator.onLine) throw new Error("offline");
  let res: Response;
  try {
    res = await api("/api/v1/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    if (e instanceof AuthRequired) throw new Error("needs_login");
    throw new Error("offline");
  }
  const data = (await res.json().catch(() => ({}))) as { result?: AiResult; error?: string };
  if (!res.ok || !data.result) throw new Error(data.error ?? "ai_request_failed");
  return data.result;
}

/** Hand-off of picked photos between screens (kept in memory only). */
export const picked: { files: File[] } = { files: [] };
