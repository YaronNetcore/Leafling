import type { AppEnv } from "./env.ts";
import { HttpError } from "./http.ts";

// Compact, question-aware plant context for the AI (ARCHITECTURE "AI Botanist chat").
// - Exactly ONE plant of the signed-in user; every statement binds the verified user id, so a foreign or
//   guessed plant id simply finds nothing (→ 404). Other plants are never queried.
// - One D1 round trip: all lookups run as a single batch (plant, its location via sub-select, the relevant
//   events, health, light, profile, and — for chat — the conversation's recent messages).
// - Only what the question needs: a watering question gets waterings, soil checks, pot/substrate and the
//   observed intervals between waterings; a propagation question gets root checks and propagation fields;
//   and so on. Nothing is invented: missing data is simply absent.

export type Topic = "watering" | "propagation" | "health" | "light" | "feeding" | "repotting" | "pets";

const TOPIC_WORDS: Record<Topic, RegExp> = {
  watering: /השקי|השקא|להשקות|מים|יבש|רטוב|לחות האדמה|אדמה|מצע רטוב|בדיקת אדמה|water|dry|soggy|moist/i,
  propagation: /ייחור|יחור|שורש|השרש|ריבוי|להעביר לכד|לעציץ מים|מים עם|זרע|זריע|נביט|שתיל|propagat|cutting|root|seed|germinat/i,
  health: /מצהיב|צהוב|חום|כתם|כתמים|נבול|נבל|נשיר|נושר|חרק|מזיק|כנימ|אקרית|תריפס|זבוב|עובש|ריקב|מחלה|חולה|פטרי|קורים|חורים|stress|yellow|brown|spot|pest|mite|rot|mold|disease|droop/i,
  light: /אור|שמש|חלון|צל|מואר|חשוך|light|sun|window|shade/i,
  feeding: /דשן|דישון|לדשן|fertili[sz]|feed/i,
  repotting: /עציץ|העבר|להעביר|שתיל|גודל עציץ|מצע|repot|pot\b|soil mix/i,
  pets: /חיות|חיית|חיה|חתול|כלב|ציפור|ארנב|מכרסם|זוחל|רעיל|בטיח|pet|toxic|cat|dog/i,
};

/** Topics of the current question; the previous user question is included so short follow-ups keep their topic. */
export function detectTopics(...texts: (string | null | undefined)[]): Set<Topic> {
  const t = texts.filter(Boolean).join(" \n ");
  return new Set((Object.keys(TOPIC_WORDS) as Topic[]).filter((k) => TOPIC_WORDS[k].test(t)));
}

const EVENT_TYPES: Record<Topic, string[]> = {
  watering: ["watering", "soil_check", "repot", "pot_changed", "substrate_changed", "location_changed"],
  propagation: ["propagation_started", "root_check", "water_change", "germination_update", "sowing", "propagation_completed", "milestone", "status_changed"],
  health: ["diagnosis", "treatment_started", "treatment_ended", "status_changed", "note", "watering", "soil_check", "repot", "location_changed"],
  light: ["location_changed"],
  feeding: ["fertilizing", "fertilizer_skipped", "repot", "substrate_changed"],
  repotting: ["repot", "pot_changed", "substrate_changed", "root_check", "watering"],
  pets: [],
};

export interface HistoryMessage { role: "user" | "assistant"; text: string; status?: string; attachments?: number; at: string }

export interface PlantContext {
  ctx: Record<string, unknown>;
  sections: string[];
  /** Messages of the conversation before the current one, oldest first (chat only). */
  history: HistoryMessage[];
  /** Latest uploaded photo of this plant (only looked up when `wantPhoto`). */
  latestPhotoId: string | null;
  dbMs: number;
}

const trimText = (s: unknown, n: number) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : s);
function compactPayload(p: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (k === "photoId" || k === "photoIds" || v == null || v === "") continue;
    out[k] = typeof v === "string" ? trimText(v, 200) : v;
  }
  return out;
}

const DAY = 86_400_000;

/**
 * Loads the context for one plant (or none) in one D1 batch. `topics` decide which events and fields are
 * included; with no specific topic a short general recent history is used.
 */
