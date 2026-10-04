// Browser tests for the LIVE, AUTOMATIC Light Meter (headless Chromium emulating an iPhone 393×852 viewport — NOT a
// real iPhone/Safari). Real production build + real Worker (Miniflare) + Access-like JWT proxy.
// Scenes are drawn into the fake camera: a crisp shadow edge (direct light), a soft wide shadow (bright indirect),
// an even surface (no shadow), darkness (camera limit), shadows only OUTSIDE the target circle, and flicker.
// The camera: getUserMedia is wrapped so each test can choose a real MediaStream from a canvas
// (canvas.captureStream → real tracks, real <video> playback) with a controlled scene, or a failure; one test
// passes through to Chromium's own fake camera device (real getUserMedia path).
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAccessProxy } from "../helpers/proxy.ts";
import { Client, OWNER_EMAIL, mut, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const PEOPLE: Record<string, Person> = {
  A: { sub: "aaaaaaaa-2222-4000-8000-00000000000a", email: OWNER_EMAIL },
  B: { sub: "bbbbbbbb-2222-4000-8000-00000000000b", email: "light-b@example.test" },
};
let h: Harness, proxy: { base: string; close: () => void }, browser: Browser, ctx: BrowserContext, page: Page;
let A: Client, B: Client;
const apiCalls: string[] = [];

const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);
const signInAs = async (who: string) => { await ctx.clearCookies(); await ctx.addCookies([{ name: "tu", value: who, url: proxy.base }]); };
const body = () => page.textContent("body").then((t) => t ?? "");
const shot = async (name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); };
const camState = () => page.getByTestId("light-preview").getAttribute("data-state");
const setCam = (patch: Record<string, unknown>) => page.evaluate((p) => Object.assign((window as never as { __cam: object }).__cam, p), patch);
const tracks = () => page.evaluate(() => (window as never as { __cam: { tracks: MediaStreamTrack[] } }).__cam.tracks.map((t) => t.readyState));
const calls = () => page.evaluate(() => (window as never as { __cam: { calls: number } }).__cam.calls);
const lights = async (c: Client) => (await c.pullAll()).filter((r) => r.entity === "light").map((r) => r.data as Record<string, unknown>);
const openMeter = async (path = "/tools/light") => { await go("/tools"); await go(path); await expect.poll(camState, { timeout: 15_000 }).toBe("live"); };
const category = () => page.getByTestId("light-live").getAttribute("data-category");
const position = async () => Number(await page.getByTestId("light-live").getAttribute("data-position"));
const scene = async (mode: string, expected?: string) => { await setCam({ mode }); if (expected) await expect.poll(category, { timeout: 8000 }).toBe(expected); };
const localCounts = () => page.evaluate(async () => {
  const names = (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("leafling-u-"));
  let photos = 0, blobs = 0;
  for (const n of names) {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(n); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const count = (s: string) => db.objectStoreNames.contains(s) ? new Promise<number>((res) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => res(q.result); }) : Promise.resolve(0);
    photos += await count("photos"); blobs += await count("blobs");
    db.close();
  }
  return { photos, blobs };
});

