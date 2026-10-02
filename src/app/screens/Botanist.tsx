import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { displayName } from "../../shared/domain.ts";
import type { ChatMessage } from "../../shared/types.ts";
import { aiErrorText } from "../data/ai.ts";
import { attachmentUrl, discard, retry, sendMessage, settle, stop, useChatMessages, useLatestChat, usePending, type Pending } from "../data/chat.ts";
import { MAX_IMAGES, checkFile } from "../data/images.ts";
import { speciesOf, usePlant, usePlants } from "../data/store.ts";
import { Icon } from "../ui/icons.tsx";
import { IconButton, PlantImage, Sheet, StatusBadge, cx, useToast } from "../ui/ui.tsx";

// AI Botanist — a real conversation (messaging-app layout): compact header with the plant, the thread as the
// main content, a persistent composer at the bottom. History is stored per user and per plant (see data/chat.ts).

const SUGGESTIONS = ["איך יודעים מתי להשקות אותו?", "למה העלים מצהיבים?", "איך מרבים אותו?"];

/** Height of the visible area (shrinks when the iPhone keyboard opens), so the composer stays visible. */
function useViewportHeight() {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setH(Math.round(vv.height));
    on();
    vv.addEventListener("resize", on);
    return () => vv.removeEventListener("resize", on);
  }, []);
  return h;
}

function Bubble({ role, children, className, testid }: { role: "user" | "assistant"; children: React.ReactNode; className?: string; testid?: string }) {
  return (
    <div data-testid={testid} data-role={role} className={cx("max-w-[85%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[16px] leading-relaxed",
      role === "user" ? "ms-auto rounded-ee-md bg-green text-on-green" : "me-auto rounded-es-md bg-surface text-ink shadow-soft", className)}>
      {children}
    </div>
  );
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-2 text-muted" role="status">
      חושב…
      <span className="inline-flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
    </span>
  );
}

function UserMessage({ m }: { m: ChatMessage }) {
  return (
    <div className="space-y-1">
      {!!m.attachments && <div className="ms-auto flex max-w-[85%] flex-wrap justify-end gap-1.5">{Array.from({ length: m.attachments }, (_, i) => <img key={i} src={attachmentUrl(m.id, i)} alt="" className="size-24 rounded-2xl object-cover" />)}</div>}
      {m.text && <Bubble role="user" testid="msg-user">{m.text}</Bubble>}
    </div>
  );
}

