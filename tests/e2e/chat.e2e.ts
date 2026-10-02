// AI Botanist chat in the browser (headless Chromium, iPhone 393×852 viewport — NOT a real iPhone) against the
// real production build + real Worker (Miniflare) with a mocked STREAMING Anthropic API. Timings here are local
// pipeline timings with a mocked model; they are NOT real Claude latency.
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = {
  A: { sub: "aaaaaaaa-4444-4000-8000-00000000000a", email: OWNER_EMAIL },
  B: { sub: "bbbbbbbb-4444-4000-8000-00000000000b", email: "chat-ui-b@example.test" },
};
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page;
let A: Client, B: Client;
const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const signInAs = async (who: string) => { await ctx.clearCookies(); await ctx.addCookies([{ name: "tu", value: who, url: proxy.base }]); };
const body = () => page.textContent("body").then((t) => t ?? "");
const shot = async (name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };
const assistantTexts = () => page.$$eval('[data-role="assistant"]', (els) => els.map((e) => (e.textContent ?? "").trim()));
const userTexts = () => page.$$eval('[data-testid="msg-user"]', (els) => els.map((e) => (e.textContent ?? "").trim()));
const messages = async (c: Client) => (await c.pullAll()).filter((r) => r.entity === "message").map((r) => r.data);
const ask = async (q: string) => { await page.getByTestId("chat-input").fill(q); await page.getByTestId("chat-send").click(); };
const LONG = "מתחילים בבדיקת האדמה: מכניסים אצבע לעומק של כמה סנטימטרים. אם המצע יבש — משקים היטב עד שהמים יוצאים מחורי הניקוז. אם הוא עדיין לח — מחכים עוד יומיים ובודקים שוב. כך מונעים גם ייבוש וגם ריקבון שורשים.";

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  B = await Client.signIn(h, PEOPLE.B);
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  await A.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("plant", "p-pothos", { id: "p-pothos", commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "rooting", ordinal: 1, propagationMethod: "ייחור במים", createdAt: day(30) }),
    mut("event", "e1", { id: "e1", plantId: "p-pothos", type: "root_check", occurredAt: day(2), payload: { roots: 2 }, source: "user", inJournal: false, inHistory: true }),
  ]);
  await B.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("plant", "p-b", { id: "p-b", commonName: "צמח של B", status: "plant", ordinal: 1 }),
  ]);
  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL" });
  page = await ctx.newPage();
  await signInAs("A");
  await page.goto(`${proxy.base}/`);
  await page.waitForURL(/\/today/, { timeout: 30_000 });
}, 180_000);
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

