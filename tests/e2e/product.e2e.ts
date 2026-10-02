// Browser tests (headless Chromium emulating an iPhone viewport — NOT a real iPhone) for the
// 2026-10 product fixes: identification photo attachments and multiple pets (Light Meter: light-meter.e2e.ts).
// Real production build + real Worker (Miniflare) + Access-like JWT proxy; Anthropic is mocked.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExifApp1, readExif, withExif } from "../../src/shared/exif.ts";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = {
  A: { sub: "aaaaaaaa-1111-4000-8000-00000000000a", email: OWNER_EMAIL },
  B: { sub: "bbbbbbbb-1111-4000-8000-00000000000b", email: "pets@example.test" },
  C: { sub: "cccccccc-1111-4000-8000-00000000000c", email: "legacy-pets@example.test" },
};
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page;
let A: Client, B: Client, C: Client;
let plainJpeg: Buffer;

const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const signInAs = async (who: string) => { await ctx.clearCookies(); await ctx.addCookies([{ name: "tu", value: who, url: proxy.base }]); };
const body = () => page.textContent("body").then((t) => t ?? "");
const shot = async (name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };
const jpeg = (exif?: Parameters<typeof buildExifApp1>[0]) => (exif ? Buffer.from(withExif(new Uint8Array(plainJpeg), buildExifApp1(exif))) : plainJpeg);

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  B = await Client.signIn(h, PEOPLE.B);
  C = await Client.signIn(h, PEOPLE.C);
  await A.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("location", "loc-east", { id: "loc-east", name: "חלון מזרחי", kind: "indoor", createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "plant-1", { id: "plant-1", commonName: "פוטוס", status: "plant", ordinal: 1, locationId: "loc-east", createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "plant-2", { id: "plant-2", commonName: "מונסטרה", status: "plant", ordinal: 1, createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  // A profile saved by the previous app version: one pet per kind, no ids.
  await C.push([mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [{ kind: "dog", name: "רקס" }], interests: [], places: [], help: {}, onboardingStep: 6 })]);
  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL" });
  page = await ctx.newPage();
  await page.goto(`${proxy.base}/manifest.webmanifest`);
  plainJpeg = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d")!; g.fillStyle = "#3d6534"; g.fillRect(0, 0, 64, 48); g.fillStyle = "#e5ead3"; g.fillRect(8, 8, 20, 20); return c.toDataURL("image/jpeg", 0.9).split(",")[1]; }), "base64");
});
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

describe("plant identification photos", () => {
  beforeAll(async () => {
    await signInAs("A");
    await page.goto(`${proxy.base}/`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    await go("/identify");
    await page.getByTestId("photo-picker").waitFor();
  });
  const ready = () => page.$$eval('[data-testid="picked-image"][data-status="ready"] img', (imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth));

  it("identify is disabled until at least one image is attached", async () => {
    expect(await page.getByRole("button", { name: "לזהות" }).isDisabled()).toBe(true);
    expect(await body()).toContain("צריך לפחות תמונה אחת");
  });

  it("camera capture and library selection each attach images with a real preview", async () => {
    await page.getByTestId("input-camera").setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: jpeg({ exposureTime: [1, 120], fNumber: [178, 100], iso: 50, gps: true }) });
    await expect.poll(async () => (await ready()).length, { timeout: 10_000 }).toBe(1);
    await page.getByTestId("input-library").setInputFiles([
      { name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg({ gps: true }) },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: jpeg() },
    ]);
    await expect.poll(async () => (await ready()).length, { timeout: 10_000 }).toBe(3);
    expect((await ready()).every((w) => w > 0)).toBe(true); // previews actually decoded and rendered
    await shot("identify-3-photos");
    expect(await page.getByRole("button", { name: "לזהות" }).isDisabled()).toBe(false);
  });

  it("limit of four: extra files are refused with a message; add buttons disappear at the limit", async () => {
    await page.getByTestId("input-library").setInputFiles([
      { name: "c.jpg", mimeType: "image/jpeg", buffer: jpeg() },
      { name: "d.jpg", mimeType: "image/jpeg", buffer: jpeg() },
    ]);
    await expect.poll(async () => (await ready()).length, { timeout: 10_000 }).toBe(4);
    expect(await body()).toContain("אפשר לצרף עד 4 תמונות");
    expect(await page.getByRole("button", { name: "צילום במצלמה" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "בחירה מהגלריה" }).count()).toBe(0);
  });

  it("individual removal, then adding again until the limit", async () => {
    await page.getByRole("button", { name: "הסרת תמונה 2" }).click();
    await expect.poll(async () => (await ready()).length).toBe(3);
    expect(await page.getByRole("button", { name: "צילום במצלמה" }).count()).toBe(1);
    await page.getByTestId("input-camera").setInputFiles({ name: "again.jpg", mimeType: "image/jpeg", buffer: jpeg() });
    await expect.poll(async () => (await ready()).length).toBe(4);
  });

  it("non-images and unreadable files fail visibly (Hebrew), never silently", async () => {
    await page.getByRole("button", { name: "הסרת תמונה 4" }).click();
    await page.getByRole("button", { name: "הסרת תמונה 3" }).click();
    await page.getByTestId("input-library").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect.poll(body).toContain("הקובץ שנבחר אינו תמונה");
    await page.getByTestId("input-library").setInputFiles({ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0, 1, 2, 3]) });
    await expect.poll(body, { timeout: 10_000 }).toContain("לא הצלחנו לקרוא את התמונה");
    await page.locator('[data-testid="picked-image"][data-status="error"] button').click();
    await expect.poll(async () => (await ready()).length).toBe(2);
  });

  it("identify sends the actual image data (EXIF/GPS-free copies) to the Worker → Claude, and shows the result", async () => {
    h.anthropic.length = 0;
    await page.getByRole("button", { name: "לזהות" }).click();
    await expect.poll(() => h.anthropic.length, { timeout: 15_000 }).toBe(1);
    const sent = h.anthropic[0].body as { messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] };
    const imgs = sent.messages[0].content.filter((c) => c.type === "image");
    expect(imgs.length).toBe(2);
    for (const i of imgs) {
      const bytes = Buffer.from(i.source!.data, "base64");
      expect(i.source!.media_type).toBe("image/jpeg");
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
      expect(bytes.length).toBeGreaterThan(100); // a real image, not a blob: URL or placeholder
      expect(readExif(new Uint8Array(bytes)).hasGps).toBe(false);
      expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
    }
    await expect.poll(body, { timeout: 10_000 }).toContain("מועמדים לזיהוי");
    expect(await body()).toContain("Epipremnum aureum");
  });
});