export function Botanist() {
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const plantId = params.get("plant") || null;
  const plant = usePlant(plantId ?? undefined);
  const plants = (usePlants() ?? []).filter((p) => !p.archivedAt);
  const latest = useLatestChat(plantId);
  const [fresh, setFresh] = useState<{ plantId: string | null; id: string } | null>(null);
  useEffect(() => { setFresh(null); }, [plantId]);
  useEffect(() => { if (latest === null && (!fresh || fresh.plantId !== plantId)) setFresh({ plantId, id: crypto.randomUUID() }); }, [latest, plantId, fresh]);
  // Live queries briefly return the previous result after the plant changes: only accept a matching chat.
  const latestHere = latest && (latest.plantId ?? null) === plantId ? latest : null;
  const chatId = fresh?.plantId === plantId ? fresh.id : latestHere?.id ?? null;
  const stored = (useChatMessages(chatId) ?? []).filter((m) => m.chatId === chatId);
  const p = usePending(chatId);
  useEffect(() => { if (chatId) settle(chatId, stored); }, [chatId, stored, p?.phase]);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const vh = useViewportHeight();
  const active = p && ["preparing", "waiting", "streaming", "stopping"].includes(p.phase);
  const notFound = plantId && plant === undefined && plants.length > 0 && !plants.some((x) => x.id === plantId);

  // Follow the conversation while it grows — unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [stored.length, p?.answer, p?.phase, p?.messageId]);
  const onScroll = () => { const el = list.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const ok = picked.filter((f) => !checkFile(f));
    if (ok.length < picked.length) toast("אחד הקבצים אינו תמונה שאפשר לצרף");
    const room = MAX_IMAGES - files.length;
    if (ok.length > room) toast(`אפשר לצרף עד ${MAX_IMAGES} תמונות`);
    setFiles((cur) => [...cur, ...ok.slice(0, room).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const removeFile = (i: number) => setFiles((cur) => { URL.revokeObjectURL(cur[i].url); return cur.filter((_, j) => j !== i); });
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const canSend = Boolean(chatId) && !active && (text.trim().length > 0 || files.length > 0);
  const submit = (override?: string) => {
    const t = (override ?? text).trim();
    if (!chatId || active || (!t && !files.length)) return;
    if (p) discard(chatId);
    stick.current = true;
    void sendMessage({ chatId, plantId, text: t, files: files.map((f) => f.file) });
    setText("");
    setFiles([]); // previews now belong to the pending message
    input.current?.focus();
  };

  // Stored messages + the message being sent / answered (until its stored copy arrives).
  const showPendingUser = p && !stored.some((m) => m.id === p.messageId);
  const showPendingAnswer = p && !stored.some((m) => m.id === `${p.messageId}-a`);
  const lastUser = [...stored].reverse().find((m) => m.role === "user");
  const unanswered = !p && lastUser && !stored.some((m) => m.id === `${lastUser.id}-a`) && Date.now() - Date.parse(lastUser.at) > 60_000 ? lastUser : null;

  return (
    <main className="flex flex-col overflow-hidden bg-bg" style={{ height: vh ? `${vh}px` : "100dvh" }}>
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-line/70 bg-bg/95 px-3 pb-2 backdrop-blur">
        <IconButton icon="back" label="חזרה" onClick={() => (history.length > 1 ? nav(-1) : nav("/today"))} />
        <div className="flex min-w-0 flex-1 items-center gap-2.5" data-testid="chat-header">
          {plant ? <PlantImage plant={plant} species={speciesOf(plant)} className="size-10 shrink-0" rounded="rounded-full" /> : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage text-green"><Icon name="sparkles" size={20} /></span>}
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-muted">AI Botanist</div>
            <div className="flex items-center gap-2">
              <span className="truncate text-[17px] font-bold text-ink">{plant ? displayName(plant) : plantId ? "" : "שיחה כללית"}</span>
              {plant && plant.status !== "plant" && <StatusBadge status={plant.status} />}
            </div>
          </div>
        </div>
        {!plant && plants.length > 0 && <button onClick={() => setPicking(true)} className="pressable shrink-0 rounded-full bg-sage px-3 py-2 text-[14px] font-semibold text-green">בחירת צמח</button>}
        <IconButton icon="edit" label="שיחה חדשה" disabled={Boolean(active)} onClick={() => { if (chatId) discard(chatId); setFresh({ plantId, id: crypto.randomUUID() }); stick.current = true; }} />
      </header>

      <div ref={list} onScroll={onScroll} data-testid="chat-thread" className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {notFound && <p className="rounded-2xl bg-sun-bg p-3 text-[15px] text-ink">הצמח לא נמצא — אפשר לשאול שאלה כללית.</p>}
        {!stored.length && !p && (
          <div className="space-y-3">
            <Bubble role="assistant">{plant ? `היי! אני מכירה את ${displayName(plant)} ואת מה שנרשם עליו. במה אפשר לעזור?` : "היי! אפשר לשאול אותי כל דבר על צמחים. כדי שאכיר צמח מסוים — בחרי אותו למעלה."}</Bubble>
            <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <button key={s} onClick={() => submit(s)} className="pressable rounded-full border border-line bg-surface px-3 py-2 text-[14px] text-ink">{s}</button>)}</div>
          </div>
        )}
        {stored.map((m) => m.role === "user" ? <UserMessage key={m.id} m={m} /> : (
          <div key={m.id} className="space-y-1">
            <Bubble role="assistant" testid="msg-assistant">{m.text}</Bubble>
            {m.status === "partial" && <p className="me-auto px-2 text-[13px] text-muted" data-testid="msg-partial">התשובה נעצרה באמצע.</p>}
          </div>
        ))}
        {p && showPendingUser && <PendingUser p={p} />}
        {p && showPendingAnswer && <PendingAnswer p={p} onRetry={() => void retry(p.chatId)} />}
        {unanswered && (
          <div className="flex items-center gap-2 px-1 text-[14px] text-muted">
            לא התקבלה תשובה להודעה הזו.
            <button className="pressable font-semibold text-green" onClick={() => submit(unanswered.text)}>לשאול שוב</button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line/70 bg-bg px-3 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}>
        {files.length > 0 && (
          <div className="mb-2 flex gap-2" data-testid="chat-attachments">
            {files.map((f, i) => (
              <div key={f.url} className="relative">
                <img src={f.url} alt="" className="size-16 rounded-xl object-cover" />
                <button onClick={() => removeFile(i)} aria-label="הסרת תמונה" className="absolute -end-1 -top-1 grid size-6 place-items-center rounded-full bg-ink text-bg"><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button onClick={() => lib.current?.click()} aria-label="צירוף תמונה" disabled={files.length >= MAX_IMAGES} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-green disabled:opacity-40"><Icon name="image" /></button>
          <button onClick={() => cam.current?.click()} aria-label="צילום" disabled={files.length >= MAX_IMAGES} className="pressable grid size-11 shrink-0 place-items-center rounded-full text-green disabled:opacity-40"><Icon name="camera" /></button>
          <textarea ref={input} rows={1} value={text} dir="rtl" enterKeyHint="send" data-testid="chat-input"
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); submit(); } }}
            placeholder="שאלי אותי משהו על הצמח…" aria-label="הודעה"
            className="max-h-[132px] min-h-11 flex-1 resize-none rounded-3xl bg-surface px-4 py-2.5 text-[16px] text-ink shadow-soft outline-none placeholder:text-muted" />
          {active ? (
            <button onClick={() => chatId && void stop(chatId)} aria-label="עצירת התשובה" data-testid="chat-stop" disabled={p?.phase === "stopping" || p?.phase === "preparing"}
              className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-ink text-bg disabled:opacity-50"><Icon name="stop" size={18} /></button>
          ) : (
            <button onClick={() => submit()} aria-label="שליחה" data-testid="chat-send" disabled={!canSend}
              className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-green text-on-green disabled:opacity-40"><Icon name="send" size={20} /></button>
          )}
        </div>
        <input ref={lib} type="file" accept="image/*" multiple hidden data-testid="chat-input-library" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden data-testid="chat-input-camera" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      <Sheet open={picking} onClose={() => setPicking(false)} title="על איזה צמח לדבר?">
        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {plants.map((x) => (
            <button key={x.id} onClick={() => { setPicking(false); setParams({ plant: x.id }, { replace: true }); }} className="pressable flex w-full items-center gap-3 rounded-2xl bg-surface p-2 text-start shadow-soft">
              <PlantImage plant={x} species={speciesOf(x)} className="size-11" rounded="rounded-full" />
              <span className="text-[16px] font-semibold text-ink">{displayName(x)}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </main>
  );
}

function PendingUser({ p }: { p: Pending }) {
  return (
    <div className="space-y-1" data-testid="msg-pending-user">
      {p.previews.length > 0 && <div className="ms-auto flex max-w-[85%] flex-wrap justify-end gap-1.5">{p.previews.map((u) => <img key={u} src={u} alt="" className="size-24 rounded-2xl object-cover" />)}</div>}
      {p.text && <Bubble role="user" testid="msg-user">{p.text}</Bubble>}
    </div>
  );
}

function PendingAnswer({ p, onRetry }: { p: Pending; onRetry: () => void }) {
  if (p.phase === "error") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 px-1 text-[14px]" data-testid="chat-error" role="alert">
        <span className="text-heat">{aiErrorText(p.error ?? "")}</span>
        <button onClick={onRetry} className="pressable rounded-full bg-sage px-3 py-1.5 font-semibold text-green">נסי שוב</button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Bubble role="assistant" testid="msg-streaming" className={p.phase === "done" ? "" : "min-w-24"}>
        {p.answer ? <>{p.answer}{(p.phase === "streaming" || p.phase === "stopping") && <span className="ms-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" aria-hidden />}</> : <Thinking />}
      </Bubble>
      {p.phase === "done" && p.status === "partial" && <p className="me-auto px-2 text-[13px] text-muted" data-testid="msg-partial">התשובה נעצרה באמצע.</p>}
      {p.phase === "done" && p.status === "partial" && <button onClick={onRetry} className="pressable me-auto px-2 text-[14px] font-semibold text-green">להמשיך — לשאול שוב</button>}
    </div>
  );
}
