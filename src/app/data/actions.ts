import type { ActionProposal } from "../../shared/actions.ts";
import { api, sync } from "./sync.ts";

// Confirming / cancelling an AI Botanist action card. The server saves in small atomic chunks; this loops until
// every confirmed plant has a result, reporting progress. Repeating a call is safe (deterministic ids server-side).

export interface ExecResult { status: string; results: Record<string, "saved" | "skipped" | "failed">; failures: { plantId: string; name: string; reason: string }[]; remaining: number; message: string | null }

async function call(body: Record<string, unknown>): Promise<ExecResult> {
  const res = await api("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as ExecResult & { error?: string };
  if (!res.ok) throw Object.assign(new Error(j.error ?? `http_${res.status}`), { code: j.error ?? `http_${res.status}` });
  return j;
}

/** First call confirms the selection; later calls (or a retry after an interruption) continue the same card. */
export async function confirmProposal(p: ActionProposal, plantIds: string[] | null, followUp: boolean, onProgress: (done: number, total: number) => void): Promise<ExecResult> {
  const total = plantIds?.length ?? p.confirmedIds?.length ?? 0;
  let r = await call(plantIds ? { messageId: p.id, revision: p.revision, plantIds, followUp } : { messageId: p.id, revision: p.revision });
  for (let i = 0; r.remaining > 0 && i < 100; i++) {
    onProgress(Object.keys(r.results).length, total);
    r = await call({ messageId: p.id, revision: p.revision });
  }
  onProgress(total, total);
  void sync();
  setTimeout(() => void sync(), 1200);
  return r;
}

export async function cancelProposal(p: ActionProposal): Promise<void> {
  const res = await api("/api/v1/actions/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: p.id }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `http_${res.status}`);
  void sync();
}

/** Asks the server for an UNDO card of a committed card (it appears in the same chat; nothing changes before confirming). */
export async function requestUndo(p: ActionProposal): Promise<string> {
  const res = await api("/api/v1/actions/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: p.id, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  const j = (await res.json().catch(() => ({}))) as { messageId?: string; error?: string };
  if (!res.ok) throw new Error(j.error ?? `http_${res.status}`);
  void sync();
  setTimeout(() => void sync(), 1200);
  return j.messageId!;
}
