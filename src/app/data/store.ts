import { useLiveQuery } from "dexie-react-hooks";
import { nextOrdinal } from "../../shared/domain.ts";
import { speciesById, type Species } from "../../shared/species.ts";
import type {
  EventType, HealthCase, LightCat, LightReading, Location, Plant, PlantEvent, Profile, Reminder, Status, WishlistItem,
} from "../../shared/types.ts";
import { db } from "./db.ts";
import { mutate } from "./sync.ts";

const nowIso = () => new Date().toISOString();
const live = <T>(rec: T & { deletedAt?: string | null }) => !rec.deletedAt;

// ---------- Queries ----------
export const usePlants = () => useLiveQuery(async () => (await db.plants.toArray()).filter(live), [], undefined);
export const usePlant = (id?: string) => useLiveQuery(async () => (id ? db.plants.get(id) : undefined), [id], undefined);
export const useEvents = (plantId?: string) =>
  useLiveQuery(async () => (plantId ? (await db.events.where("plantId").equals(plantId).toArray()) : await db.events.toArray()).filter(live), [plantId], undefined);
export const useLocations = () => useLiveQuery(async () => (await db.locations.toArray()).filter(live), [], undefined);
export const useLocation = (id?: string | null) => useLiveQuery(async () => (id ? db.locations.get(id) : undefined), [id], undefined);
export const useLights = (locationId?: string) => useLiveQuery(async () => (locationId ? (await db.lights.where("locationId").equals(locationId).toArray()).filter(live) : []), [locationId], undefined);
export const usePhotos = (plantId?: string) => useLiveQuery(async () => (plantId ? (await db.photos.where("plantId").equals(plantId).toArray()) : await db.photos.toArray()).filter(live), [plantId], undefined);
export const useWishlist = () => useLiveQuery(async () => (await db.wishlist.toArray()).filter((w) => live(w) && !w.purchasedAt), [], undefined);
export const useHealth = (plantId?: string) => useLiveQuery(async () => (plantId ? (await db.health.where("plantId").equals(plantId).toArray()) : await db.health.toArray()).filter(live), [plantId], undefined);
export const useReminders = (plantId?: string) => useLiveQuery(async () => (plantId ? await db.reminders.where("plantId").equals(plantId).toArray() : await db.reminders.toArray()).filter(live), [plantId], undefined);
export const useProfile = () => useLiveQuery(async () => (await db.profile.get("me")) ?? null, [], undefined);

export const speciesOf = (p: Pick<Plant, "speciesId">): Species | undefined => speciesById(p.speciesId);

// ---------- Profile / onboarding ----------
export const DEFAULT_PROFILE: Profile = {
  id: "me", createdAt: nowIso(), pets: [], interests: [], places: [], help: {
    soil: true, fertilize: true, rooting: true, seedlings: true, repot: true, health: true, seasonal: true,
  }, onboardingStep: 1, onboardingDone: false, country: "ישראל", theme: "system",
};
export async function saveProfile(patch: Partial<Profile>) {
  const cur = await db.profile.get("me");
  const base = cur ? {} : { ...DEFAULT_PROFILE, createdAt: nowIso() };
  return mutate<Profile>("profile", "me", { ...base, ...patch });
}

// ---------- Events ----------
export async function recordEvent(plantId: string, type: EventType, payload: Record<string, unknown> = {}, opts: { occurredAt?: string; inJournal?: boolean; precision?: PlantEvent["precision"] } = {}) {
  const id = crypto.randomUUID();
  const journalTypes: EventType[] = ["note", "milestone", "photo_added", "germination_update", "propagation_started"];
  return mutate<PlantEvent>("event", id, {
    id, plantId, type, payload, createdAt: nowIso(), occurredAt: opts.occurredAt ?? nowIso(), precision: opts.precision ?? "exact",
    source: "user", inJournal: opts.inJournal ?? journalTypes.includes(type), inHistory: type !== "note",
  });
}

/** Soil-check flow: only a confirmed "watered" creates a watering event. */
export async function recordSoilCheck(plantId: string, result: "dry" | "slightly_moist" | "very_moist", watered: boolean) {
  await recordEvent(plantId, "soil_check", { result, watered });
  if (result === "dry" && watered) await recordEvent(plantId, "watering", { via: "soil_check" });
}

export async function postpone(plantId: string, task: string, days: number) {
  const until = new Date(Date.now() + days * 86_400_000);
  until.setHours(8, 0, 0, 0);
  return recordEvent(plantId, "task_postponed", { task, until: until.toISOString(), days });
}

