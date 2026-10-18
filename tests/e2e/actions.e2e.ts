// AI Botanist actions in the browser: headless Chromium at an iPhone viewport (393×852, RTL) — a SIMULATION, not a
// real iPhone — against the production build + real Worker (Miniflare) with a mocked model that returns only the
// parsed structure. Card → corrections → edit list → confirm → History / Health / reminders.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = { A: { sub: "aaaaaaaa-5555-4000-8000-00000000000a", email: OWNER_EMAIL } };
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page, A: Client;
const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const body = () => page.textContent("body").then((t) => t ?? "");
const shot = async (name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };
const ask = async (q: string) => { await page.getByTestId("chat-input").fill(q); await page.getByTestId("chat-send").click(); };
const lastCard = () => page.getByTestId("action-card").last();
const keyOf = (prompt: string, name: string) => new RegExp(`(p\\d+) \\| ${name} \\|`).exec(prompt.replace(/\\n/g, "\n"))?.[1] ?? "p0";
const events = async (type: string) => (await A.pullAll()).filter((r) => r.entity === "event" && r.data.type === type).map((r) => r.data);

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  await A.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("location", "bal", { id: "bal", name: "מרפסת", kind: "outdoor" }),
    mut("location", "salon", { id: "salon", name: "סלון", kind: "indoor" }),
    mut("plant", "m1", { id: "m1", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 1, locationId: "salon", createdAt: new Date().toISOString() }),
    mut("plant", "m2", { id: "m2", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 2, nickname: "מוצי", locationId: "bal", createdAt: new Date().toISOString() }),
  ]);
  await A.push([
    mut("plant", "po", { id: "po", commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "plant", ordinal: 1, locationId: "bal", createdAt: new Date().toISOString() }),
    mut("plant", "fi", { id: "fi", commonName: "פיקוס כינורי", scientificName: "Ficus lyrata", status: "plant", ordinal: 1, locationId: "bal", createdAt: new Date().toISOString() }),
  ]);
  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  page = await ctx.newPage();
  await ctx.addCookies([{ name: "tu", value: "A", url: proxy.base }]);
  await page.goto(`${proxy.base}/`);
  await page.waitForURL(/\/today/, { timeout: 30_000 });
}, 180_000);
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

