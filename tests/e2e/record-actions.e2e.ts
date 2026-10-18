// AI Botanist edits/deletes/undo in the browser: headless Chromium at iPhone size (393×852, RTL) — a SIMULATION,
// not a real iPhone — production build + real Worker (Miniflare), mocked parser (structure only).
// Flow: "תורידי את האקריות מהשתילים" → question → "הרישום היה טעות" → card with the seedlings' real records →
// exclude one → "אישור ומחיקה" → Sick / Journal / History after a reload → "ביטול הפעולה" → undo card → restored.
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = { A: { sub: "aaaaaaaa-8888-4000-8000-00000000000a", email: OWNER_EMAIL } };
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page, A: Client;
const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const body = () => page.textContent("body").then((t) => t ?? "");
const shot = async (name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };
const ask = async (q: string) => { await page.getByTestId("chat-input").fill(q); await page.getByTestId("chat-send").click(); };
const lastCard = () => page.getByTestId("action-card").last();
const sickCount = async () => {
  await go("/plants");
  await page.getByRole("tab", { name: "חולים" }).or(page.getByRole("button", { name: "חולים" })).first().click();
  await page.waitForTimeout(400);
  return page.getByTestId("plant-issue").count();
};

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  const at = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await A.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    ...["s1", "s2", "s3"].map((id, i) => mut("plant", id, { id, commonName: `שתיל ${i + 1}`, scientificName: "", status: "seedling", ordinal: 1, createdAt: at })),
    mut("plant", "po", { id: "po", commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "plant", ordinal: 1, createdAt: at }),
  ]);
  // The earlier bulk treatment, made through the real chat → execute path.
  h.actionParse = { action: "treatment", scope: "all", pest: "אקריות", product: "קונפידור", date_text: "ב־13.10.26", already_done: true };
  const mid = randomUUID();
  await (await A.req("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: randomUUID(), messageId: mid, plantId: null, text: "טיפלתי בכל הצמחים", tz: "Asia/Jerusalem" }) })).text();
  const card = (await A.pullAll()).find((r) => r.id === `${mid}-a`)!.data.proposal as { revision: number; targets: { plantId: string }[] };
  let r = await A.req("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: `${mid}-a`, revision: card.revision, plantIds: card.targets.map((t) => t.plantId), followUp: true }) });
  while (((await r.clone().json()) as { remaining: number }).remaining > 0) r = await A.req("/api/v1/actions/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: `${mid}-a`, revision: card.revision }) });
  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  page = await ctx.newPage();
  await ctx.addCookies([{ name: "tu", value: "A", url: proxy.base }]);
  await page.goto(`${proxy.base}/`);
  await page.waitForURL(/\/today/, { timeout: 30_000 });
}, 180_000);
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

describe("AI Botanist removes a wrong record, then undoes it (iPhone-size Chromium simulation)", () => {
  it("question → card with the seedlings' records → exclude one → delete → views updated after reload", async () => {
    expect(await sickCount()).toBe(4);
    await go("/botanist");
    h.actionParse = { action: "remove_issue", scope: "status", status_filter: "seedling", pest: "אקריות", removal_meaning: "unclear" };
    await ask("תורידי את האקריות מהשתילים");
    await expect.poll(body, { timeout: 10_000 }).toContain("מצאתי 3 שתילים עם רישום אקריות. לסמן שהחלימו, או למחוק את הרישום כי הוא היה שגוי?");
    h.actionParse = { action: "remove_issue", scope: "status", status_filter: "seedling", pest: "אקריות", removal_meaning: "erroneous" };
    await ask("הרישום היה טעות");
    await lastCard().waitFor({ timeout: 10_000 });
    expect(await lastCard().getAttribute("data-action")).toBe("remove_issue");
    expect(await lastCard().getByTestId("action-title").textContent()).toBe("מחיקת רישום בעיה שגוי: 12 רישומים ב־3 צמחים");
    expect(await lastCard().getByTestId("action-warning").textContent()).toContain("הטיפולים עצמם נשארים");
    await lastCard().getByTestId("action-edit").click();
    expect(await lastCard().getByTestId("action-record").count()).toBe(12);
    expect(await lastCard().textContent()).toContain("נשאר, בלי אקריות");
    await lastCard().locator('[data-plant-id="s3"] input').uncheck();
    expect(await lastCard().getByTestId("action-title").textContent()).toBe("מחיקת רישום בעיה שגוי: 8 רישומים ב־2 צמחים");
    expect(await lastCard().getByTestId("action-confirm").textContent()).toBe("אישור ומחיקה");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("record-remove-card");
    await lastCard().getByTestId("action-confirm").click();
    await expect.poll(body, { timeout: 15_000 }).toContain("הרישום השגוי הוסר ב־2 צמחים. הטיפולים נשארו.");

    await page.reload();
    await page.waitForTimeout(1500);
    expect(await sickCount()).toBe(2); // s3 (excluded) + pothos
    await go("/plants/s1?tab=journal");
    await expect.poll(() => page.getByTestId("journal-health").allTextContents(), { timeout: 10_000 }).toEqual(["🧴 טיפול בקונפידורחומר: קונפידור · דיווח שלך, לא אומת · נרשם דרך AI Botanist"]);
    await go("/plants/s1?tab=health");
    await expect.poll(body, { timeout: 10_000 }).toContain("אין כרגע בעיה פעילה במעקב");
    await go("/plants/s3?tab=health");
    await expect.poll(body, { timeout: 10_000 }).toContain("דיווח שלך · לא אומת");
    await shot("record-after-delete");
  });

  it("'ביטול הפעולה' on the finished card → undo card → confirm → everything is back", async () => {
    await go("/botanist");
    await page.getByTestId("action-undo").last().click();
    await expect.poll(() => lastCard().getAttribute("data-action"), { timeout: 15_000 }).toBe("undo");
    expect(await lastCard().getByTestId("action-title").textContent()).toBe("ביטול פעולה: 8 רישומים");
    await shot("record-undo-card");
    await lastCard().getByTestId("action-confirm").click();
    await expect.poll(body, { timeout: 15_000 }).toContain("8 רישומים שוחזרו");
    await expect.poll(() => page.getByTestId("action-undone").count(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await sickCount()).toBe(4);
    await go("/plants/s1?tab=history");
    await expect.poll(body, { timeout: 10_000 }).toContain("טיפול נגד אקריות");
  });
});
