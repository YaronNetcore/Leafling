// Shared domain types (client + Worker). All records sync through the generic
// record store (entity + id + JSON data) with server-assigned revisions.

export type Status = "rooting" | "seedling" | "plant" | "sick";
export type LightCat = "low" | "medium" | "bright_indirect" | "direct";
export type Confidence = "known" | "likely" | "possible" | "insufficient";
export type DatePrecision = "exact" | "day" | "unknown";

export type Entity = "plant" | "event" | "location" | "light" | "photo" | "wishlist" | "health" | "profile" | "reminder";

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
  /** Server revision of the last synced state (client-side bookkeeping only). */
  _rev?: number;
}

export interface Plant extends BaseRecord {
  speciesId: string | null;
  scientificName: string;
  commonName: string;
  ordinal: number;
  nickname?: string | null;
  status: Status;
  locationId?: string | null;
  potDiameterCm?: number | null;
  potMaterial?: string | null;
  drainage?: boolean | null;
  substrate?: string | null;
  acquiredAt?: string | null;
  acquiredPrecision?: DatePrecision;
  sowDate?: string | null;
  seedCount?: number | null;
  germinatedCount?: number | null;
  sowingType?: "one_cell" | "multiple_cells" | "direct" | null;
  propagationMethod?: string | null;
  propagationStart?: string | null;
  rootState?: "none" | "started" | "growing" | "problem" | null;
  cuttingCount?: number | null;
  mainPhotoId?: string | null;
  favorite?: boolean;
  archivedAt?: string | null;
  note?: string | null;
}

export type EventType =
  | "soil_check" | "watering" | "fertilizing" | "fertilizer_skipped" | "repot" | "pot_changed"
  | "substrate_changed" | "location_changed" | "status_changed" | "pruning" | "note" | "milestone"
  | "photo_added" | "sowing" | "germination_update" | "propagation_started" | "root_check"
  | "water_change" | "diagnosis" | "treatment_started" | "treatment_ended" | "task_postponed"
  | "measurement" | "plant_created" | "reminder_done" | "propagation_completed";

export interface PlantEvent extends BaseRecord {
  plantId: string;
  type: EventType;
  occurredAt: string;
  precision?: DatePrecision;
  payload: Record<string, unknown>;
  source: "user" | "system" | "ai_confirmed";
  inJournal: boolean;
  inHistory: boolean;
}

export interface Location extends BaseRecord {
  name: string;
  kind: "indoor" | "outdoor";
  windowDirection?: "north" | "south" | "east" | "west" | null;
  windowDistance?: "on_sill" | "near" | "middle" | "far" | null;
  directSun?: "none" | "morning" | "afternoon" | "most_day" | null;
  ac?: boolean | null;
  outdoorExposure?: "full_sun" | "partial" | "shade" | null;
  lightCategory?: LightCat | null;
}

export interface LightReading extends BaseRecord {
  locationId: string;
  measuredAt: string;
  method: "manual_lux" | "questionnaire" | "camera_relative";
  lux?: number | null;
  category: LightCat;
  timeOfDay?: "morning" | "noon" | "afternoon" | null;
}

export interface Photo extends BaseRecord {
  plantId?: string | null;
  capturedAt?: string | null;
  capturedSource: "exif" | "user" | "upload" | "unknown";
  mime: string;
  size: number;
  sha256: string;
  crc32: string;
  width: number;
  height: number;
  uploadState: "pending" | "uploaded" | "failed";
  inJournal: boolean;
  note?: string | null;
}

export interface WishlistItem extends BaseRecord {
  speciesId: string;
  note?: string | null;
  purchasedAt?: string | null;
  plantId?: string | null;
}

export interface HealthCase extends BaseRecord {
  plantId: string;
  title: string;
  state: "active" | "monitoring" | "resolved";
  source: "ai" | "professional" | "user";
  likelyCause?: string | null;
  confidence?: Confidence | null;
  notes?: string | null;
  openedAt: string;
  resolvedAt?: string | null;
}

export interface Reminder extends BaseRecord {
  plantId: string;
  kind: "rotate" | "support" | "inspect" | "custom";
  text: string;
  everyDays?: number | null;
  nextAt: string;
  active: boolean;
  important?: boolean;
}

export interface PetEntry { kind: PetKind; name?: string | null }
export type PetKind = "dog" | "cat" | "bird" | "rabbit" | "rodent" | "reptile" | "other";

export interface Profile extends BaseRecord {
  id: "me";
  country?: string | null;
  region?: string | null;
  city?: string | null;
  pets: PetEntry[];
  interests: string[];
  places: string[];
  experience?: "beginner" | "some" | "experienced" | "expert" | null;
  help: Record<string, boolean>;
  notificationsOptIn?: boolean;
  onboardingStep: number;
  onboardingDone: boolean;
  welcomeSeen?: boolean;
  theme?: "system" | "light" | "dark";
}

export interface Mutation {
  mutationId: string;
  entity: Entity;
  recordId: string;
  patch: Record<string, unknown>;
  baseRev: number;
  clientTime: string;
  deviceId: string;
}

export interface MutationResult {
  mutationId: string;
  entity: Entity;
  recordId: string;
  baseRev: number;
  result: "applied" | "applied_with_conflict" | "noop" | `duplicate:${string}`;
  appliedRev: number | null;
  conflicts: number;
}

export interface PulledRecord { entity: Entity; id: string; data: Record<string, unknown>; rev: number }
