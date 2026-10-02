import Dexie, { type Table } from "dexie";
import type { Chat, ChatMessage, Entity, HealthCase, LightReading, Location, Photo, Plant, PlantEvent, Profile, Reminder, WishlistItem } from "../../shared/types.ts";

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

export const STORES = {
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
};
/** v2 (2026-10): AI Botanist conversations and their messages (server-written, synced like other records). */
export const STORES_V2 = { ...STORES, chats: "id, plantId, lastMessageAt", messages: "id, chatId, at" };

export class LeaflingDB extends Dexie {
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
  chats!: Table<Chat, string>;
  messages!: Table<ChatMessage, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores(STORES);
    // Additive. Older app versions skipped chat records during pulls (unknown entity) and moved the cursor
    // past them, so the cursor is reset once to fetch everything again (records are merged by revision).
    this.version(2).stores(STORES_V2).upgrade((tx) => tx.table("meta").delete("pullSince"));
  }
}

// ISOLATION: one IndexedDB database PER SIGNED-IN USER ("leafling-u-<internal user id>"), holding that
// user's records, outbox (pending changes), conflicts view, photo blobs and sync cursor. Nothing is
// shared between users on the same device. The id comes from the server (/api/v1/me, derived from the
// verified Access identity). `db` is a live binding: it is set once at boot (see identity.ts) and a
// change of user always reloads the page, so no in-memory state of one user survives into another.
// The pre-multi-user database "leafling" is only ever imported by the claimed legacy owner.
export const LEGACY_DB_NAME = "leafling";
export const userDbName = (userId: string) => `leafling-u-${userId}`;

export let db: LeaflingDB = null as unknown as LeaflingDB;
export let currentUserId: string | null = null;

export function openUserDb(userId: string): LeaflingDB {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error("bad_user_id");
  if (currentUserId && currentUserId !== userId) throw new Error("user_already_open"); // switching = reload
  if (!currentUserId) { db = new LeaflingDB(userDbName(userId)); currentUserId = userId; }
  return db;
}

export function tableOf(entity: Entity): Table<any, string> {
  return ({
    plant: db.plants, event: db.events, location: db.locations, light: db.lights, photo: db.photos,
    wishlist: db.wishlist, health: db.health, profile: db.profile, reminder: db.reminders, chat: db.chats, message: db.messages,
  } as Record<Entity, Table<any, string>>)[entity];
}
export const recordTables = () => [db.plants, db.events, db.locations, db.lights, db.photos, db.wishlist, db.health, db.profile, db.reminders, db.chats, db.messages];

/**
 * One-time device migration for the legacy owner only: copies the pre-multi-user local database
 * (including its pending outbox and unsent photos) into the owner's own database in one
 * transaction, then removes the legacy database. Never runs for any other user.
 */
export async function importLegacyLocalDb(target: LeaflingDB): Promise<boolean> {
  if (await target.meta.get("legacyImported")) return false;
  const names = await Dexie.getDatabaseNames().catch(() => [] as string[]);
  if (!names.includes(LEGACY_DB_NAME)) { await target.meta.put({ key: "legacyImported", value: "none" }); return false; }
  const legacy = new LeaflingDB(LEGACY_DB_NAME);
  try {
    await legacy.open();
    const tables = Object.keys(STORES) as (keyof typeof STORES)[]; // the legacy database predates chats
    const dump = await Promise.all(tables.map((t) => legacy.table(t).toArray()));
    await target.transaction("rw", tables.map((t) => target.table(t)), async () => {
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i];
        if (t === "outbox") for (const o of dump[i] as OutboxEntry[]) { const { seq: _s, ...rest } = o; await target.outbox.add(rest); }
        else await target.table(t).bulkPut(dump[i]);
      }
      await target.meta.put({ key: "legacyImported", value: new Date().toISOString() });
    });
  } finally {
    legacy.close();
  }
  await Dexie.delete(LEGACY_DB_NAME).catch(() => undefined);
  return true;
}

/** Remove this user's local copy from the device (server data is untouched). */
export async function deleteLocalUserDb(userId: string): Promise<void> {
  if (currentUserId === userId) db.close();
  await Dexie.delete(userDbName(userId));
}

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
