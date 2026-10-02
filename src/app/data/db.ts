import Dexie, { type Table } from "dexie";
import type { Entity, HealthCase, LightReading, Location, Photo, Plant, PlantEvent, Profile, Reminder, WishlistItem } from "../../shared/types.ts";

// IndexedDB = the offline local copy + the pending-change queue (outbox).
// D1 is the durable source of truth (ARCHITECTURE §10). Outbox entries are only removed
// after the server acknowledges them, so they survive closing the app and auth expiry.

export interface OutboxEntry {
  seq?: number;
  mutationId: string;
  entity: Entity;
  recordId: string;
  patch: Record<string, unknown>;
  baseRev: number;
  clientTime: string;
  deviceId: string;
  state: "pending" | "rejected";
  error?: string;
}

export interface BlobEntry { key: string; blob: Blob; createdAt: number }
export interface MetaEntry { key: string; value: unknown }

class LeaflingDB extends Dexie {
  plants!: Table<Plant, string>;
  events!: Table<PlantEvent, string>;
  locations!: Table<Location, string>;
  lights!: Table<LightReading, string>;
  photos!: Table<Photo, string>;
  wishlist!: Table<WishlistItem, string>;
  health!: Table<HealthCase, string>;
  reminders!: Table<Reminder, string>;
  profile!: Table<Profile, string>;
  outbox!: Table<OutboxEntry, number>;
  blobs!: Table<BlobEntry, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("leafling");
    this.version(1).stores({
      plants: "id, status, locationId, speciesId, createdAt",
      events: "id, plantId, type, occurredAt",
      locations: "id",
      lights: "id, locationId",
      photos: "id, plantId, createdAt, uploadState",
      wishlist: "id, speciesId",
      health: "id, plantId, state",
      reminders: "id, plantId",
      profile: "id",
      outbox: "++seq, mutationId, entity, recordId, state",
      blobs: "key",
      meta: "key",
    });
  }
}

export const db = new LeaflingDB();

export const TABLE_OF: Record<Entity, Table<any, string>> = {
  plant: db.plants, event: db.events, location: db.locations, light: db.lights, photo: db.photos,
  wishlist: db.wishlist, health: db.health, profile: db.profile, reminder: db.reminders,
};

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deviceId(): Promise<string> {
  let id = await getMeta<string>("deviceId");
  if (!id) { id = crypto.randomUUID(); await setMeta("deviceId", id); }
  return id;
}
