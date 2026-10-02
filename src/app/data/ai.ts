import type { Confidence } from "../../shared/types.ts";
import { blobToBase64, resizeJpeg } from "./media.ts";
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
  offline: "צריך חיבור לאינטרנט כדי לשאול את ה-AI. השאלה נשמרה כאן — אפשר לנסות שוב.",
};
export const aiErrorText = (code: string) => ERRORS[code] ?? "משהו השתבש. אפשר לנסות שוב.";

export async function prepareImages(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files.slice(0, 4)) out.push(await blobToBase64((await resizeJpeg(f, 1568, 0.82)).blob));
  return out;
}

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
