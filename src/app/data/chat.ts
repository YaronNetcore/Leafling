import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import type { Chat, ChatMessage } from "../../shared/types.ts";
import { db } from "./db.ts";
import { prepareForUpload } from "./images.ts";
import { AuthRequired, api, sync } from "./sync.ts";

// AI Botanist chat on the device.
// - History = the user's own "chat"/"message" records, written by the server and synced into this user's
//   IndexedDB (readable offline, never shared with another user on the device).
// - Sending streams the answer (SSE over the authenticated fetch) into an in-memory "pending" entry per
//   conversation. It lives at module level, so moving around the app does not cancel an answer; when the
//   server has stored the answer, the next sync brings the real record and the pending entry is dropped.
// - One message id per message: retries reuse it, so the server answers it at most once.

export interface Pending {
  chatId: string;
  plantId: string | null;
  messageId: string;
  text: string;
  images: string[];
  previews: string[];
  phase: "preparing" | "waiting" | "streaming" | "stopping" | "error" | "done";
  answer: string;
  status?: "complete" | "partial";
  error?: string;
  at: string;
}

export interface ChatTiming { prepMs: number; firstByteMs: number | null; firstTextMs: number | null; totalMs: number; server?: Record<string, number>; images: number }
/** Content-free timings of recent sends on this device (used for performance checks). */
export const chatTimings: ChatTiming[] = [];
(globalThis as { __leaflingChatTimings?: ChatTiming[] }).__leaflingChatTimings = chatTimings;

const pending = new Map<string, Pending>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (chatId: string, p: Pending | null) => { if (p) pending.set(chatId, { ...p }); else pending.delete(chatId); emit(); };

export function usePending(chatId: string | null): Pending | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => (chatId ? pending.get(chatId) ?? null : null));
}

/** The ongoing conversation for a plant (or the general one): the most recently used, not deleted. */
export const useLatestChat = (plantId: string | null) =>
  useLiveQuery(async () => (await db.chats.toArray()).filter((c) => !c.deletedAt && (c.plantId ?? null) === plantId).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0] ?? null, [plantId], undefined as Chat | null | undefined);

export const useChatMessages = (chatId: string | null) =>
  useLiveQuery(async () => (chatId ? (await db.messages.where("chatId").equals(chatId).toArray()).filter((m) => !m.deletedAt)
    .sort((a, b) => a.at.localeCompare(b.at) || (a.role === b.role ? 0 : a.role === "user" ? -1 : 1)) : []), [chatId], undefined as ChatMessage[] | undefined);

export const attachmentUrl = (messageId: string, n: number) => `/api/v1/chat/attachments/${messageId}/${n}`;

/** Sends a new message (files are downsized EXIF-free copies; originals untouched). */
export async function sendMessage(o: { chatId: string; plantId: string | null; text: string; files: File[] }) {
  const cur = pending.get(o.chatId);
  if (cur && ["preparing", "waiting", "streaming", "stopping"].includes(cur.phase)) return; // one at a time per chat
  if (cur) cur.previews.forEach((u) => URL.revokeObjectURL(u));
  const p: Pending = {
    chatId: o.chatId, plantId: o.plantId, messageId: crypto.randomUUID(), text: o.text.trim(), images: [],
    previews: o.files.map((f) => URL.createObjectURL(f)), phase: "preparing", answer: "", at: new Date().toISOString(),
  };
  set(o.chatId, p);
  const t0 = performance.now();
  try { p.images = o.files.length ? await prepareForUpload(o.files) : []; }
  catch { set(o.chatId, { ...p, phase: "error", error: "image_unreadable" }); return; }
  await run(p, performance.now() - t0);
}

/** Sends the same message again (same id → the server never answers it twice). */
export async function retry(chatId: string) {
  const p = pending.get(chatId);
  if (!p || !["error", "done"].includes(p.phase)) return;
  await run({ ...p, phase: "waiting", answer: "", error: undefined, status: undefined }, 0);
}

