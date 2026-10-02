// Browser tests (headless Chromium emulating an iPhone viewport — NOT a real iPhone) for the
// 2026-10 product fixes: identification photo attachments and multiple pets (Light Meter: light-meter.e2e.ts).
// Real production build + real Worker (Miniflare) + Access-like JWT proxy; Anthropic is mocked.
import { createHash } from "node:crypto";
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

describe("identification → my plants (original photos carried over)", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  it("identifying without adding stores nothing", async () => {
    const before = (await A.pullAll()).filter((r) => r.entity === "photo").length;
    await go("/today"); await go("/identify");
    await page.getByTestId("input-library").setInputFiles({ name: "x.jpg", mimeType: "image/jpeg", buffer: jpeg() });
    await page.getByRole("button", { name: "לזהות" }).click();
    await expect.poll(body, { timeout: 15_000 }).toContain("מועמדים לזיהוי");
    await go("/today");
    await new Promise((r) => setTimeout(r, 800));
    expect((await A.pullAll()).filter((r) => r.entity === "photo").length).toBe(before);
  });

  it("camera + gallery originals become the new plant's photos (first = main), byte-identical, once each, uploaded to private storage", async () => {
    const cameraShot = jpeg({ exposureTime: [1, 60], fNumber: [178, 100], iso: 100, gps: true });
    const galleryShot = jpeg({ exposureTime: [1, 200], fNumber: [178, 100], iso: 50 });
    await go("/today"); await go("/identify");
    await page.getByTestId("input-camera").setInputFiles({ name: "cam.jpg", mimeType: "image/jpeg", buffer: cameraShot });
    await page.getByTestId("input-library").setInputFiles([{ name: "gal.jpg", mimeType: "image/jpeg", buffer: galleryShot }, { name: "dup.jpg", mimeType: "image/jpeg", buffer: galleryShot }]);
    await expect.poll(async () => page.locator('[data-testid="picked-image"][data-status="ready"]').count(), { timeout: 10_000 }).toBe(3);
    await page.getByRole("button", { name: "לזהות" }).click();
    await page.getByTestId("identify-add").first().waitFor({ timeout: 15_000 });
    await page.getByTestId("identify-add").first().click();
    await page.waitForURL(/\/plants\/new/);
    await page.getByTestId("carried-photos").waitFor();
    await expect.poll(() => page.locator('[data-testid="carried-photos"] img').count(), { timeout: 10_000 }).toBe(3);
    await shot("identify-carried-photos");
    await page.getByTestId("carried-continue").click();
    await page.getByRole("button", { name: /^צמח/ }).first().click();
    await page.getByRole("button", { name: "שמירת הצמח" }).click();
    await page.waitForURL(/\/plants\/(?!new)[^/?]+$/, { timeout: 15_000 });
    const plantId = new URL(page.url()).pathname.split("/").pop()!;
    await expect.poll(async () => (await A.pullAll()).filter((r) => r.entity === "photo" && r.data.plantId === plantId).length, { timeout: 20_000 }).toBe(2);
    const all = await A.pullAll();
    const photos = all.filter((r) => r.entity === "photo" && r.data.plantId === plantId).map((r) => r.data);
    expect(new Set(photos.map((p) => p.sha256))).toEqual(new Set([sha(cameraShot), sha(galleryShot)])); // originals, duplicate stored once
    const plant = all.find((r) => r.entity === "plant" && r.id === plantId)!.data;
    expect(photos.find((p) => p.id === plant.mainPhotoId)!.sha256).toBe(sha(cameraShot)); // the first image is the main one
    await expect.poll(async () => (await A.pullAll()).filter((r) => r.entity === "photo" && r.data.plantId === plantId && r.data.uploadState === "uploaded").length, { timeout: 20_000 }).toBe(2);
    const stored = await A.req(`/api/v1/photos/${plant.mainPhotoId}/original`);
    expect(stored.status).toBe(200);
    expect(sha(Buffer.from(await stored.arrayBuffer()))).toBe(sha(cameraShot)); // byte-identical original in R2
    expect((await B.req(`/api/v1/photos/${plant.mainPhotoId}/original`)).status).toBe(404);
    // Shown on the new plant (its own photo, not a species picture).
    await expect.poll(async () => page.locator('img[src^="blob:"], img[src*="/api/v1/photos/"]').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  });
});