// Installed before any page script: a controllable camera.
const FAKE_CAMERA = () => {
  const cam = { mode: "normal", fail: null as string | null, passthrough: false, calls: 0, constraints: [] as unknown[], tracks: [] as MediaStreamTrack[] };
  (window as never as { __cam: typeof cam }).__cam = cam;
  const md = navigator.mediaDevices;
  if (!md) return;
  const real = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    cam.calls++; cam.constraints.push(JSON.parse(JSON.stringify(c ?? {})));
    if (cam.fail) throw new DOMException("simulated", cam.fail);
    if (cam.passthrough) { const s = await real(c); cam.tracks.push(...s.getTracks()); return s; }
    const cv = document.createElement("canvas"); cv.width = 160; cv.height = 120;
    const g = cv.getContext("2d")!;
    let t = 0;
    const draw = () => {
      t++;
      const fill = (css: string, x = 0, y = 0, w = 160, hh = 120) => { g.fillStyle = css; g.fillRect(x, y, w, hh); };
      if (cam.mode === "dark") fill("rgb(8,9,8)");
      else if (cam.mode === "crisp") { fill("rgb(215,215,215)"); fill("rgb(55,55,55)", 0, 0, 80, 120); } // sharp shadow edge through the centre
      else if (cam.mode === "soft") { for (let x = 0; x < 160; x++) { const v = Math.round(215 - 80 * Math.min(1, Math.max(0, (x - 55) / 50))); fill(`rgb(${v},${v},${v})`, x, 0, 1, 120); } } // wide penumbra
      else if (cam.mode === "even") fill("rgb(185,185,185)");
      else if (cam.mode === "outside") { fill("rgb(200,200,200)"); fill("rgb(30,30,30)", 0, 0, 50, 120); fill("rgb(30,30,30)", 110, 0, 50, 120); } // shadows visible, but outside the circle
      else if (cam.mode === "flicker") { if (Math.floor(t / 3) % 2) { fill("rgb(215,215,215)"); fill("rgb(55,55,55)", 0, 0, 80, 120); } else fill("rgb(185,185,185)"); }
      else { fill("rgb(110,125,95)"); fill("rgb(170,160,140)", 20 + (t % 40), 30, 60, 50); }
      g.fillStyle = t % 2 ? "rgb(9,9,9)" : "rgb(10,10,10)"; g.fillRect(0, 0, 1, 1); // keep frames flowing
    };
    draw();
    const s = cv.captureStream(30);
    const iv = setInterval(draw, 33);
    for (const tr of s.getTracks()) { const stop = tr.stop.bind(tr); tr.stop = () => { clearInterval(iv); stop(); }; cam.tracks.push(tr); }
    return s;
  };
};

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true });
  A = await Client.signIn(h, PEOPLE.A);
  B = await Client.signIn(h, PEOPLE.B);
  await A.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("location", "loc-east", { id: "loc-east", name: "חלון מזרחי", kind: "indoor", createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "plant-1", { id: "plant-1", commonName: "פוטוס", status: "plant", ordinal: 1, locationId: "loc-east", createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "plant-2", { id: "plant-2", commonName: "מונסטרה", scientificName: "Monstera deliciosa", status: "plant", ordinal: 1, createdAt: "2026-10-01T00:00:00Z" }),
    mut("plant", "plant-3", { id: "plant-3", commonName: "מונסטרה", scientificName: "Monstera deliciosa", nickname: "מוצי", status: "plant", ordinal: 2, createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  await B.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("plant", "plant-of-B", { id: "plant-of-B", commonName: "צמח של B", status: "plant", ordinal: 1 }),
  ]);
  proxy = await startAccessProxy(h, PEOPLE);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL" });
  await ctx.grantPermissions(["camera"]);
  await ctx.addInitScript(FAKE_CAMERA);
  page = await ctx.newPage();
  page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await signInAs("A");
  await page.goto(`${proxy.base}/`);
  await page.waitForURL(/\/today/, { timeout: 30_000 });
});
afterAll(async () => { await browser?.close(); proxy?.close(); await h?.mf.dispose(); });