// Light Meter (live camera): tests/e2e/light-meter.e2e.ts

describe("pets: several of the same kind", () => {
  const pets = async (c: Client) => ((await c.pullAll()).find((r) => r.entity === "profile")?.data.pets ?? []) as { id: string; kind: string; name: string | null }[];

  it("onboarding: two dogs with names, edit one, remove one, add a cat", async () => {
    await signInAs("B");
    await page.goto(`${proxy.base}/onboarding/2`);
    await page.getByTestId("pet-kinds").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "הוספת כלב" }).click();
    await page.getByRole("button", { name: "הוספת כלב" }).click();
    const names = page.getByRole("textbox", { name: "שם" });
    await expect.poll(() => names.count()).toBe(2);
    await names.nth(0).fill("מיקאסה");
    await names.nth(1).fill("בייליס");
    await page.getByRole("button", { name: "הוספת חתול" }).click();
    await expect.poll(async () => (await pets(B)).map((p) => `${p.kind}:${p.name ?? ""}`), { timeout: 15_000 }).toEqual(["dog:מיקאסה", "dog:בייליס", "cat:"]);
    await shot("pets-onboarding");
    const ids = (await pets(B)).map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    // Edit the second dog only.
    await names.nth(1).fill("ביילי");
    await expect.poll(async () => (await pets(B)).map((p) => p.name), { timeout: 15_000 }).toEqual(["מיקאסה", "ביילי", null]);
    // Remove the first dog only.
    await page.getByRole("button", { name: "הסרת מיקאסה" }).click();
    await expect.poll(async () => (await pets(B)).map((p) => p.id), { timeout: 15_000 }).toEqual([ids[1], ids[2]]);
  });

  it("persists after reload, and Settings edits the same list", async () => {
    await page.reload();
    await page.getByTestId("pet-list").waitFor({ timeout: 30_000 });
    expect(await page.getByTestId("pet-row").count()).toBe(2);
    await go("/settings");
    await expect.poll(body).toContain("ביילי");
    await page.getByText("חיות מחמד", { exact: true }).click();
    await page.getByRole("button", { name: "הוספת כלב" }).click();
    await page.getByRole("textbox", { name: "שם" }).nth(2).fill("מיקאסה");
    await page.getByRole("button", { name: "סיום" }).click();
    await expect.poll(async () => (await pets(B)).filter((p) => p.kind === "dog").map((p) => p.name), { timeout: 15_000 }).toEqual(["ביילי", "מיקאסה"]);
  });

  it("safety names every affected pet, judged by kind", async () => {
    await go("/find/species/monstera-deliciosa");
    await page.getByText("בטיחות", { exact: true }).first().click();
    const w = await page.getByTestId("pet-warning").textContent();
    expect(w).toContain("לא בטוח לביילי, לחתול ולמיקאסה");
    await shot("pets-safety");
  });

  it("an older one-per-kind profile is read without loss and can gain a second dog", async () => {
    await signInAs("C");
    await page.goto(`${proxy.base}/settings`);
    await expect.poll(body, { timeout: 30_000 }).toContain("רקס");
    await page.getByText("חיות מחמד", { exact: true }).click();
    await page.getByRole("button", { name: "הוספת כלב" }).click();
    await page.getByRole("textbox", { name: "שם" }).nth(1).fill("לוסי");
    await page.getByRole("button", { name: "סיום" }).click();
    await expect.poll(async () => (await pets(C)).map((p) => p.name), { timeout: 15_000 }).toEqual(["רקס", "לוסי"]);
    expect((await pets(C)).every((p) => typeof p.id === "string" && p.id.length > 0)).toBe(true);
    // Nobody else's pets appear for C.
    expect(await body()).not.toContain("ביילי");
  });
});

describe("general regression", () => {
  it("Hebrew RTL, five tabs, light and dark mode", async () => {
    await signInAs("A");
    await page.goto(`${proxy.base}/today`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    expect(await page.getAttribute("html", "dir")).toBe("rtl");
    const nav = await page.locator("nav").last().textContent();
    for (const tab of ["היום", "מצא צמח", "הצמחים שלי", "המיקומים שלי", "כלים"]) expect(nav).toContain(tab);
    await go("/settings");
    await page.getByText("כהה", { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    await page.getByText("בהיר", { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // no horizontal scroll at 393px
  });
});
