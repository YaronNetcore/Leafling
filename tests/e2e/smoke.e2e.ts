// Blank-screen guard: the production build must MOUNT and show real content on every main screen, with data shaped
// like the real owner account (2026-10-18 structure: 33 plants incl. deleted/archived, 256 events of the real types,
// 26 user-reported cases + 26 grouped reminders from a confirmed 26-plant AI card, chats, photos, 6 places) — also
// after a reload and with the clock past the reminders' due date. Fails on any uncaught page error or an empty #root.
// Headless Chromium at iPhone size — NOT Safari on a real iPhone.
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = { A: { sub: "aaaaaaaa-7777-4000-8000-00000000000a", email: OWNER_EMAIL } };
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page, A: Client;
const errors: string[] = [];
let cardId = "";
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const STATUSES = ["plant", "rooting", "seedling"] as const;

async function seed() {
  const muts: Record<string, unknown>[] = [
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [{ id: "p1", kind: "cat" }], interests: ["x"], places: ["indoor"], help: { soil: true }, onboardingStep: 6, theme: "light", city: "עיר", region: "אזור", country: "ישראל", experience: "some", createdAt: day(30) }),
  ];
  for (let i = 0; i < 6; i++) muts.push(mut("location", `loc${i}`, { id: `loc${i}`, name: `מקום ${i}`, kind: i < 4 ? "indoor" : "outdoor", directSun: "morning", windowDistance: "near", createdAt: day(30) }));
  for (let i = 0; i < 33; i++) {
    const status = STATUSES[i % 3];
    muts.push(mut("plant", `pl${i}`, {
      id: `pl${i}`, commonName: `צמח ${i}`, scientificName: i % 2 ? "Epipremnum aureum" : "", speciesId: i % 4 === 0 ? null : i % 3 === 0 ? "pothos" : `cat-${i}`, ordinal: 1 + (i % 2),
      nickname: i % 4 === 1 ? `כינוי ${i}` : null, status, locationId: i < 12 ? `loc${i % 6}` : null, acquiredAt: i % 3 ? null : day(40), acquiredPrecision: "day",
      germinatedCount: status === "seedling" ? i % 2 : null, sowDate: status === "seedling" ? day(20) : null, seedCount: status === "seedling" ? 4 : null, sowingType: status === "seedling" ? "one_cell" : null,
      propagationMethod: status === "rooting" ? "ייחור במים" : null, propagationStart: status === "rooting" ? day(15) : null, rootState: status === "rooting" ? "started" : null,
      favorite: i % 5 === 0, mainPhotoId: i < 30 ? `ph${i}` : null, archivedAt: i === 32 ? day(2) : null, deletedAt: i >= 28 && i < 32 ? day(3) : null, createdAt: day(40 - i),
    }));
  }
  const types = ["plant_created", "watering", "soil_check", "task_postponed", "photo_added", "propagation_started", "root_check", "water_change", "germination_update", "milestone", "sowing", "status_changed", "location_changed"];
  for (let i = 0; i < 150; i++) {
    const t = types[i % types.length];
    const payload: Record<string, unknown> = t === "soil_check" ? { result: "slightly_moist", watered: false } : t === "task_postponed" ? { task: "soil_check", until: day(-1), days: 2 } : t === "photo_added" ? { photoId: `ph${i % 30}` }
      : t === "milestone" ? { kind: "first_leaf" } : t === "location_changed" ? { from: null, to: "loc1" } : t === "status_changed" ? { from: "seedling", to: "plant" } : t === "germination_update" ? { germinated: 2, previous: 1 } : t === "watering" ? { via: "soil_check" } : {};
    muts.push(mut("event", `ev${i}`, { id: `ev${i}`, plantId: `pl${i % 28}`, type: t, payload, occurredAt: day(i % 20), precision: "exact", source: "user", inJournal: ["photo_added", "milestone", "sowing", "germination_update", "propagation_started"].includes(t), inHistory: t !== "note", createdAt: day(i % 20) }));
  }
  for (let i = 0; i < 46; i++) muts.push(mut("photo", `ph${i}`, { id: `ph${i}`, plantId: `pl${i % 30}`, mime: "image/jpeg", width: 100, height: 100, size: 10, sha256: "0", crc32: "0", uploadState: "uploaded", inJournal: true, capturedAt: i % 5 ? null : day(3), capturedSource: "camera", createdAt: day(i % 20) }));
  for (let i = 0; i < muts.length; i += 8) {
    const r = await A.push(muts.slice(i, i + 8));
    if (!r.ok) throw new Error(`seed ${r.status}`);
  }
}

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  await seed();
  // A confirmed 26-plant treatment card through the real chat → execute path (as on 2026-10-18), then chat history.
  const chatId = randomUUID();
  h.actionParse = { action: "treatment", scope: "all", pest: "אקריות", product: "קונפידור", date_text: "ב־13.10.26", already_done: true };
  const messageId = randomUUID();
  const r = await A.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, messageId, plantId: null, text: "טיפלתי בכל הצמחים נגד אקריות עם קונפידור ב־13.10.26", tz: "Asia/Jerusalem" }) });
  await r.text();
  cardId = `${messageId}-a`;
  const card = (await A.pullAll()).find((x) => x.id === cardId)!.data.proposal as { revision: number; targets: { plantId: string }[] };
  const ids = card.targets.map((t) => t.plantId).slice(0, 26);
  let res = await A.req("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: cardId, revision: card.revision, plantIds: ids, followUp: true }) });
  for (let i = 0; i < 40 && ((await res.clone().json()) as { remaining: number }).remaining > 0; i++) {
    res = await A.req("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: cardId, revision: card.revision }) });
  }
  h.chatReply = { text: "תשובה." };
  for (let i = 0; i < 3; i++) await (await A.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, messageId: randomUUID(), plantId: null, text: `שאלה ${i}` }) })).text();
  await (await A.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: randomUUID(), messageId: randomUUID(), plantId: "pl3", text: "שאלה על הצמח" }) })).text();

  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}, 240_000);
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