describe("live automatic measurement", () => {
  it("כלים → מד אור: live rear camera with a target circle; the reading starts by itself — no button, no photo, no manual choice", async () => {
    await go("/tools");
    await page.getByText("מד אור", { exact: true }).click();
    await page.waitForURL(/\/tools\/light/);
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    const v = await page.getByTestId("light-preview").evaluate((el) => {
      const video = el as HTMLVideoElement;
      return { live: (video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.readyState, playsinline: video.hasAttribute("playsinline"), muted: video.muted, paused: video.paused };
    });
    expect(v).toMatchObject({ live: "live", playsinline: true, muted: true, paused: false });
    await page.getByTestId("light-target").waitFor();
    await scene("soft", "bright_indirect"); // measured and classified without any tap
    const t = await body();
    expect(t).toContain("המדידה רציפה — בלי לצלם");
    expect(t).toContain("לא לוקס");
    expect(t).not.toMatch(/\d+\s*(lux|לוקס)/i);
    expect(await page.getByRole("button", { name: "מדדי אור" }).count()).toBe(0);
    expect(await page.locator('[role="radio"]').count()).toBe(0); // no manual category selection
    expect(await page.locator('input[type="file"], [capture]').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("light-auto-bright");
  });

  it("moving to a different scene updates the reading and category automatically", async () => {
    await scene("crisp", "direct");
    const pDirect = await position();
    await shot("light-auto-direct");
    await scene("even", "no_shadow");
    const pEven = await position();
    await scene("dark", "low");
    expect(await page.getByTestId("light-confidence").textContent()).toContain("ודאות גבוהה");
    const pDark = await position();
    expect(pDirect).toBeGreaterThan(pEven);
    expect(pEven).toBeGreaterThan(pDark);
    await scene("soft", "bright_indirect");
    expect(await page.getByTestId("light-confidence").textContent()).toContain("ודאות בינונית"); // never 'high' without calibration
  });

  it("the circle IS the analysed area: shadows visible only outside it do not count", async () => {
    await scene("outside", "no_shadow");
    await scene("crisp", "direct");
  });

  it("stable under flicker: the category does not jump with every frame", async () => {
    await scene("flicker");
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) { seen.push((await category()) ?? ""); await new Promise((r) => setTimeout(r, 100)); }
    const changes = seen.filter((c, i) => i > 0 && c !== seen[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(2);
  });

  it("'שייכי לצמח' lists ONLY my plants (same species stays separate, personal names first) and saves the frozen automatic reading once — no photo stored or uploaded", async () => {
    await scene("soft", "bright_indirect");
    const before = await localCounts();
    apiCalls.length = 0;
    await page.getByTestId("light-assign").click();
    await page.getByTestId("light-plant-picker").waitFor();
    const opts = await page.$$eval('[data-testid="light-plant-picker"] [data-testid="plant-option"]', (els) => els.map((e) => ({ id: e.getAttribute("data-plant-id"), text: e.textContent ?? "" })));
    expect(opts.map((o) => o.id).sort()).toEqual(["plant-1", "plant-2", "plant-3"]);
    expect(opts.find((o) => o.id === "plant-3")!.text).toContain("מוצי");
    expect(opts.find((o) => o.id === "plant-3")!.text).toContain("Monstera deliciosa");
    expect(opts.find((o) => o.id === "plant-1")!.text).toContain("כרגע: חלון מזרחי");
    await shot("light-picker");
    await page.locator('[data-plant-id="plant-1"]').dblclick(); // a double tap must not save twice
    await page.waitForURL(/\/plants\/plant-1/, { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 1200));
    await expect.poll(async () => (await lights(A)).filter((r) => r.method === "camera_live_auto").length, { timeout: 15_000 }).toBe(1);
    const r = (await lights(A)).find((x) => x.method === "camera_live_auto")!;
    expect(r).toMatchObject({ plantId: "plant-1", locationId: "loc-east", category: "bright_indirect", estimate: true, confidence: "medium" });
    expect(r.lux ?? null).toBeNull();
    expect((r.relative as { shadowContrast: number }).shadowContrast).toBeGreaterThan(1.8);
    await expect.poll(body).toContain("מדידה אוטומטית במצלמה");
    expect((await tracks()).every((s) => s === "ended")).toBe(true);
    expect((await A.pullAll()).filter((x) => x.entity === "photo")).toHaveLength(0);
    expect(await localCounts()).toEqual(before);
    expect(apiCalls.filter((c) => c.includes("/photos"))).toEqual([]);
  });

  it("opened from a plant: one tap saves to that plant", async () => {
    await page.getByRole("button", { name: "מד אור" }).first().click();
    await page.waitForURL(/\/tools\/light\?plant=plant-1/);
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    await scene("crisp", "direct");
    await page.getByTestId("light-save-preset").click();
    await page.waitForURL(/\/plants\/plant-1$/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(A)).filter((r) => r.method === "camera_live_auto" && r.category === "direct").length, { timeout: 15_000 }).toBe(1);
  });

  it("opened from a location: can save to the location only, or to one of my plants there", async () => {
    await openMeter("/tools/light?location=loc-east");
    await scene("even", "no_shadow");
    await page.getByTestId("light-save-location").click();
    await page.waitForURL(/\/locations\/loc-east/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(A)).filter((r) => r.method === "camera_live_auto" && r.plantId == null).length, { timeout: 15_000 }).toBe(1);
    const r = (await lights(A)).find((x) => x.method === "camera_live_auto" && x.plantId == null)!;
    expect(r).toMatchObject({ locationId: "loc-east", category: "low", confidence: "low" }); // "no clear shadow" is saved honestly as low/low
    expect((r.relative as { noShadow: boolean }).noShadow).toBe(true);
  });
});

describe("camera lifecycle and failures", () => {
  it("leaving the screen stops every track", async () => {
    await go("/tools"); await openMeter();
    expect(await tracks()).toContain("live");
    await go("/tools");
    await expect.poll(async () => (await tracks()).every((s) => s === "ended")).toBe(true);
  });

  it("app hidden → camera released; visible again → resumes", async () => {
    await openMeter();
    const vis = (state: string) => page.evaluate((s) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s }); document.dispatchEvent(new Event("visibilitychange")); }, state);
    await vis("hidden");
    await expect.poll(async () => (await tracks()).every((s) => s === "ended")).toBe(true);
    expect(await camState()).toBe("off");
    await vis("visible");
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    await go("/tools");
    await expect.poll(async () => (await tracks()).every((s) => s === "ended")).toBe(true);
  });

  it("the system ending the camera (call, other app) shows a Hebrew message with a retry", async () => {
    await openMeter();
    await page.evaluate(() => { const t = (window as never as { __cam: { tracks: MediaStreamTrack[] } }).__cam.tracks.at(-1)!; t.stop(); t.dispatchEvent(new Event("ended")); });
    await page.getByTestId("light-camera-problem").waitFor();
    expect(await body()).toContain("המצלמה נעצרה");
    await page.getByRole("button", { name: "לנסות שוב" }).click();
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    await go("/tools");
  });

  it("permission denied → clear Hebrew explanation, no silent fallback to photo capture; retry works once allowed", async () => {
    await setCam({ fail: "NotAllowedError" });
    await go("/tools/light");
    await page.getByTestId("light-camera-problem").waitFor();
    const t = await body();
    expect(t).toContain("אין הרשאה למצלמה");
    expect(await page.locator('input[type="file"]').count()).toBe(0);
    expect(await page.getByTestId("light-assign").count()).toBe(0);
    await shot("light-denied");
    await setCam({ fail: null });
    await page.getByRole("button", { name: "לנסות שוב" }).click();
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    await go("/tools");
  });

  it("no camera / camera busy / unsupported browser → each explained in Hebrew", async () => {
    await setCam({ fail: "NotFoundError" });
    await go("/tools/light");
    await page.getByTestId("light-camera-problem").waitFor();
    expect(await body()).toContain("לא נמצאה מצלמה");
    expect(await page.getByRole("button", { name: "לנסות שוב" }).count()).toBe(0);
    await go("/tools");
    await setCam({ fail: "NotReadableError" });
    await go("/tools/light");
    await expect.poll(body).toContain("המצלמה תפוסה");
    await go("/tools");
    await setCam({ fail: null });
    await page.evaluate(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined }));
    await go("/tools/light");
    await expect.poll(body).toContain("הדפדפן הזה לא מאפשר מצלמה חיה");
    expect(await page.locator('input[type="file"]').count()).toBe(0);
  });

  it("the real getUserMedia path (Chromium's fake camera device) runs the same flow", async () => {
    await page.goto(`${proxy.base}/today`); // fresh page: real mediaDevices again
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    await setCam({ passthrough: true });
    await openMeter();
    expect(await page.getByTestId("light-preview").evaluate((el) => (el as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await expect.poll(category, { timeout: 8000 }).not.toBe(""); // Chromium's fake device: a reading appears by itself
    await go("/tools");
    await expect.poll(async () => (await tracks()).every((s) => s === "ended")).toBe(true);
  });
});

describe("per-user isolation", () => {
  it("B's picker shows only B's plants; nothing of A", async () => {
    await signInAs("B");
    await page.goto(`${proxy.base}/today`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    await openMeter();
    await scene("soft", "bright_indirect");
    await page.getByTestId("light-assign").click();
    const ids = await page.$$eval('[data-testid="light-plant-picker"] [data-testid="plant-option"]', (els) => els.map((e) => e.getAttribute("data-plant-id")));
    expect(ids).toEqual(["plant-of-B"]);
    expect(await body()).not.toContain("מוצי");
    await page.locator('[data-plant-id="plant-of-B"]').click();
    await page.waitForURL(/\/plants\/plant-of-B/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(B)).length, { timeout: 15_000 }).toBe(1);
    expect(JSON.stringify(await lights(B))).not.toContain("plant-1");
    expect((await lights(A)).every((r) => r.plantId !== "plant-of-B")).toBe(true);
  });
});