describe("plant catalog", () => {
  const results = () => page.$$eval('[data-testid="species-result"]', (els) => els.map((e) => (e.textContent ?? "").trim()));
  const search = async (q: string) => { await page.getByPlaceholder("מונסטרה, Pothos, בזיליקום…").fill(q); await new Promise((r) => setTimeout(r, 150)); return results(); };
  it("search finds plants by Hebrew, English, scientific names, synonyms and less-common species", async () => {
    await signInAs("A");
    await page.goto(`${proxy.base}/find`);
    await page.waitForURL(/\/find/, { timeout: 30_000 });
    await expect.poll(async () => Number(((await page.getByTestId("catalog-count").textContent()) ?? "").match(/\d+/)?.[0] ?? 0), { timeout: 15_000 }).toBeGreaterThanOrEqual(264);
    expect(await search("קלתאה")).toContain("קלתאה אורביפוליה");
    expect(await search("fiddle")).toContain("פיקוס כינורי");
    expect((await search("Platycerium"))[0]).toBe("קרן צבי");
    expect((await search("Calathea orbifolia"))[0]).toBe("קלתאה אורביפוליה");
    expect(await search("Thai Constellation")).toContain("מונסטרה תאי קונסטליישן");
    expect((await search("מונסטרה"))[0]).toBe("מונסטרה"); // the curated page first
    await shot("catalog-search");
  });

  it("a catalog page shows only known facts, provenance, a botanical placeholder and LTR scientific names", async () => {
    await search("Calathea orbifolia");
    await page.locator('[data-testid="species-result"]').first().click();
    await page.getByTestId("catalog-page").waitFor();
    const t = await body();
    expect(t).toContain("Goeppertia orbifolia");
    expect(t).toContain("Calathea orbifolia"); // synonym
    expect(t).toContain("טיוטה שטרם אומתה");
    expect(t).toContain("רשימת ASPCA");
    expect(await page.getByTestId("catalog-placeholder").count()).toBeGreaterThan(0);
    expect(await page.locator(".sci").first().evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    expect(await page.getByTestId("catalog-care").textContent()).not.toContain("זריעה"); // no sowing data → no sowing row
    await shot("catalog-page");
  });

  it("adding a catalog plant links it to the catalog and its care appears on the plant", async () => {
    await page.getByRole("button", { name: "הוסף לצמחים שלי" }).click();
    await page.waitForURL(/\/plants\/new\?species=goeppertia-orbifolia/);
    await page.getByRole("button", { name: "דלגי בינתיים" }).click();
    await page.getByRole("button", { name: /^צמח/ }).first().click();
    await page.getByRole("button", { name: "שמירת הצמח" }).click();
    await page.waitForURL(/\/plants\/(?!new)[^/?]+$/, { timeout: 15_000 });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await expect.poll(async () => (await A.pullAll()).find((r) => r.id === id)?.data, { timeout: 15_000 }).toMatchObject({ speciesId: "goeppertia-orbifolia", commonName: "קלתאה אורביפוליה", scientificName: "Goeppertia orbifolia" });
    await expect.poll(async () => page.getByTestId("catalog-care").count(), { timeout: 10_000 }).toBe(1);
  });

  it("AI identification of a plant that is not in the catalog stays usable (not 'does not exist')", async () => {
    h.aiCandidates = [{ name_he: "ולוויצ'יה", scientific: "Welwitschia mirabilis", confidence: "possible", why: "test" }, { name_he: "קלתאה", scientific: "Calathea orbifolia", confidence: "possible", why: "test" }];
    try {
      await go("/today"); await go("/identify");
      await page.getByTestId("input-library").setInputFiles({ name: "w.jpg", mimeType: "image/jpeg", buffer: jpeg() });
      await page.getByRole("button", { name: "לזהות" }).click();
      await page.getByTestId("identify-not-in-catalog").waitFor({ timeout: 15_000 });
      const t = await body();
      expect(t).toContain("Welwitschia mirabilis");
      expect(t).toContain("הזן עוד לא במאגר של Leafling");
      expect(t).toContain("קלתאה אורביפוליה — לעמוד הזן"); // the synonym candidate is matched to the catalog
      await page.getByRole("button", { name: 'הוספה בשם "ולוויצ\'יה"' }).click();
      await page.waitForURL(/\/plants\/new\?name=/);
      expect(await body()).toContain("ולוויצ'יה");
    } finally { h.aiCandidates = undefined; }
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

  it("removed standalone tools are gone; their abilities remain in Diagnose / AI Botanist", async () => {
    await go("/tools");
    await expect.poll(body).toContain("מד אור");
    const t = await body();
    for (const gone of ["זיהוי מזיקים", "מה זה הדבר הזה?", "בונה תערובת מצע"]) expect(t.includes(gone), gone).toBe(false);
    await go("/tools/soil");
    await expect.poll(body).toContain("עזרה מעשית לגידול"); // unknown tool → the tools list
  });
});
