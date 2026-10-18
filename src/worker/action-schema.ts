import { ACTION_KINDS, type ActionKind, type SoilState } from "../shared/actions.ts";
import type { Status } from "../shared/types.ts";

// Structured output of the action parser (Claude) and its strict validation. No Worker APIs here (unit-testable).

const MAX_PLANTS_LISTED = 300;
export const RECORD_TYPES = ["health_issue", "treatment", "watering", "fertilizing", "soil_check", "note", "reminder", "none"] as const;
export type RecordType = typeof RECORD_TYPES[number];

const KEYS = { type: "array", items: { type: "string" } } as const;
const REF = { type: "object", additionalProperties: false, required: ["text", "keys", "all_matching"], properties: { text: { type: "string" }, keys: KEYS, all_matching: { type: "boolean" } } } as const;
const STR_OR_NULL = { type: ["string", "null"] } as const;
export const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "action", "scope", "plants", "exclude", "include", "status_filter", "location_text", "location_key", "date_text", "soil", "pest", "product", "already_done", "move_to_text", "move_to_key", "reminder_text", "reminder_due_text", "note_text",
    "record_kind", "record_date_text", "which", "new_date_text", "new_product", "new_pest", "removal_meaning", "keep_treatment", "match_text"],
  properties: {
    intent: { type: "string", enum: ["new_action", "modify_pending", "confirm_pending", "cancel_pending", "chat"] },
    action: { type: "string", enum: [...ACTION_KINDS, "none"] },
    scope: { type: "string", enum: ["current_plant", "named", "location", "all", "status", "none"] },
    plants: { type: "array", items: REF },
    exclude: { type: "array", items: REF },
    include: { type: "array", items: REF },
    status_filter: { type: "string", enum: ["rooting", "seedling", "plant", "sick", "none"] },
    location_text: STR_OR_NULL, location_key: STR_OR_NULL,
    date_text: STR_OR_NULL,
    soil: { type: "string", enum: ["dry", "slightly_moist", "very_moist", "none"] },
    pest: STR_OR_NULL, product: STR_OR_NULL, already_done: { type: "boolean" },
    move_to_text: STR_OR_NULL, move_to_key: STR_OR_NULL,
    reminder_text: STR_OR_NULL, reminder_due_text: STR_OR_NULL, note_text: STR_OR_NULL,
    // Changes to existing records
    record_kind: { type: "string", enum: [...RECORD_TYPES] },
    record_date_text: STR_OR_NULL,
    which: { type: "string", enum: ["all", "last"] },
    new_date_text: STR_OR_NULL, new_product: STR_OR_NULL, new_pest: STR_OR_NULL,
    removal_meaning: { type: "string", enum: ["resolved", "erroneous", "unclear", "none"] },
    keep_treatment: { type: "boolean" },
    match_text: STR_OR_NULL,
  },
} as const;

export interface Ref { text: string; keys: string[]; all_matching: boolean }
export interface Parsed {
  intent: "new_action" | "modify_pending" | "confirm_pending" | "cancel_pending" | "chat";
  action: ActionKind | "none";
  scope: "current_plant" | "named" | "location" | "all" | "status" | "none";
  plants: Ref[]; exclude: Ref[]; include: Ref[];
  status_filter: Status | "none";
  location_text: string | null; location_key: string | null;
  date_text: string | null;
  soil: SoilState | "none";
  pest: string | null; product: string | null; already_done: boolean;
  move_to_text: string | null; move_to_key: string | null;
  reminder_text: string | null; reminder_due_text: string | null; note_text: string | null;
  record_kind: RecordType; record_date_text: string | null; which: "all" | "last";
  new_date_text: string | null; new_product: string | null; new_pest: string | null;
  removal_meaning: "resolved" | "erroneous" | "unclear" | "none"; keep_treatment: boolean; match_text: string | null;
}

const str = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const oneOf = <T extends string>(v: unknown, all: readonly T[], dflt: T): T => (all.includes(v as T) ? (v as T) : dflt);
const refs = (v: unknown): Ref[] => (Array.isArray(v) ? v.slice(0, 40) : []).filter((r) => r && typeof r === "object").map((r) => ({
  text: str((r as Ref).text, 80) ?? "",
  keys: (Array.isArray((r as Ref).keys) ? (r as Ref).keys : []).filter((k) => typeof k === "string" && /^p\d{1,4}$/.test(k)).slice(0, MAX_PLANTS_LISTED),
  all_matching: (r as Ref).all_matching === true,
})).filter((r) => r.text || r.keys.length);

/** Strict validation of the model output: anything outside the allowlist becomes "unknown", never an action. */
export function sanitizeParsed(raw: unknown): Parsed {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    intent: oneOf(o.intent, ["new_action", "modify_pending", "confirm_pending", "cancel_pending", "chat"] as const, "chat"),
    action: oneOf(o.action, [...ACTION_KINDS, "none"] as const, "none"),
    scope: oneOf(o.scope, ["current_plant", "named", "location", "all", "status", "none"] as const, "none"),
    plants: refs(o.plants), exclude: refs(o.exclude), include: refs(o.include),
    status_filter: oneOf(o.status_filter, ["rooting", "seedling", "plant", "sick", "none"] as const, "none"),
    location_text: str(o.location_text, 60), location_key: typeof o.location_key === "string" && /^l\d{1,4}$/.test(o.location_key) ? o.location_key : null,
    date_text: str(o.date_text, 60),
    soil: oneOf(o.soil, ["dry", "slightly_moist", "very_moist", "none"] as const, "none"),
    pest: str(o.pest, 60), product: str(o.product, 60), already_done: o.already_done !== false,
    move_to_text: str(o.move_to_text, 60), move_to_key: typeof o.move_to_key === "string" && /^l\d{1,4}$/.test(o.move_to_key) ? o.move_to_key : null,
    reminder_text: str(o.reminder_text, 140), reminder_due_text: str(o.reminder_due_text, 60), note_text: str(o.note_text, 500),
    record_kind: oneOf(o.record_kind, RECORD_TYPES, "none"), record_date_text: str(o.record_date_text, 60), which: oneOf(o.which, ["all", "last"] as const, "all"),
    new_date_text: str(o.new_date_text, 60), new_product: str(o.new_product, 60), new_pest: str(o.new_pest, 60),
    removal_meaning: oneOf(o.removal_meaning, ["resolved", "erroneous", "unclear", "none"] as const, "none"),
    keep_treatment: o.keep_treatment !== false, match_text: str(o.match_text, 80),
  };
}