describe("AI Botanist conversation", () => {
  it("opens from the plant as a chat: compact header with the plant, composer with the placeholder", async () => {
    await go("/plants/p-pothos");
    await page.getByText("לשאול את הבוטנאי").first().click();
    await page.waitForURL(/\/botanist\?plant=p-pothos/);
    await expect.poll(() => page.getByTestId("chat-header").textContent()).toContain("פוטוס");
    const header = await page.getByTestId("chat-header").textContent();
    expect(header).toContain("AI Botanist");
    expect(header).toContain("פוטוס");
    expect(header).toContain("בהשרשה"); // status shown
    expect(await page.getByTestId("chat-input").getAttribute("placeholder")).toBe("שאלי אותי משהו על הצמח…");
    expect(await page.getByRole("button", { name: "צירוף תמונה" }).count()).toBe(1);
    expect(await page.getByRole("button", { name: "צילום" }).count()).toBe(1);
    // The header is compact: the thread is the main content.
    const hb = (await page.getByTestId("chat-header").boundingBox())!;
    expect(hb.height).toBeLessThan(70);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("chat-empty");
  });

  it("send: the user bubble appears at once, then 'חושב…', then the answer grows progressively", async () => {
    h.chatReply = { text: LONG, pieces: 10, firstMs: 600, gapMs: 120 };
    await ask("איך יודעים שאפשר להעביר לכד?");
    await expect.poll(userTexts, { timeout: 2000 }).toContain("איך יודעים שאפשר להעביר לכד?");
    await expect.poll(body, { timeout: 2000 }).toContain("חושב…");
    // Progressive rendering: sample the growing answer.
    const lengths: number[] = [];
    for (let i = 0; i < 25 && !(await body()).includes("ריקבון שורשים."); i++) {
      const s = await page.getByTestId("msg-streaming").textContent().catch(() => "");
      lengths.push((s ?? "").length);
      await new Promise((r) => setTimeout(r, 90));
    }
    const distinct = [...new Set(lengths.filter((n) => n > 10))];
    expect(distinct.length).toBeGreaterThanOrEqual(3); // seen at several intermediate lengths, not all at once
    await expect.poll(async () => (await assistantTexts()).some((t) => t.includes("ריקבון שורשים.")), { timeout: 10_000 }).toBe(true);
    expect(await page.getByTestId("chat-send").count()).toBe(1); // composer usable again
    await shot("chat-answer");
  });

  it("follow-up in the same conversation is sent with the previous turns", async () => {
    h.chatReply = { text: "עם שני שורשים עדיף לחכות עוד שבוע.", pieces: 3, gapMs: 40 };
    await ask("ומה אם יש רק שני שורשים?");
    await expect.poll(async () => (await assistantTexts()).some((t) => t.includes("עדיף לחכות")), { timeout: 10_000 }).toBe(true);
    const sent = h.anthropic.at(-1)!.body as { messages: { role: string; content: unknown }[] };
    expect(sent.messages[0]).toMatchObject({ role: "user", content: "איך יודעים שאפשר להעביר לכד?" });
    expect(String(sent.messages[1].content)).toContain("ריקבון שורשים");
    h.chatReply = { text: "כן, שבוע נוסף זה בסדר.", pieces: 2 };
    await ask("אפשר לחכות עוד שבוע?");
    await expect.poll(async () => (await assistantTexts()).some((t) => t.includes("שבוע נוסף")), { timeout: 10_000 }).toBe(true);
    expect((h.anthropic.at(-1)!.body as { messages: unknown[] }).messages.length).toBe(5);
  });

  it("history survives navigation and comes back for the same plant", async () => {
    await expect.poll(async () => (await messages(A)).length, { timeout: 15_000 }).toBe(6);
    await go("/today");
    await go("/plants");
    await go("/botanist?plant=p-pothos");
    await expect.poll(userTexts, { timeout: 10_000 }).toEqual(["איך יודעים שאפשר להעביר לכד?", "ומה אם יש רק שני שורשים?", "אפשר לחכות עוד שבוע?"]);
    expect((await assistantTexts()).length).toBe(3);
    // A full reload too (records come from this user's IndexedDB / server).
    await page.reload();
    await expect.poll(userTexts, { timeout: 15_000 }).toHaveLength(3);
  });

  it("attaching an image to the same conversation (gallery) sends it and shows it in the thread", async () => {
    const png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 80; c.height = 60; const g = c.getContext("2d")!; g.fillStyle = "#4a7a3d"; g.fillRect(0, 0, 80, 60); return c.toDataURL("image/jpeg", 0.9).split(",")[1]; }), "base64");
    h.chatReply = { text: "רואים שורש לבן ובריא.", pieces: 2 };
    await page.getByTestId("chat-input-library").setInputFiles({ name: "root.jpg", mimeType: "image/jpeg", buffer: png });
    expect(await page.locator('[data-testid="chat-attachments"] img').count()).toBe(1);
    await ask("ככה נראה השורש");
    await expect.poll(async () => (await assistantTexts()).some((t) => t.includes("שורש לבן")), { timeout: 10_000 }).toBe(true);
    const sent = h.anthropic.at(-1)!.body as { messages: { content: { type: string }[] | string }[] };
    const last = sent.messages.at(-1)!.content as { type: string }[];
    expect(last.filter((c) => c.type === "image")).toHaveLength(1);
    // After sync the stored message shows the attachment from private storage.
    await expect.poll(async () => page.locator('img[src*="/api/v1/chat/attachments/"]').count(), { timeout: 15_000 }).toBe(1);
  });

  it("scrolling up while an answer streams stops the forced auto-scroll", async () => {
    h.chatReply = { text: LONG + " " + LONG + " " + LONG, pieces: 24, firstMs: 300, gapMs: 120 };
    await ask("ספרי לי עוד בפירוט");
    await page.getByTestId("msg-streaming").waitFor();
    await new Promise((r) => setTimeout(r, 700));
    await page.getByTestId("chat-thread").evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
    await new Promise((r) => setTimeout(r, 900));
    expect(await page.getByTestId("chat-thread").evaluate((el) => el.scrollTop)).toBeLessThan(40);
    await expect.poll(async () => page.getByTestId("chat-send").count(), { timeout: 15_000 }).toBe(1);
  });

  it("Stop: the answer is cut, marked as interrupted (not complete) and stored once as partial", async () => {
    h.chatReply = { text: LONG, pieces: 12, firstMs: 200, gapMs: 400 };
    const before = (await messages(A)).length;
    await ask("שאלה שאעצור");
    await page.getByTestId("msg-streaming").waitFor();
    await expect.poll(async () => ((await page.getByTestId("msg-streaming").textContent()) ?? "").length, { timeout: 5000 }).toBeGreaterThan(10);
    await page.getByTestId("chat-stop").click();
    await expect.poll(async () => page.getByTestId("msg-partial").count(), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await body()).toContain("התשובה נעצרה באמצע");
    await expect.poll(async () => (await messages(A)).length, { timeout: 15_000 }).toBe(before + 2);
    const ans = (await messages(A)).filter((m) => m.role === "assistant" && m.status === "partial");
    expect(ans).toHaveLength(1);
    expect(String(ans[0].text).length).toBeLessThan(LONG.length);
  });

  it("failure: the message stays, a small inline error with 'נסי שוב', retry works without retyping and answers once", async () => {
    h.anthropicStatus = 529;
    await ask("שאלה בזמן תקלה");
    await page.getByTestId("chat-error").waitFor({ timeout: 10_000 });
    expect(await body()).toContain("שאלה בזמן תקלה");
    expect(await page.getByTestId("chat-input").inputValue()).toBe(""); // nothing to retype
    await shot("chat-error");
    h.anthropicStatus = undefined;
    h.chatReply = { text: "עכשיו זה עבד.", pieces: 2 };
    await page.getByRole("button", { name: "נסי שוב" }).click();
    await expect.poll(async () => (await assistantTexts()).some((t) => t.includes("עכשיו זה עבד.")), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await messages(A)).filter((m) => m.text === "עכשיו זה עבד.").length, { timeout: 15_000 }).toBe(1);
    expect((await messages(A)).filter((m) => m.text === "שאלה בזמן תקלה")).toHaveLength(1);
  });

  it("rapid double tap sends one message", async () => {
    h.chatReply = { text: "תשובה אחת.", pieces: 2, firstMs: 300 };
    const before = (await messages(A)).length;
    await page.getByTestId("chat-input").fill("טאפ כפול");
    await page.getByTestId("chat-send").dblclick();
    await expect.poll(async () => (await messages(A)).length, { timeout: 15_000 }).toBe(before + 2);
    await new Promise((r) => setTimeout(r, 600));
    expect((await messages(A)).filter((m) => m.text === "טאפ כפול")).toHaveLength(1);
  });

  it("a different plant has its own conversation; B never sees A's chats on the same device", async () => {
    await go("/botanist");
    await expect.poll(body).toContain("שיחה כללית");
    await new Promise((r) => setTimeout(r, 300));
    expect(await userTexts()).toEqual([]);
    await signInAs("B");
    await page.goto(`${proxy.base}/botanist?plant=p-pothos`);
    await expect.poll(body, { timeout: 15_000 }).toContain("AI Botanist");
    expect(await body()).not.toContain("איך יודעים שאפשר להעביר לכד?");
    expect((await messages(B)).length).toBe(0);
    await signInAs("A");
    await page.goto(`${proxy.base}/today`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
  });
});

