import type { Entity, MutationResult, PulledRecord } from "../../shared/types.ts";
import { currentUserId, db, deviceId, getMeta, recordTables, setMeta, tableOf, type OutboxEntry } from "./db.ts";

// Local-first writes + sync engine.
// - mutate(): writes the local record AND its outbox entry in one IndexedDB transaction.
// - sync(): pushes the outbox in small batches (idempotent), then pulls server changes.
// - Auth expiry (Access redirect / 401) pauses sync without dropping anything.
// - iOS has no background sync: sync runs on open, on focus/visibility, when online, and periodically.

export type SyncState = { status: "idle" | "syncing" | "offline" | "needs-login" | "error"; pending: number; lastSyncAt?: number; message?: string };
type Listener = (s: SyncState) => void;
const listeners = new Set<Listener>();
let state: SyncState = { status: "idle", pending: 0 };
function emit(patch: Partial<SyncState>) { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); }
export function onSync(l: Listener) { listeners.add(l); l(state); return () => { listeners.delete(l); }; }
export const getSyncState = () => state;

export class AuthRequired extends Error {}
export class UserChanged extends Error {}

/**
 * Every API call carries X-Leafling-User = the owner of the local database that is open. The server
 * compares it with the verified Access identity and answers 409 user_mismatch if they differ (the
 * Access session now belongs to someone else). We then stop immediately — nothing of this user is
 * sent — and restart at "/", which re-boots with the new identity and that user's own local database.
 */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (currentUserId) headers.set("x-leafling-user", currentUserId);
  const res = await fetch(path, { ...init, headers, redirect: "manual", credentials: "same-origin", cache: "no-store" });
  if (res.type === "opaqueredirect" || res.status === 0 || res.status === 401) {
    emit({ status: "needs-login" });
    throw new AuthRequired();
  }
  if (res.status === 409 && (await res.clone().json().catch(() => ({})) as { error?: string }).error === "user_mismatch") {
    emit({ status: "needs-login", message: "user_changed" });
    setTimeout(() => location.replace("/"), 50);
    throw new UserChanged();
  }
  return res;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `http_${res.status}`), { status: res.status });
  return body as T;
}

async function refreshPending() {
  emit({ pending: await db.outbox.where("state").equals("pending").count() });
}

/** Local-first write: record + outbox entry atomically. Returns the merged record. */
export async function mutate<T extends { id: string }>(entity: Entity, id: string, patch: Partial<T>): Promise<T> {
  const table = tableOf(entity);
  const dev = await deviceId();
  const now = new Date().toISOString();
  let merged!: T;
  await db.transaction("rw", table, db.outbox, async () => {
    const cur = (await table.get(id)) as (T & { _rev?: number }) | undefined;
    merged = { ...(cur ?? {}), ...patch, id, updatedAt: now } as unknown as T;
    await table.put(merged);
    const entry: OutboxEntry = {
      mutationId: crypto.randomUUID(), entity, recordId: id,
      patch: { ...patch, updatedAt: now } as Record<string, unknown>,
      baseRev: cur?._rev ?? 0, clientTime: now, deviceId: dev, state: "pending",
    };
    await db.outbox.add(entry);
  });
  await refreshPending();
  scheduleSync();
  return merged;
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delay = 400) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void sync(); }, delay);
}

let running = false;
const BATCH = 8;

export async function sync(): Promise<void> {
  if (running) return;
  if (!navigator.onLine) { emit({ status: "offline" }); await refreshPending(); return; }
  running = true;
  emit({ status: "syncing" });
  try {
    for (let guard = 0; guard < 200; guard++) {
      const batch = (await db.outbox.where("state").equals("pending").sortBy("seq")).slice(0, BATCH);
      if (!batch.length) break;
      const res = await api("/api/v1/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mutations: batch.map(({ mutationId, entity, recordId, patch, baseRev, clientTime, deviceId }) => ({ mutationId, entity, recordId, patch, baseRev, clientTime, deviceId })) }),
      });
      if (res.status === 409) continue; // concurrent write: retry with fresh state
      if (res.status === 400 || res.status === 413) {
        const err = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "rejected";
        // Never drop data: mark as rejected and keep it visible for review.
        await db.outbox.bulkPut(batch.map((b) => ({ ...b, state: "rejected" as const, error: err })));
        continue;
      }
      if (!res.ok) throw new Error(`push_${res.status}`);
      const { results } = (await res.json()) as { results: MutationResult[] };
      await db.transaction("rw", [db.outbox, ...recordTables()], async () => {
        const acked = new Set(results.map((r) => r.mutationId));
        const all = await db.outbox.toArray();
        for (const b of batch) if (acked.has(b.mutationId)) await db.outbox.delete(b.seq!);
        for (const r of results) {
          if (r.appliedRev == null) continue;
          // Rebase still-queued edits of the same record that were based on the same revision.
          for (const o of all) {
            if (!acked.has(o.mutationId) && o.state === "pending" && o.entity === r.entity && o.recordId === r.recordId && o.baseRev === r.baseRev) {
              await db.outbox.update(o.seq!, { baseRev: r.appliedRev });
            }
          }
          const table = tableOf(r.entity);
          const cur = await table.get(r.recordId);
          if (cur && (cur._rev ?? 0) < r.appliedRev) await table.update(r.recordId, { _rev: r.appliedRev });
        }
      });
    }
    await pullAll();
    emit({ status: "idle", lastSyncAt: Date.now(), message: undefined });
    await setMeta("lastSyncAt", Date.now());
  } catch (e) {
    if (e instanceof AuthRequired || e instanceof UserChanged) { /* state already "needs-login"; outbox untouched */ }
    else if (!navigator.onLine) emit({ status: "offline" });
    else emit({ status: "error", message: (e as Error).message });
  } finally {
    running = false;
    await refreshPending();
  }
}

async function pullAll() {
  let since = (await getMeta<number>("pullSince")) ?? 0;
  for (let guard = 0; guard < 100; guard++) {
    const res = await api(`/api/v1/sync/pull?since=${since}`);
    if (!res.ok) throw new Error(`pull_${res.status}`);
    const { records, more, until } = (await res.json()) as { records: PulledRecord[]; more: boolean; until: number };
    if (records.length) await applyPulled(records);
    since = until;
    await setMeta("pullSince", since);
    if (!more) break;
  }
}

async function applyPulled(records: PulledRecord[]) {
  await db.transaction("rw", [db.outbox, ...recordTables()], async () => {
    const pending = await db.outbox.where("state").equals("pending").toArray();
    for (const r of records) {
      const table = tableOf(r.entity);
      if (!table) continue;
      const cur = await table.get(r.id);
      if (cur && (cur._rev ?? 0) >= r.rev) continue;
      // Server state + still-pending local patches re-applied on top (local view stays consistent).
      const local = pending.filter((p) => p.entity === r.entity && p.recordId === r.id).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      let merged: Record<string, unknown> = { ...r.data, id: r.id, _rev: r.rev };
      for (const p of local) merged = { ...merged, ...p.patch };
      await table.put(merged);
    }
  });
}

export async function resyncFromServer() {
  await sync();
  await setMeta("pullSince", 0);
  await sync();
}

export function startSyncLoop() {
  void sync();
  window.addEventListener("online", () => void sync());
  window.addEventListener("offline", () => emit({ status: "offline" }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void sync(); });
  setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 30_000);
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);
}
