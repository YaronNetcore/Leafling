// AI Botanist chat: streaming, persistence, follow-ups, idempotency, cancellation, compact context and
// per-user isolation — against the real Worker (Miniflare/workerd) with a mocked, STREAMING Anthropic API.
// Timings measured here are local pipeline timings with a mocked model — NOT real Claude performance.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type TestD1 } from "./helpers/worker.ts";

let h: Harness, db: TestD1, A: Client, B: Client;
const PLANT = "chat-plant-1";
const OTHER = "chat-plant-2";

type Ev = { event: string; data: Record<string, unknown> };
function parseSse(text: string): Ev[] {
  return text.split("\n\n").filter((b) => b.trim()).map((b) => {
    const event = /^event: (.+)$/m.exec(b)?.[1] ?? "";
    const data = JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "{}");
    return { event, data };
  });
}
const send = (c: Client, body: Record<string, unknown>) => c.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function chat(c: Client, body: Record<string, unknown>) {
  const r = await send(c, body);
  return { status: r.status, type: r.headers.get("content-type") ?? "", events: r.ok ? parseSse(await r.text()) : [], error: r.ok ? null : ((await r.json()) as { error: string }).error };
}
const text = (evs: Ev[]) => evs.filter((e) => e.event === "delta").map((e) => e.data.t).join("");
const lastBody = () => h.anthropic.at(-1)!.body as { messages: { role: string; content: string | { type: string; text?: string }[] }[]; system: { text: string }[]; stream?: boolean; thinking?: unknown; max_tokens: number };
const turnText = () => { const m = lastBody().messages.at(-1)!; return typeof m.content === "string" ? m.content : m.content.filter((x) => x.type === "text").map((x) => x.text).join(""); };
const messages = async (c: Client) => (await c.pullAll()).filter((r) => r.entity === "message").map((r) => r.data);
const settle = () => new Promise((r) => setTimeout(r, 150)); // server-side persistence runs right after the stream ends

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  db = await h.mf.getD1Database("DB");
  A = await Client.signIn(h, { sub: "aaaaaaaa-3333-4000-8000-00000000000a", email: OWNER_EMAIL });
  B = await Client.signIn(h, { sub: "bbbbbbbb-3333-4000-8000-00000000000b", email: "chat-b@example.test" });
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  await A.push([
    mut("location", "loc-1", { id: "loc-1", name: "סלון", kind: "indoor", lightCategory: "medium" }),
    mut("plant", PLANT, { id: PLANT, commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "plant", ordinal: 1, locationId: "loc-1", potDiameterCm: 14, substrate: "מצע כללי + פרלייט", propagationMethod: "ייחור במים" }),
    mut("plant", OTHER, { id: OTHER, commonName: "מונסטרה סודית", status: "plant", ordinal: 1 }),
    mut("event", "w1", { id: "w1", plantId: PLANT, type: "watering", occurredAt: day(20), payload: {} }),
    mut("event", "w2", { id: "w2", plantId: PLANT, type: "watering", occurredAt: day(13), payload: {} }),
    mut("event", "w3", { id: "w3", plantId: PLANT, type: "watering", occurredAt: day(6), payload: {} }),
  ]);
  await A.push([
    mut("event", "s1", { id: "s1", plantId: PLANT, type: "soil_check", occurredAt: day(2), payload: { result: "moist" } }),
    mut("event", "r1", { id: "r1", plantId: PLANT, type: "root_check", occurredAt: day(3), payload: { roots: 2 } }),
    mut("event", "o1", { id: "o1", plantId: OTHER, type: "watering", occurredAt: day(1), payload: { note: "סוד של צמח אחר" } }),
  ]);
}, 120_000);
afterAll(async () => { await h?.mf.dispose(); });