describe("measured local pipeline (mocked model)", () => {
  it("records time to first visible text vs total on a throttled mobile connection", async () => {
    const cdp = await ctx.newCDPSession(page);
    // DevTools "Slow 4G": 150 ms RTT, 1.6 Mbps down, 750 kbps up.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
    await go("/botanist?plant=p-pothos");
    await page.getByTestId("chat-input").waitFor();
    const runs: Record<string, unknown>[] = [];
    const sample = async (label: string, q: string, attach?: Buffer) => {
      h.chatReply = { text: LONG, pieces: 20, firstMs: 800, gapMs: 60 }; // mocked model: 0.8 s to first token, ~2 s total
      if (attach) await page.getByTestId("chat-input-library").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: attach });
      const n = await page.evaluate(() => (window as never as { __leaflingChatTimings: unknown[] }).__leaflingChatTimings.length);
      await ask(q);
      await expect.poll(() => page.evaluate(() => (window as never as { __leaflingChatTimings: unknown[] }).__leaflingChatTimings.length), { timeout: 30_000 }).toBe(n + 1);
      const t = await page.evaluate(() => (window as never as { __leaflingChatTimings: Record<string, unknown>[] }).__leaflingChatTimings.at(-1)!);
      runs.push({ label, ...t });
      await expect.poll(async () => page.getByTestId("chat-send").count(), { timeout: 15_000 }).toBe(1);
    };
    await sample("A simple text question", "מתי לבדוק את האדמה?");
    await sample("B follow-up", "ואם היא עדיין לחה?");
    const photo = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 3024; c.height = 4032; const g = c.getContext("2d")!; for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i % 360},60%,${30 + (i % 40)}%)`; g.fillRect((i * 37) % 3024, (i * 91) % 4032, 300, 300); } return c.toDataURL("image/jpeg", 0.92).split(",")[1]; }), "base64");
    await sample("C message with a new 12 MP photo", "מה רואים בתמונה?", photo);
    await sample("E history-heavy question", "תסכמי את כל מה שקרה לו בהשרשה עד עכשיו");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    for (const r of runs) { expect(r.firstTextMs as number).toBeLessThan(r.totalMs as number); }
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify({ photoBytes: photo.length, runs }, null, 2));
  }, 180_000);
});