async function open(at?: Date) {
  await ctx?.close();
  errors.length = 0;
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  page = await ctx.newPage();
  if (at) await page.clock.install({ time: at });
  page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|404|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await ctx.addCookies([{ name: "tu", value: "A", url: proxy.base }]);
  await page.goto(`${proxy.base}/`);
  await page.waitForURL(/\/today/, { timeout: 30_000 });
}
const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const rootText = () => page.evaluate(() => (document.getElementById("root")?.innerText ?? "").trim());
/** Real content, not a blank background: the screen's own text AND the main navigation. */
async function expectScreen(path: string, mustContain: string) {
  await go(path);
  await expect.poll(rootText, { timeout: 15_000 }).toContain(mustContain);
  expect(errors, `${path}: ${errors.join(" | ")}`).toEqual([]);
}
const NAV = ["היום", "מצא צמח", "הצמחים שלי", "המיקומים שלי", "כלים"];

describe.each([
  ["now", undefined],
  ["after the follow-up reminders are due (21.10)", new Date("2026-10-21T09:00:00+03:00")],
])("production build with a real-shaped account — %s", (_label, at) => {
  beforeAll(async () => { await open(at); }, 120_000);

  it("Today mounts with the five tabs; synced data is shown", async () => {
    await expect.poll(rootText, { timeout: 20_000 }).toContain("עדכונים אחרונים מהבוטנאי");
    const t = await rootText();
    for (const n of NAV) expect(t).toContain(n);
    expect(errors).toEqual([]);
    if (at) expect(t).toContain("26 צמחים · כל צמח מסומן בנפרד");
  });
  it("every main screen renders content", async () => {
    await expectScreen("/plants", "הצמחים שלי");
    await page.getByRole("tab", { name: "חולים" }).or(page.getByRole("button", { name: "חולים" })).first().click();
    await expect.poll(() => page.getByTestId("plant-issue").count(), { timeout: 15_000 }).toBeGreaterThan(20);
    for (const tab of ["care", "journal", "history", "health", "about"]) await expectScreen(`/plants/pl3?tab=${tab}`, "צמח 3");
    await expectScreen("/plants/pl1", "כינוי 1");
    await expectScreen("/botanist", "AI Botanist");
    await expectScreen("/botanist?plant=pl3", "צמח 3");
    await expectScreen(`/updates/${cardId}`, "טיפול נגד אקריות");
    await expectScreen("/locations", "מקום 1");
    await expectScreen("/locations/loc1", "מקום 1");
    await expectScreen("/tools", "מד אור");
    await expectScreen("/find", "מצא");
    await expectScreen("/settings", "הגדרות");
  });
  it("a reload on a deep screen does not leave a blank page", async () => {
    for (const p of ["/plants/pl3?tab=journal", "/today", `/updates/${cardId}`]) {
      await page.goto(`${proxy.base}${p}`);
      await expect.poll(rootText, { timeout: 20_000 }).not.toBe("");
      expect(errors, `${p}: ${errors.join(" | ")}`).toEqual([]);
    }
  });
});

describe("never a blank page when the server or the code fails", () => {
  it("a stuck /api/v1/me (the 2026-10-18 failure): the app still opens this device's copy within seconds", async () => {
    await open(); // signs in once, so this device has a confirmed user and a local copy
    await expect.poll(rootText, { timeout: 20_000 }).toContain("עדכונים אחרונים מהבוטנאי");
    await page.route("**/api/v1/**", () => undefined); // every API request hangs, like the stuck Worker isolate
    const t0 = Date.now();
    await page.goto(`${proxy.base}/today`);
    await expect.poll(() => page.getByTestId("boot-screen").count(), { timeout: 3_000 }).toBe(1); // visible at once
    await expect.poll(rootText, { timeout: 20_000 }).toContain("עדכונים אחרונים מהבוטנאי");
    expect(Date.now() - t0).toBeLessThan(15_000);
    for (const n of NAV) expect(await rootText()).toContain(n);
    await expectScreen("/plants/pl3?tab=history", "צמח 3");
    await page.unroute("**/api/v1/**");
  });
  it("API errors (500) on a fresh device: a sign-in screen, not a blank page", async () => {
    await ctx?.close();
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "he-IL" });
    page = await ctx.newPage();
    await page.route("**/api/v1/**", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto(`${proxy.base}/`);
    await expect.poll(rootText, { timeout: 15_000 }).toContain("כניסה");
  });
  it("the app's script fails to load: a Hebrew refresh message appears instead of a blank page", async () => {
    await ctx?.close();
    ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "he-IL" });
    page = await ctx.newPage();
    await ctx.addCookies([{ name: "tu", value: "A", url: proxy.base }]);
    await page.route(/\/assets\/index-.*\.js$/, (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto(`${proxy.base}/`);
    await page.getByTestId("load-fallback").waitFor({ timeout: 25_000 });
    expect(await rootText()).toContain("Leafling לא נטענה");
    expect(await page.getByRole("button", { name: "רענון" }).count()).toBe(1);
  }, 60_000);
});