// ---------- Plants ----------
export interface NewPlantInput {
  species: Species | null;
  customName?: { he: string; scientific?: string };
  /** Catalog species (public/catalog) when the plant is not one of the curated species. */
  catalogId?: string | null;
  status: Status;
  nickname?: string;
  locationId?: string | null;
  acquiredAt?: string | null;
  potDiameterCm?: number | null;
  potMaterial?: string | null;
  drainage?: boolean | null;
  substrate?: string | null;
  note?: string | null;
  sowDate?: string | null;
  seedCount?: number | null;
  germinatedCount?: number | null;
  sowingType?: Plant["sowingType"];
  propagationMethod?: string | null;
  propagationStart?: string | null;
  rootState?: Plant["rootState"];
  cuttingCount?: number | null;
  lastWateredAt?: string | null;
}

export async function createPlant(input: NewPlantInput): Promise<Plant> {
  const all = await db.plants.toArray(); // includes deleted: ordinals are never reused
  const speciesKey = input.species?.id ?? input.catalogId ?? input.customName?.scientific ?? input.customName?.he ?? "unknown";
  const id = crypto.randomUUID();
  const plant = await mutate<Plant>("plant", id, {
    id, createdAt: nowIso(),
    speciesId: input.species?.id ?? input.catalogId ?? null,
    scientificName: input.species?.scientific ?? input.customName?.scientific ?? "",
    commonName: input.species?.he ?? input.customName?.he ?? "צמח",
    ordinal: nextOrdinal(all.map((p) => ({ ...p, speciesId: p.speciesId ?? p.scientificName ?? p.commonName })), speciesKey),
    nickname: input.nickname?.trim() || null, status: input.status, locationId: input.locationId ?? null,
    acquiredAt: input.acquiredAt ?? null, acquiredPrecision: input.acquiredAt ? "day" : "unknown",
    potDiameterCm: input.potDiameterCm ?? null, potMaterial: input.potMaterial ?? null, drainage: input.drainage ?? null,
    substrate: input.substrate ?? null, note: input.note ?? null, sowDate: input.sowDate ?? null, seedCount: input.seedCount ?? null,
    germinatedCount: input.germinatedCount ?? null, sowingType: input.sowingType ?? null, propagationMethod: input.propagationMethod ?? null,
    propagationStart: input.propagationStart ?? null, rootState: input.rootState ?? null, cuttingCount: input.cuttingCount ?? null,
    favorite: false, mainPhotoId: null, archivedAt: null,
  });
  await recordEvent(id, "plant_created", { status: input.status }, { inJournal: false });
  if (input.status === "seedling" && input.sowDate) await recordEvent(id, "sowing", { seedCount: input.seedCount ?? null, sowingType: input.sowingType ?? null }, { occurredAt: new Date(input.sowDate).toISOString(), precision: "day", inJournal: true });
  if (input.status === "rooting") await recordEvent(id, "propagation_started", { method: input.propagationMethod ?? null, count: input.cuttingCount ?? null, rootState: input.rootState ?? "none" }, { occurredAt: input.propagationStart ? new Date(input.propagationStart).toISOString() : nowIso(), precision: "day" });
  if (input.lastWateredAt) await recordEvent(id, "watering", { via: "add_plant" }, { occurredAt: new Date(input.lastWateredAt).toISOString(), precision: "day" });
  return plant;
}

export async function updatePlant(p: Plant, patch: Partial<Plant>) {
  const tracked: [keyof Plant, EventType][] = [["potDiameterCm", "pot_changed"], ["substrate", "substrate_changed"], ["locationId", "location_changed"], ["status", "status_changed"]];
  await mutate<Plant>("plant", p.id, patch);
  for (const [field, type] of tracked) {
    if (field in patch && patch[field] !== p[field]) await recordEvent(p.id, type, { from: p[field] ?? null, to: patch[field] ?? null });
  }
}

export const setStatus = (p: Plant, status: Status) => updatePlant(p, { status });
export const moveTo = (p: Plant, locationId: string | null) => updatePlant(p, { locationId });
export const toggleFavorite = (p: Plant) => mutate<Plant>("plant", p.id, { favorite: !p.favorite });
export const archivePlant = (p: Plant) => mutate<Plant>("plant", p.id, { archivedAt: p.archivedAt ? null : nowIso() });
/** Soft delete into the 30-day trash; purge is a later server job. */
export const deletePlant = (p: Plant) => mutate<Plant>("plant", p.id, { deletedAt: nowIso() });