describe("AI Botanist actions (iPhone-size Chromium simulation)", () => {
  it("'השקיתי את כל הצמחים במרפסת' → card in the chat; 'לא לפוטוס' → 2 left; edit list; confirm → success after the server stored it", async () => {
    await go("/botanist");
    h.actionParse = { action: "water", scope: "location", location_text: "במרפסת" };
    await ask("השקיתי את כל הצמחים במרפסת");
    await lastCard().waitFor({ timeout: 10_000 });
    expect(await body()).toContain("מצאתי 3 צמחים במרפסת. לשמור השקיה ל־3 הצמחים — היום?");
    expect(await lastCard().getByTestId("action-title").textContent()).toBe("זיהיתי עדכון ל־3 צמחים 🌿");
    await lastCard().getByTestId("action-show").click();
    expect(await lastCard().getByTestId("action-plant").count()).toBe(3);
    // RTL, fits the phone width, no horizontal scrolling.
    expect(await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction)).toBe("rtl");
    const box = (await lastCard().boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(393);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("action-card");
    expect(await events("watering")).toHaveLength(0);

    h.actionParse = (prompt) => ({ intent: "modify_pending", exclude: [{ text: "הפוטוס", keys: [keyOf(prompt, "פוטוס")], all_matching: false }] });
    await ask("לא לפוטוס");
    await expect.poll(body, { timeout: 10_000 }).toContain("בסדר, נשארו 2 צמחים.");
    await expect.poll(() => lastCard().getByTestId("action-title").textContent(), { timeout: 10_000 }).toBe("זיהיתי עדכון ל־2 צמחים 🌿");
    expect(await body()).toContain("ההצעה עודכנה");
    await lastCard().getByTestId("action-edit").click();
    await lastCard().locator('[data-plant-id="fi"] input').uncheck();
    expect(await lastCard().getByTestId("action-title").textContent()).toBe("זיהיתי עדכון לצמח אחד 🌿");
    await shot("action-edit");
    await lastCard().getByTestId("action-confirm").click();
    await expect.poll(body, { timeout: 10_000 }).toContain("מוצי עודכן בהצלחה 🌱");
    expect((await events("watering")).map((e) => e.plantId)).toEqual(["m2"]);
    await expect.poll(() => page.getByTestId("action-status").last().textContent(), { timeout: 10_000 }).toMatch(/מוצי עודכן בהצלחה|נשמר לצמח אחד/);
    await shot("action-done");
  });

  it("treatment: product, pest and safety warnings in the card; follow-up inspection; History and Health show it", async () => {
    h.actionParse = { action: "treatment", scope: "all", pest: "אקריות", product: "קונפידור", date_text: "ב־13.10.26", already_done: true };
    await ask("טיפלתי בכל הצמחים נגד אקריות עם קונפידור ב־13.10.26");
    await expect.poll(() => lastCard().getByTestId("action-title").textContent(), { timeout: 10_000 }).toBe("זיהיתי עדכון ל־4 צמחים 🌿");
    const card = await lastCard().textContent();
    expect(card).toContain("קונפידור");
    expect(card).toContain("imidacloprid");
    expect(card).toContain("אקריות · דיווח שלך, לא אומת");
    expect(card).toContain("13.10.2026");
    expect(await lastCard().getByTestId("action-warning").textContent()).toContain("לא יעיל");
    expect(await lastCard().getByTestId("action-followup").isChecked()).toBe(true);
    expect(card).toContain("לא ריסוס חוזר");
    await shot("action-treatment");
    await lastCard().getByTestId("action-confirm").click();
    await expect.poll(body, { timeout: 20_000 }).toContain("עודכנו 4 צמחים בהצלחה 🌱");

    // The card links to the persisted records (not the chat text).
    await page.getByTestId("action-view").last().click();
    await page.waitForURL(/\/updates\//);
    await expect.poll(() => page.getByTestId("updates-plant").count(), { timeout: 10_000 }).toBe(4);
    expect(await page.getByTestId("updates-summary").textContent()).toContain("4 צמחים עודכנו");
    const rows = await page.getByTestId("updates-list").textContent();
    expect(rows!.match(/✓ נשמר 13\.10\.2026/g)).toHaveLength(4);
    expect(rows!.match(/בעיה פעילה: אקריות/g)).toHaveLength(4);
    await shot("action-updates");
    // Survives a full reload of the PWA (records come from the device database, synced from the server).
    await page.reload();
    await expect.poll(() => page.getByTestId("updates-plant").count(), { timeout: 20_000 }).toBe(4);
    await page.locator('[data-testid="updates-plant"][data-plant-id="fi"]').click();
    await page.waitForURL(/\/plants\/fi\?tab=health/);
    await expect.poll(body, { timeout: 10_000 }).toContain("דיווח שלך · לא אומת");
    expect(await page.getByTestId("case-treatments").textContent()).toContain("טופל בקונפידור");
    await shot("action-health");
    const tab = (name: string) => page.getByRole("tab", { name, exact: true }).or(page.getByRole("button", { name, exact: true })).first();
    await tab("היסטוריה").click();
    await expect.poll(body, { timeout: 10_000 }).toContain("טיפול נגד אקריות");
    const hist = await page.getByTestId("history-item").allTextContents();
    const item = hist.find((t) => t.includes("טיפול נגד אקריות"))!;
    expect(item).toContain("חומר: קונפידור");
    expect(item).toContain("דיווח שלך, לא אומת");
    expect(item).toContain("נרשם דרך AI Botanist");
    expect(await body()).toContain("13.10.2026");
    await tab("יומן").click();
    await expect.poll(() => page.getByTestId("journal-health").allTextContents(), { timeout: 10_000 }).toContain("🧴 טיפול נגד אקריותחומר: קונפידור · דיווח שלך, לא אומת · נרשם דרך AI Botanist");
    expect(await body()).toContain("13 באוקטובר 2026");
    await shot("action-journal");
    await tab("טיפול").click();
    await expect.poll(body, { timeout: 10_000 }).toContain("בדיקה חוזרת לאקריות");

    // "חולים": the plants with the open user-reported issue, statuses unchanged.
    await go("/plants");
    await page.getByRole("tab", { name: "חולים" }).or(page.getByRole("button", { name: "חולים" })).first().click();
    await expect.poll(() => page.getByTestId("plant-issue").count(), { timeout: 10_000 }).toBe(4);
    expect(await page.getByTestId("plant-issue").first().textContent()).toContain("דיווח שלך");
    await shot("action-sick");
    // Resolving one plant's issue removes only that plant.
    await go("/plants/po?tab=health");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "הצמח התאושש — לסיים מעקב" }).click();
    await go("/plants");
    await page.getByRole("tab", { name: "חולים" }).or(page.getByRole("button", { name: "חולים" })).first().click();
    await expect.poll(() => page.getByTestId("plant-issue").count(), { timeout: 10_000 }).toBe(3);

    // Today: the recent bulk update is one entry; its reminders (made due now) are ONE grouped item with per-plant completion.
    const rem = (await A.pullAll()).filter((r) => r.entity === "reminder");
    expect(rem).toHaveLength(4);
    await A.push(rem.map((r) => mut("reminder", r.id, { nextAt: new Date(Date.now() - 3_600_000).toISOString() }, 2 ** 31)));
    await go("/today");
    await page.reload();
    await expect.poll(() => page.getByTestId("reminder-group").count(), { timeout: 20_000 }).toBe(1);
    expect(await page.getByTestId("reminder-group").textContent()).toContain("4 צמחים");
    expect(await page.getByTestId("recent-update").first().textContent()).toContain("טיפול נגד אקריות");
    await page.getByTestId("reminder-group-open").click();
    expect(await page.getByTestId("reminder-group-item").count()).toBe(4);
    await shot("action-today");
    await page.getByTestId("reminder-group-item").first().getByRole("button", { name: "בוצע" }).click();
    await expect.poll(() => page.getByTestId("reminder-group").textContent(), { timeout: 10_000 }).toContain("3 צמחים");
    // No duplicates anywhere.
    expect(await events("treatment_started")).toHaveLength(4);
    expect((await A.pullAll()).filter((r) => r.entity === "health" && r.data.state !== "resolved")).toHaveLength(3);
  });

  it("cancel writes nothing", async () => {
    await go("/botanist");
    h.actionParse = { action: "fertilize", scope: "all", date_text: "אתמול" };
    await ask("דישנתי את כל הצמחים אתמול");
    await expect.poll(() => lastCard().getByTestId("action-title").textContent(), { timeout: 10_000 }).toBe("זיהיתי עדכון ל־4 צמחים 🌿");
    await lastCard().getByTestId("action-cancel").click();
    await expect.poll(() => page.getByTestId("action-status").last().textContent(), { timeout: 10_000 }).toContain("בוטל");
    expect(await events("fertilizing")).toHaveLength(0);
  });
});