/** Stops the answer being written: the server keeps what was written so far, marked as interrupted. */
export async function stop(chatId: string) {
  const p = pending.get(chatId);
  if (!p || !["waiting", "streaming"].includes(p.phase)) return;
  set(chatId, { ...p, phase: "stopping" });
  try { await api("/api/v1/chat/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: p.messageId }) }); } catch { /* aborted below */ }
  // If the stream does not end on its own shortly, stop reading it (the server still stores the partial text).
  setTimeout(() => controllers.get(chatId)?.abort(), 4000);
}

/** Drops a finished pending entry once its stored records are on the device. */
export function settle(chatId: string, stored: ChatMessage[]) {
  const p = pending.get(chatId);
  if (!p || p.phase !== "done") return;
  if (stored.some((m) => m.id === `${p.messageId}-a`) && stored.some((m) => m.id === p.messageId)) {
    p.previews.forEach((u) => URL.revokeObjectURL(u));
    set(chatId, null);
  }
}

export function discard(chatId: string) {
  const p = pending.get(chatId);
  if (p && ["error", "done"].includes(p.phase)) { p.previews.forEach((u) => URL.revokeObjectURL(u)); set(chatId, null); }
}

async function run(p: Pending, prepMs: number) {
  if (!navigator.onLine) { set(p.chatId, { ...p, phase: "error", error: "offline" }); return; }
  const ac = new AbortController();
  controllers.set(p.chatId, ac);
  const t0 = performance.now();
  const timing: ChatTiming = { prepMs: Math.round(prepMs), firstByteMs: null, firstTextMs: null, totalMs: 0, images: p.images.length };
  let cur: Pending = { ...p, phase: "waiting" };
  set(p.chatId, cur);
  try {
    const res = await api("/api/v1/chat", {
      method: "POST", signal: ac.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: p.chatId, messageId: p.messageId, plantId: p.plantId, text: p.text, images: p.images }),
    });
    timing.firstByteMs = Math.round(performance.now() - t0);
    if (!res.ok || !res.body) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `http_${res.status}`;
      if (code === "in_progress") { // the same message is already being answered (e.g. another tab): wait for it
        set(p.chatId, { ...cur, phase: "done" });
        setTimeout(() => void sync(), 2500);
        return;
      }
      set(p.chatId, { ...cur, phase: "error", error: code });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const raw = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !raw) continue;
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (event === "delta") {
          if (timing.firstTextMs == null) timing.firstTextMs = Math.round(performance.now() - t0);
          cur = { ...cur, phase: pending.get(p.chatId)?.phase === "stopping" ? "stopping" : "streaming", answer: cur.answer + String(data.t ?? "") };
          set(p.chatId, cur);
        } else if (event === "done") {
          finished = true;
          timing.server = data.timings as Record<string, number> | undefined;
          cur = { ...cur, phase: "done", status: (data.status as "complete" | "partial") ?? "complete" };
          set(p.chatId, cur);
        } else if (event === "error") {
          finished = true;
          cur = { ...cur, phase: "error", error: String(data.code ?? "ai_request_failed") };
          set(p.chatId, cur);
        }
      }
    }
    if (!finished) set(p.chatId, { ...cur, phase: cur.answer ? "done" : "error", status: "partial", error: cur.answer ? undefined : "ai_request_failed" });
  } catch (e) {
    if (ac.signal.aborted) set(p.chatId, { ...cur, phase: "done", status: "partial" });
    else set(p.chatId, { ...cur, phase: "error", error: e instanceof AuthRequired ? "needs_login" : navigator.onLine ? "ai_request_failed" : "offline" });
  } finally {
    controllers.delete(p.chatId);
    timing.totalMs = Math.round(performance.now() - t0);
    chatTimings.push(timing);
    if (chatTimings.length > 20) chatTimings.shift();
    void sync(); // bring the stored user message + answer to this device
    setTimeout(() => void sync(), 1500); // (a sync already running when the answer ended may have missed it)
  }
}