export async function loadPlantContext(env: AppEnv, userId: string, opts: {
  plantId: string | null; topics: Set<Topic>; chatId?: string | null; beforeAt?: string | null; wantPhoto?: boolean; historyLimit?: number;
}): Promise<PlantContext> {
  const { plantId, topics } = opts;
  const t0 = Date.now();
  const db = env.DB;
  const types = [...new Set([...topics].flatMap((t) => EVENT_TYPES[t]))];
  const wantLight = topics.has("light") || topics.has("watering") || topics.has("health") || !topics.size;
  const stmts: D1PreparedStatement[] = [];
  const idx: Record<string, number> = {};
  const add = (k: string, s: D1PreparedStatement) => { idx[k] = stmts.length; stmts.push(s); };

  if (plantId) {
    add("plant", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'plant' AND id = ?2`).bind(userId, plantId));
    add("location", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'location'
      AND id = (SELECT json_extract(data, '$.locationId') FROM user_records WHERE user_id = ?1 AND entity = 'plant' AND id = ?2)`).bind(userId, plantId));
    if (topics.size) {
      add("events", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'event' AND json_extract(data, '$.plantId') = ?2
        AND json_extract(data, '$.type') IN (${types.map((_, i) => `?${i + 3}`).join(",")})
        ORDER BY json_extract(data, '$.occurredAt') DESC LIMIT 14`).bind(userId, plantId, ...types));
    } else {
      // No specific topic: a short recent history of any kind (photo entries carry no text and are skipped).
      add("events", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'event' AND json_extract(data, '$.plantId') = ?2
        AND COALESCE(json_extract(data, '$.type'), '') <> 'photo_added'
        ORDER BY json_extract(data, '$.occurredAt') DESC LIMIT 10`).bind(userId, plantId));
    }
    add("health", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'health' AND json_extract(data, '$.plantId') = ?2 ORDER BY rev DESC LIMIT 5`).bind(userId, plantId));
    if (wantLight) {
      add("light", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'light' AND (json_extract(data, '$.plantId') = ?2
        OR json_extract(data, '$.locationId') = (SELECT json_extract(data, '$.locationId') FROM user_records WHERE user_id = ?1 AND entity = 'plant' AND id = ?2))
        ORDER BY json_extract(data, '$.measuredAt') DESC LIMIT 4`).bind(userId, plantId));
    }
    if (opts.wantPhoto) {
      add("photo", db.prepare(`SELECT id FROM user_records WHERE user_id = ?1 AND entity = 'photo' AND json_extract(data, '$.plantId') = ?2
        AND json_extract(data, '$.uploadState') = 'uploaded' AND json_extract(data, '$.deletedAt') IS NULL ORDER BY json_extract(data, '$.createdAt') DESC LIMIT 1`).bind(userId, plantId));
    }
  }
  add("profile", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'profile' AND id = 'me'`).bind(userId));
  if (opts.chatId) {
    add("history", db.prepare(`SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'message' AND json_extract(data, '$.chatId') = ?2
      AND json_extract(data, '$.at') < ?3 ORDER BY json_extract(data, '$.at') DESC, json_extract(data, '$.role') ASC LIMIT ?4`)
      .bind(userId, opts.chatId, opts.beforeAt ?? "9999", opts.historyLimit ?? 40));
  }

  const res = await db.batch(stmts);
  const rows = (k: string) => (k in idx ? (res[idx[k]].results as { data?: string; id?: string }[]) : []);
  const parse = (k: string) => rows(k).map((r) => JSON.parse(r.data!) as Record<string, unknown>).filter((x) => !x.deletedAt);
  const ctx: Record<string, unknown> = {};
  const sections: string[] = [];

  if (plantId) {
    const p = parse("plant")[0];
    if (!p) throw new HttpError(404, "plant_not_found");
    const plant: Record<string, unknown> = {
      name: p.nickname || (Number(p.ordinal) > 1 ? `${p.commonName} #${p.ordinal}` : p.commonName),
      species: { he: p.commonName, scientific: p.scientificName },
      status: p.status, acquiredAt: p.acquiredAt ?? null,
    };
    const potRelevant = topics.has("watering") || topics.has("repotting") || topics.has("health") || topics.has("feeding") || !topics.size;
    if (potRelevant) Object.assign(plant, { potDiameterCm: p.potDiameterCm ?? null, potMaterial: p.potMaterial ?? null, drainage: p.drainage ?? null, substrate: p.substrate ?? null });
    if (topics.has("propagation") || p.status === "rooting" || p.status === "seedling") {
      Object.assign(plant, { propagationMethod: p.propagationMethod ?? null, propagationStart: p.propagationStart ?? null, rootState: p.rootState ?? null, cuttingCount: p.cuttingCount ?? null, sowDate: p.sowDate ?? null, seedCount: p.seedCount ?? null, germinatedCount: p.germinatedCount ?? null });
    }
    ctx.plant = Object.fromEntries(Object.entries(plant).filter(([, v]) => v !== null && v !== undefined));
    sections.push("plant");
    const l = parse("location")[0];
    if (l) { ctx.location = Object.fromEntries(Object.entries({ name: l.name, kind: l.kind, lightCategory: l.lightCategory, windowDirection: l.windowDirection, directSun: l.directSun }).filter(([, v]) => v != null)); sections.push("location"); }
    const events = parse("events").map((e) => ({ date: String(e.occurredAt).slice(0, 10), type: e.type, details: compactPayload(e.payload as Record<string, unknown>) }));
    if (events.length) {
      ctx.recentHistory = events.map((e) => (Object.keys(e.details).length ? e : { date: e.date, type: e.type }));
      sections.push("history");
      if (topics.has("watering")) {
        const waterings = parse("events").filter((e) => e.type === "watering").map((e) => Date.parse(String(e.occurredAt))).filter(Number.isFinite).sort((a, b) => b - a);
        const gaps = waterings.slice(0, 6).map((t, i, a) => (i + 1 < a.length ? Math.round((t - a[i + 1]) / DAY) : null)).filter((x): x is number => x != null && x > 0);
        if (gaps.length >= 2) ctx.observedDaysBetweenWaterings = gaps;
      }
    }
    const health = parse("health").map((h) => ({ title: h.title, state: h.state, likelyCause: trimText(h.likelyCause, 200) ?? null, source: h.source }));
    const healthWanted = topics.has("health") || !topics.size ? health : health.filter((h) => h.state !== "resolved");
    if (healthWanted.length) { ctx.healthCases = healthWanted; sections.push("health"); }
    const lights = parse("light");
    if (lights.length) {
      ctx.lightObservations = lights.map((x) => ({
        date: String(x.measuredAt).slice(0, 10), category: x.category, forThisPlant: x.plantId === plantId,
        source: x.method === "camera_live_dark" ? "rough estimate: the live phone camera stayed dark at its sensitivity limit, i.e. a dim spot (NOT a calibrated light meter)"
          : x.method === "camera_live_user" ? "user's own visual estimate of the spot (hand-shadow test), NOT a measurement"
          : x.method === "camera_exposure" ? "rough estimate from phone camera exposure (NOT a calibrated light meter)"
          : x.method === "user_choice" ? "user's own estimate" : x.method === "manual_lux" ? "external lux meter (user-entered)" : "older rough estimate",
      }));
      sections.push("light");
    }
  }
  const pr = parse("profile")[0];
  if (pr) {
    const user: Record<string, unknown> = {};
    const region = [pr.region, pr.country].filter(Boolean).join(", ");
    if (region) user.region = region;
    if (pr.experience) user.experience = pr.experience;
    if (topics.has("pets") && Array.isArray(pr.pets)) {
      // Pets: kinds with counts only (toxicity depends on the kind of animal; names are not needed).
      const counts: Record<string, number> = {};
      for (const x of pr.pets as { kind?: unknown }[]) if (typeof x?.kind === "string") counts[x.kind] = (counts[x.kind] ?? 0) + 1;
      user.pets = Object.entries(counts).map(([kind, count]) => ({ kind, count }));
    }
    if (Object.keys(user).length) { ctx.user = user; sections.push("user"); }
  }
  const history = parse("history").reverse().map((m) => ({ role: m.role as "user" | "assistant", text: String(m.text ?? ""), status: m.status as string | undefined, attachments: m.attachments as number | undefined, at: String(m.at) }));
  const photo = rows("photo")[0]?.id ?? null;
  return { ctx, sections, history, latestPhotoId: photo, dbMs: Date.now() - t0 };
}

/**
 * Bounded conversation history for the model: the last `recent` messages verbatim (each capped), plus a short
 * list of the earlier user questions so the thread's subject survives without resending the whole transcript.
 */
export function boundedHistory(history: HistoryMessage[], recent = 8, perMessage = 1200): { messages: { role: "user" | "assistant"; content: string }[]; earlier: string[] } {
  const tail = history.slice(-recent);
  const earlier = history.slice(0, -recent).filter((m) => m.role === "user").map((m) => trimText(m.text, 100) as string).slice(-6);
  const messages = tail.map((m) => ({
    role: m.role,
    content: `${trimText(m.text, perMessage)}${m.attachments ? `\n[צורפו ${m.attachments} תמונות להודעה הזו]` : ""}${m.role === "assistant" && m.status === "partial" ? "\n[התשובה נקטעה באמצע]" : ""}`,
  }));
  // The API expects the conversation to start with a user turn.
  while (messages.length && messages[0].role === "assistant") messages.shift();
  return { messages, earlier };
}