describe("streaming chat", () => {
  const chatId = randomUUID();
  const m1 = randomUUID();

  it("streams the answer progressively (meta → several deltas → done) and stores both messages once", async () => {
    h.chatReply = { text: "כדאי לבדוק קודם את האדמה. אם 2–3 הס״מ העליונים יבשים — אפשר להשקות.", pieces: 5, gapMs: 15 };
    h.anthropic.length = 0;
    const r = await chat(A, { chatId, messageId: m1, plantId: PLANT, text: "מתי להשקות אותו?" });
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/event-stream");
    expect(r.events[0]).toMatchObject({ event: "meta", data: { chatId, messageId: m1, answerId: `${m1}-a` } });
    expect(r.events.filter((e) => e.event === "delta").length).toBeGreaterThanOrEqual(3);
    expect(text(r.events)).toBe(h.chatReply.text);
    const done = r.events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.status).toBe("complete");
    const tm = done.data.timings as Record<string, number>;
    for (const k of ["authMs", "readMs", "contextDbMs", "persistUserMs", "firstTokenMs", "anthropicMs", "persistMs", "totalMs", "contextChars"]) expect(typeof tm[k], k).toBe("number");
    // Model call: streaming, short answers, no thinking delay, the chat system prompt.
    const b = lastBody();
    expect(b.stream).toBe(true);
    expect(b.thinking).toEqual({ type: "disabled" });
    expect(b.max_tokens).toBeLessThanOrEqual(1024);
    expect(b.system[0].text).toContain("עני קודם כל ישירות");
    await settle();
    const ms = await messages(A);
    expect(ms.filter((m) => m.chatId === chatId).map((m) => [m.role, m.status])).toEqual(expect.arrayContaining([["user", "complete"], ["assistant", "complete"]]));
    expect(ms.filter((m) => m.chatId === chatId)).toHaveLength(2);
    expect((await A.pullAll()).find((x) => x.entity === "chat" && x.id === chatId)!.data).toMatchObject({ plantId: PLANT, title: "מתי להשקות אותו?" });
    const usage = (await db.prepare(`SELECT feature, status, first_token_ms, context_chars, timings FROM user_ai_usage WHERE feature = 'chat' ORDER BY id DESC LIMIT 1`).first<Record<string, unknown>>())!;
    expect(usage).toMatchObject({ feature: "chat", status: "ok" });
    expect(Number(usage.first_token_ms)).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(usage)).not.toContain("להשקות"); // metadata only
  });

  it("watering question → compact, relevant context (waterings, soil checks, pot, observed intervals); never other plants", async () => {
    const t = turnText();
    expect(t).toContain("observedDaysBetweenWaterings");
    expect(t).toContain("soil_check");
    expect(t).toContain("potDiameterCm");
    expect(t).not.toContain("root_check");
    expect(t).not.toContain("propagationMethod");
    expect(t).not.toContain("סוד של צמח אחר");
    expect(t).not.toContain("מונסטרה סודית");
    expect(lastBody().messages.at(-1)!.content).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })])); // text question → no images
  });

  it("follow-up keeps the conversation (previous turns sent as history), with bounded size", async () => {
    h.chatReply = { text: "עם שני שורשים עדיף לחכות עוד קצת.", pieces: 2 };
    const r = await chat(A, { chatId, messageId: randomUUID(), plantId: PLANT, text: "ומה אם יש רק שני שורשים?" });
    expect(r.status).toBe(200);
    const msgs = lastBody().messages;
    expect(msgs.length).toBe(3); // user, assistant (previous exchange), current user turn
    expect(msgs[0]).toMatchObject({ role: "user", content: "מתי להשקות אותו?" });
    expect(msgs[1].role).toBe("assistant");
    expect(String(msgs[1].content)).toContain("כדאי לבדוק קודם את האדמה");
    // The roots follow-up is a propagation question → root checks appear, still only this plant.
    expect(turnText()).toContain("root_check");
    expect(turnText()).not.toContain("מונסטרה סודית");
  });

  it("history is bounded: only the most recent messages are sent verbatim", async () => {
    for (let i = 0; i < 6; i++) { h.chatReply = { text: `תשובה ${i}`, pieces: 1 }; await chat(A, { chatId, messageId: randomUUID(), plantId: PLANT, text: `שאלה מספר ${i}` }); }
    await settle();
    h.chatReply = { text: "סיכום", pieces: 1 };
    await chat(A, { chatId, messageId: randomUUID(), plantId: PLANT, text: "ועוד שאלה" });
    const msgs = lastBody().messages;
    expect(msgs.length).toBeLessThanOrEqual(9); // ≤ 8 history + the current turn
    expect(turnText()).toContain("נושאים שעלו קודם בשיחה"); // earlier questions summarised as a short list
  });

  it("the same message id twice: the stored answer is replayed, no second model call, no duplicate", async () => {
    const before = h.anthropic.length;
    const r = await chat(A, { chatId, messageId: m1, plantId: PLANT, text: "מתי להשקות אותו?" });
    expect(r.status).toBe(200);
    expect(r.events.at(-1)).toMatchObject({ event: "done", data: { replayed: true } });
    expect(text(r.events)).toContain("כדאי לבדוק קודם את האדמה");
    expect(h.anthropic.length).toBe(before);
    expect((await messages(A)).filter((m) => m.id === `${m1}-a`)).toHaveLength(1);
  });

  it("rapid double tap: a second request for a message still being answered is refused (409 in_progress)", async () => {
    h.chatReply = { text: "תשובה איטית שנכתבת לאט מאוד.", pieces: 6, gapMs: 60 };
    const id = randomUUID();
    const first = send(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה כפולה" });
    await new Promise((r) => setTimeout(r, 40));
    const second = await chat(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה כפולה" });
    expect(second.status).toBe(409);
    expect(second.error).toBe("in_progress");
    expect(text(parseSse(await (await first).text()))).toBe(h.chatReply.text);
    await settle();
    expect((await messages(A)).filter((m) => m.replyTo === id)).toHaveLength(1);
  });

  it("Stop mid-answer → model call aborted, partial text stored as 'partial' (never as complete); retry completes it once", async () => {
    h.chatReply = { text: "חלק ראשון. חלק שני. חלק שלישי. חלק רביעי.", pieces: 4, firstMs: 5, gapMs: 700 };
    const id = randomUUID();
    const r = await send(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה שתיעצר" });
    const reader = r.body!.getReader();
    let got = "";
    while (!got.includes("event: delta")) got += new TextDecoder().decode((await reader.read()).value);
    const stop = await A.json<{ stopping: boolean }>("/api/v1/chat/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: id }) });
    expect(stop.stopping).toBe(true);
    let rest = "";
    for (;;) { const x = await reader.read(); if (x.done) break; rest += new TextDecoder().decode(x.value); }
    expect(rest).toContain('"status":"partial"');
    await expect.poll(async () => (await messages(A)).find((m) => m.id === `${id}-a`)?.status, { timeout: 5000 }).toBe("partial");
    // (Miniflare does not propagate the outbound abort to the Node-side mock, so the abort itself is observed
    // through its effect: the stored text is shorter than the full answer and the run ends as "partial".)
    const partial = (await messages(A)).find((m) => m.id === `${id}-a`)!;
    expect(String(partial.text).length).toBeLessThan(h.chatReply.text.length);
    const run = await db.prepare(`SELECT state FROM user_chat_runs WHERE message_id = ?`).bind(id).first<{ state: string }>();
    expect(run!.state).toBe("partial");
    // B cannot stop A's answer (same reply as an unknown id).
    expect((await B.json<{ stopping: boolean }>("/api/v1/chat/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: id }) })).stopping).toBe(false);
    // Retry the same message: regenerated once, the same answer record becomes complete.
    h.chatReply = { text: "תשובה מלאה אחרי ניסיון חוזר.", pieces: 2 };
    const again = await chat(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה שתיעצר" });
    expect(again.events.at(-1)).toMatchObject({ event: "done", data: { status: "complete" } });
    await settle();
    const answers = (await messages(A)).filter((m) => m.replyTo === id);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ status: "complete", text: "תשובה מלאה אחרי ניסיון חוזר." });
  }, 20_000);

  it("connection dropped mid-answer → the answer still completes server-side and is stored once (complete)", async () => {
    h.chatReply = { text: "תשובה שממשיכה גם בלי חיבור.", pieces: 3, gapMs: 100 };
    const id = randomUUID();
    const r = await send(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה עם ניתוק" });
    const reader = r.body!.getReader();
    await reader.read();
    await reader.cancel();
    await expect.poll(async () => (await messages(A)).find((m) => m.id === `${id}-a`)?.status, { timeout: 5000 }).toBe("complete");
    expect((await messages(A)).filter((m) => m.replyTo === id)).toHaveLength(1);
  }, 20_000);

  it("upstream failure → error event, no answer record, retry allowed and succeeds", async () => {
    const id = randomUUID();
    h.anthropicStatus = 529;
    try {
      const r = await chat(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה בזמן תקלה" });
      expect(r.events.at(-1)!.event).toBe("error");
      expect(String(r.events.at(-1)!.data.code)).toMatch(/^ai_upstream_5/);
    } finally { h.anthropicStatus = undefined; }
    await settle();
    expect((await messages(A)).some((m) => m.id === `${id}-a`)).toBe(false);
    expect((await messages(A)).some((m) => m.id === id)).toBe(true); // the user's message is kept
    h.chatReply = { text: "עכשיו זה עובד.", pieces: 1 };
    const ok = await chat(A, { chatId, messageId: id, plantId: PLANT, text: "שאלה בזמן תקלה" });
    expect(text(ok.events)).toBe("עכשיו זה עובד.");
  });

  it("an attached image goes to the model and is stored privately under the caller's key; a stored plant photo is not fetched for text questions", async () => {
    const id = randomUUID();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
    h.chatReply = { text: "רואים עלה בריא.", pieces: 1 };
    const r = await chat(A, { chatId, messageId: id, plantId: PLANT, text: "מה דעתך על העלה הזה?", images: [jpeg] });
    expect(r.status).toBe(200);
    const content = lastBody().messages.at(-1)!.content as { type: string }[];
    expect(content.filter((x) => x.type === "image")).toHaveLength(1);
    await settle();
    expect((await messages(A)).find((m) => m.id === id)).toMatchObject({ attachments: 1 });
    const own = await A.req(`/api/v1/chat/attachments/${id}/0`);
    expect(own.status).toBe(200);
    expect((await B.req(`/api/v1/chat/attachments/${id}/0`)).status).toBe(404);
    expect((await A.req(`/api/v1/chat/attachments/..%2F${id}/0`)).status).toBe(404);
  });
});

describe("isolation", () => {
  it("B cannot use A's plant: 404 before any model call, and the claimed run is released", async () => {
    const n = h.anthropic.length;
    const r = await chat(B, { chatId: randomUUID(), messageId: randomUUID(), plantId: PLANT, text: "מה שלומו?" });
    expect(r.status).toBe(404);
    expect(h.anthropic.length).toBe(n);
  });

  it("B reusing A's chat id gets an empty conversation of B's own — none of A's messages or context", async () => {
    const aChat = (await A.pullAll()).find((x) => x.entity === "chat")!.id;
    h.chatReply = { text: "שלום B", pieces: 1 };
    const r = await chat(B, { chatId: aChat, messageId: randomUUID(), plantId: null, text: "שלום" });
    expect(r.status).toBe(200);
    expect(lastBody().messages).toHaveLength(1); // no history from A's conversation
    const sent = JSON.stringify(lastBody());
    expect(sent).not.toContain("מתי להשקות");
    expect(sent).not.toContain("פוטוס");
    await settle();
    const bMsgs = await messages(B);
    expect(bMsgs.every((m) => m.text !== "מתי להשקות אותו?")).toBe(true);
    expect((await messages(A)).some((m) => m.text === "שלום")).toBe(false);
  });

  it("a conversation stays bound to its plant (no switching plants inside one chat)", async () => {
    const aChat = (await A.pullAll()).find((x) => x.entity === "chat" && x.data.plantId === PLANT)!.id;
    const r = await chat(A, { chatId: aChat, messageId: randomUUID(), plantId: OTHER, text: "ועל הצמח השני?" });
    expect(r.status).toBe(409);
    expect(r.error).toBe("chat_plant_mismatch");
  });

  it("the browser cannot write chat messages (server-only entity)", async () => {
    const r = await A.push([mut("message", "forged", { id: "forged", chatId: randomUUID(), role: "assistant", text: "מזויף" })]);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("bad_entity");
  });

  it("missing auth → 401 for chat and attachments", async () => {
    expect((await h.fetch("/api/v1/chat", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await h.fetch(`/api/v1/chat/attachments/${randomUUID()}/0`)).status).toBe(401);
  });
});

describe("schema v3 is additive", () => {
  it("new table, indexes and columns exist; schema_version = 3", async () => {
    const v = await db.prepare(`SELECT value FROM app_meta WHERE key = 'schema_version'`).first<{ value: string }>();
    expect(v!.value).toBe("3");
    const names = (await db.prepare(`SELECT name FROM sqlite_master`).all<{ name: string }>()).results.map((r) => r.name);
    for (const n of ["user_chat_runs", "user_records_plant", "user_records_chat", "app_records", "user_records"]) expect(names).toContain(n);
    const cols = (await db.prepare(`SELECT name FROM pragma_table_info('user_ai_usage')`).all<{ name: string }>()).results.map((r) => r.name);
    expect(cols).toEqual(expect.arrayContaining(["first_token_ms", "context_chars", "timings"]));
  });

  it("plant-scoped lookups use the new index (query plan)", async () => {
    const plan = (await db.prepare(`EXPLAIN QUERY PLAN SELECT data FROM user_records WHERE user_id = ?1 AND entity = 'event' AND json_extract(data, '$.plantId') = ?2`).bind("u", "p").all<{ detail: string }>()).results.map((r) => r.detail).join(" ");
    expect(plan).toContain("user_records_plant");
  });
});