// ---------- Locations & light ----------
export async function createLocation(input: Partial<Location> & { name: string }) {
  const id = crypto.randomUUID();
  return mutate<Location>("location", id, { kind: "indoor", ...input, id, createdAt: nowIso() });
}
export const updateLocation = (id: string, patch: Partial<Location>) => mutate<Location>("location", id, patch);

const RANK: LightCat[] = ["low", "medium", "bright_indirect", "direct"];
export const usePlantLights = (plantId?: string) =>
  useLiveQuery(async () => (plantId ? (await db.lights.toArray()).filter((r) => live(r) && r.plantId === plantId) : []), [plantId], undefined);

/**
 * Saves ONE light observation (the single record of it), linked to a plant and/or a location. When it has a
 * location, that location's light profile is recomputed as the median of all its observations — never one
 * fixed value. Estimates stay marked as estimates (`estimate: true`, method).
 */
export async function addLightReading(r: Omit<LightReading, "id" | "createdAt" | "measuredAt"> & { measuredAt?: string }) {
  if (!r.plantId && !r.locationId) throw new Error("light_needs_target");
  const id = crypto.randomUUID();
  await mutate<LightReading>("light", id, { ...r, id, measuredAt: r.measuredAt ?? nowIso(), createdAt: nowIso() });
  if (r.locationId) {
    const all = (await db.lights.where("locationId").equals(r.locationId).toArray()).filter(live);
    const ranks = all.map((x) => RANK.indexOf(x.category)).filter((x) => x >= 0).sort((a, b) => a - b);
    const median = ranks[Math.floor((ranks.length - 1) / 2)];
    await updateLocation(r.locationId, { lightCategory: RANK[median] });
  }
  return id;
}

export function timeOfDayNow(d = new Date()): "morning" | "noon" | "afternoon" {
  const h = d.getHours();
  return h < 11 ? "morning" : h < 15 ? "noon" : "afternoon";
}

// ---------- Wishlist ----------
export async function addToWishlist(speciesId: string, note?: string) {
  const existing = (await db.wishlist.toArray()).find((w) => w.speciesId === speciesId && !w.deletedAt && !w.purchasedAt);
  if (existing) return existing;
  const id = crypto.randomUUID();
  return mutate<WishlistItem>("wishlist", id, { id, speciesId, note: note ?? null, createdAt: nowIso() });
}
export const removeFromWishlist = (w: WishlistItem) => mutate<WishlistItem>("wishlist", w.id, { deletedAt: nowIso() });
export const markPurchased = (w: WishlistItem, plantId: string) => mutate<WishlistItem>("wishlist", w.id, { purchasedAt: nowIso(), plantId });

// ---------- Health ----------
export async function openHealthCase(plantId: string, c: Pick<HealthCase, "title" | "source"> & Partial<HealthCase>) {
  const id = crypto.randomUUID();
  await mutate<HealthCase>("health", id, { state: "active", ...c, id, plantId, openedAt: nowIso(), createdAt: nowIso() });
  await recordEvent(plantId, "diagnosis", { title: c.title, source: c.source, likelyCause: c.likelyCause ?? null, confidence: c.confidence ?? null });
}
export async function resolveHealthCase(h: HealthCase) {
  await mutate<HealthCase>("health", h.id, { state: "resolved", resolvedAt: nowIso() });
  await recordEvent(h.plantId, "treatment_ended", { title: h.title });
}

// ---------- Reminders ----------
export async function addReminder(plantId: string, r: Pick<Reminder, "kind" | "text"> & { everyDays?: number | null; firstInDays?: number; important?: boolean }) {
  const id = crypto.randomUUID();
  const next = new Date(Date.now() + (r.firstInDays ?? r.everyDays ?? 7) * 86_400_000);
  next.setHours(8, 0, 0, 0);
  return mutate<Reminder>("reminder", id, { id, plantId, kind: r.kind, text: r.text, everyDays: r.everyDays ?? null, nextAt: next.toISOString(), active: true, important: r.important ?? false, createdAt: nowIso() });
}
export async function completeReminder(r: Reminder) {
  await recordEvent(r.plantId, "reminder_done", { text: r.text, kind: r.kind });
  if (r.everyDays) {
    const next = new Date(Date.now() + r.everyDays * 86_400_000);
    next.setHours(8, 0, 0, 0);
    await mutate<Reminder>("reminder", r.id, { nextAt: next.toISOString() });
  } else await mutate<Reminder>("reminder", r.id, { active: false });
}
