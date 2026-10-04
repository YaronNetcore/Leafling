// My Locations uses the user's PERSONAL plants only (headless Chromium at iPhone size — NOT a real iPhone).
// Collection: two plants of the same species (one with a personal name), plants without names, plants in
// different locations, a plant without a location, a personal photo; species that exist only in the general
// catalog (tomato, basil, lavender…) must never appear in these selectors.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = {
  A: { sub: "aaaaaaaa-6666-4000-8000-00000000000a", email: OWNER_EMAIL },
  B: { sub: "bbbbbbbb-6666-4000-8000-00000000000b", email: "loc-b@example.test" },
  C: { sub: "cccccccc-6666-4000-8000-00000000000c", email: "loc-c@example.test" },
};
const PHOTO = "5f1e6a8c-0d4b-4c7e-9a52-3b8d2f6c1a01";
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page;
let A: Client, B: Client, C: Client;
const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const signInAs = async (who: string) => { await ctx.clearCookies(); await ctx.addCookies([{ name: "tu", value: who, url: proxy.base }]); };
const body = () => page.textContent("body").then((t) => t ?? "");
const shot = async (name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };
const options = (testid: string) => page.$$eval(`[data-testid="${testid}"] [data-testid="plant-option"]`, (els) => els.map((e) => ({ id: e.getAttribute("data-plant-id")!, text: e.textContent ?? "" })));
const herePlants = () => page.$$eval('[data-testid="location-plant"]', (els) => els.map((e) => e.getAttribute("data-plant-id")));
const plantData = async (c: Client, id: string) => (await c.pullAll()).find((r) => r.entity === "plant" && r.id === id)!.data;
const GENERIC = ["עגבנייה", "בזיליקום", "לבנדר", "אנתוריום", "אלוקסיה", "אלוורה", "נענע"];

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  B = await Client.signIn(h, PEOPLE.B);
  C = await Client.signIn(h, PEOPLE.C);
  const prof = mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" });
  await A.push([
    prof,
    mut("location", "loc-living", { id: "loc-living", name: "סלון – ליד החלון", kind: "indoor", lightCategory: "bright_indirect", createdAt: "2026-10-01T00:00:00Z" }),
    mut("location", "loc-balcony", { id: "loc-balcony", name: "מרפסת", kind: "outdoor", createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "p-m1", { id: "p-m1", speciesId: "monstera-deliciosa", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 1, locationId: "loc-living", mainPhotoId: PHOTO, createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "p-m2", { id: "p-m2", speciesId: "monstera-deliciosa", commonName: "מונסטרה", scientificName: "Monstera deliciosa", nickname: "מוצי", status: "plant", ordinal: 2, locationId: "loc-balcony", createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "p-fern", { id: "p-fern", speciesId: "nephrolepis-exaltata", commonName: "שרך בוסטון", scientificName: "Nephrolepis exaltata", status: "plant", ordinal: 1, createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "p-dief", { id: "p-dief", speciesId: "dieffenbachia-seguine", commonName: "דיפנבכיה", scientificName: "Dieffenbachia seguine", status: "sick", ordinal: 1, locationId: "loc-living", createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  await A.push([
    mut("plant", "p-maranta", { id: "p-maranta", speciesId: "maranta-leuconeura", commonName: "מרנטה", scientificName: "Maranta leuconeura", status: "plant", ordinal: 1, locationId: "loc-balcony", createdAt: "2026-10-01T00:00:00Z" }),
    mut("photo", PHOTO, { id: PHOTO, plantId: "p-m1", mime: "image/jpeg", size: 4, sha256: "0".repeat(64), crc32: "00000000", width: 64, height: 48, uploadState: "uploaded", inJournal: true, capturedSource: "upload", createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL" });
  page = await ctx.newPage();
  // The personal photo (thumb) in private storage.
  const jpeg = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const g = c.getContext("2d")!; g.fillStyle = "#2f6b3a"; g.fillRect(0, 0, 64, 48); return c.toDataURL("image/jpeg").split(",")[1]; }), "base64");
  const up = await A.req(`/api/v1/photos/${PHOTO}/thumb`, { method: "PUT", body: jpeg, headers: { "content-type": "image/jpeg", "content-length": String(jpeg.length) } });
  if (!up.ok) throw new Error(`thumb upload ${up.status}`);
  for (const c of [B, C]) await c.push([prof]);
  await B.push([mut("plant", "plant-of-B", { id: "plant-of-B", commonName: "צמח של B", status: "plant", ordinal: 1 })]);
  await signInAs("A");
  await page.goto(`${proxy.base}/`);
  await page.waitForURL(/\/today/, { timeout: 30_000 });
}, 180_000);
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

describe("location detail — only my plants that are there", () => {
  it("shows exactly the plants assigned here, with personal name, species, status and personal photo", async () => {
    await go("/locations/loc-living");
    await expect.poll(herePlants, { timeout: 15_000 }).toEqual(expect.arrayContaining(["p-m1", "p-dief"]));
    expect((await herePlants()).sort()).toEqual(["p-dief", "p-m1"]);
    const t = (await page.getByTestId("location-plants").textContent()) ?? "";
    expect(t).toContain("מונסטרה");
    expect(t).toContain("Monstera deliciosa");
    expect(t).toContain("חולה"); // status of the dieffenbachia
    await expect.poll(() => page.locator(`[data-plant-id="p-m1"] img[src*="/api/v1/photos/${PHOTO}/thumb"], [data-plant-id="p-m1"] img[src^="blob:"]`).count(), { timeout: 10_000 }).toBe(1);
    for (const g of GENERIC) expect(t.includes(g), g).toBe(false);
    await shot("location-detail");
  });
});

describe("selectors use MY plants only", () => {
  it("'האם צמח שלי יתאים לכאן?' offers only my plant instances — same species stays separate, never catalog species", async () => {
    await page.getByTestId("location-fit-pick").click();
    await page.getByTestId("location-plant-picker").waitFor();
    const opts = await options("location-plant-picker");
    expect(opts.map((o) => o.id).sort()).toEqual(["p-dief", "p-fern", "p-m1", "p-m2", "p-maranta"]);
    const all = opts.map((o) => o.text).join("|");
    for (const g of GENERIC) expect(all.includes(g), g).toBe(false);
    expect(opts.find((o) => o.id === "p-m2")!.text).toContain("מוצי");
    expect(opts.find((o) => o.id === "p-m2")!.text).toContain("מונסטרה #2");
    expect(opts.find((o) => o.id === "p-m2")!.text).toContain("כרגע: מרפסת");
    expect(opts.find((o) => o.id === "p-m1")!.text).toContain("כבר כאן");
    expect(opts.find((o) => o.id === "p-fern")!.text).toContain("ללא מיקום");
    await shot("location-picker");
    await page.locator('[data-testid="location-plant-picker"] [data-plant-id="p-m2"]').click();
    await page.getByTestId("location-fit").waitFor();
    expect(await page.getByTestId("location-fit").textContent()).toContain("מוצי");
  });

  it("search inside the picker matches personal name / common / scientific name — and stays within my plants", async () => {
    // Make the collection large enough for the search box (> 6 plants).
    await A.push([1, 2].map((i) => mut("plant", `p-extra-${i}`, { id: `p-extra-${i}`, commonName: "פוטוס", scientificName: "Epipremnum aureum", status: "plant", ordinal: i, createdAt: "2026-10-01T00:00:00Z" })));
    await page.reload();
    await page.getByTestId("location-add-plant").waitFor({ timeout: 15_000 });
    await expect.poll(async () => { await page.getByTestId("location-add-plant").click(); const n = await page.getByPlaceholder("חיפוש בצמחים שלי…").count(); if (!n) await page.keyboard.press("Escape"); return n; }, { timeout: 20_000 }).toBe(1);
    const search = page.getByPlaceholder("חיפוש בצמחים שלי…");
    await search.fill("Monstera");
    expect((await options("location-plant-picker")).map((o) => o.id).sort()).toEqual(["p-m1", "p-m2"]);
    await search.fill("מוצי");
    expect((await options("location-plant-picker")).map((o) => o.id)).toEqual(["p-m2"]);
    await search.fill("עגבנייה"); // a catalog species I don't own → nothing (no catalog fallback)
    expect(await options("location-plant-picker")).toEqual([]);
    expect(await body()).toContain("לא נמצא צמח כזה בצמחים שלך");
    await page.keyboard.press("Escape");
  });
});

describe("adding a plant to a location = moving the existing plant", () => {
  it("plant elsewhere → confirm → the SAME record moves; history records it; the old location no longer shows it", async () => {
    const before = (await A.pullAll()).filter((r) => r.entity === "plant").length;
    await page.getByTestId("location-add-plant").click();
    await page.locator('[data-testid="location-plant-picker"] [data-plant-id="p-m2"]').click();
    await page.getByTestId("location-move-confirm").waitFor();
    expect(await page.getByTestId("location-move-confirm").textContent()).toContain("מרפסת");
    await shot("location-move-confirm");
    await page.getByRole("button", { name: /^להעביר ל/ }).click();
    await expect.poll(herePlants, { timeout: 10_000 }).toContain("p-m2");
    await expect.poll(async () => (await plantData(A, "p-m2")).locationId, { timeout: 15_000 }).toBe("loc-living");
    expect((await A.pullAll()).filter((r) => r.entity === "plant").length).toBe(before); // no duplicate plant
    const moves = (await A.pullAll()).filter((r) => r.entity === "event" && r.data.plantId === "p-m2" && r.data.type === "location_changed").map((r) => r.data.payload);
    expect(moves).toEqual([{ from: "loc-balcony", to: "loc-living" }]);
    await go("/locations/loc-balcony");
    await expect.poll(herePlants, { timeout: 10_000 }).toEqual(["p-maranta"]);
  });

  it("a plant without a location is assigned directly; a plant already here is left alone", async () => {
    await go("/locations/loc-balcony");
    await page.getByTestId("location-add-plant").click();
    await page.locator('[data-testid="location-plant-picker"] [data-plant-id="p-fern"]').click();
    await expect.poll(herePlants, { timeout: 10_000 }).toContain("p-fern");
    await expect.poll(async () => (await plantData(A, "p-fern")).locationId, { timeout: 15_000 }).toBe("loc-balcony");
    await page.getByTestId("location-add-plant").click();
    await page.locator('[data-testid="location-plant-picker"] [data-plant-id="p-maranta"]').click();
    await expect.poll(body).toContain("כבר כאן");
    const events = (await A.pullAll()).filter((r) => r.entity === "event" && r.data.plantId === "p-maranta" && r.data.type === "location_changed");
    expect(events).toHaveLength(0);
  });
});

describe("other personal selectors", () => {
  it("AI Botanist's plant choice lists only my plants", async () => {
    await go("/botanist");
    await page.getByRole("button", { name: "בחירת צמח" }).click();
    const ids = (await options("botanist-plant-picker")).map((o) => o.id).sort();
    expect(ids).toEqual(["p-dief", "p-extra-1", "p-extra-2", "p-fern", "p-m1", "p-m2", "p-maranta"]);
    await page.keyboard.press("Escape");
  });
});

describe("empty collection and other users", () => {
  it("no plants yet → a Hebrew empty state with a way to add one; no catalog species", async () => {
    await signInAs("C");
    await page.goto(`${proxy.base}/locations?new=1`);
    await page.getByPlaceholder('למשל: "סלון — ליד החלון", "מדף", "מרפסת"').fill("מדף");
    await page.getByRole("button", { name: "שמירה" }).click();
    await page.waitForURL(/\/locations\/[^/?]+$/, { timeout: 15_000 });
    await page.getByTestId("location-add-plant").click();
    await page.getByTestId("plant-picker-empty").waitFor();
    expect(await body()).toContain("אין עדיין צמחים ב'הצמחים שלי'");
    expect(await page.locator('[data-testid="plant-option"]').count()).toBe(0);
    await page.getByRole("button", { name: "הוספת צמח", exact: true }).click();
    await page.waitForURL(/\/plants\/new/);
    expect((await C.pullAll()).filter((r) => r.entity === "plant")).toHaveLength(0); // nothing created automatically
  });

  it("another user never sees or can pick my plants or locations", async () => {
    await signInAs("B");
    await page.goto(`${proxy.base}/locations/loc-living`);
    await expect.poll(body, { timeout: 15_000 }).toContain("המיקום לא נמצא");
    expect(await body()).not.toContain("מוצי");
    await go("/botanist");
    await page.getByRole("button", { name: "בחירת צמח" }).click();
    expect((await options("botanist-plant-picker")).map((o) => o.id)).toEqual(["plant-of-B"]);
  });
});
