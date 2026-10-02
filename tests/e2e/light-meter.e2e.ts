// Browser tests for the LIVE-camera Light Meter (headless Chromium emulating an iPhone 393×852 viewport — NOT a
// real iPhone/Safari). Real production build + real Worker (Miniflare) + Access-like JWT proxy.
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
const measure = async () => { await page.getByTestId("light-measure").click(); await page.getByTestId("light-result").waitFor({ timeout: 15_000 }); };
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
      else if (cam.mode === "bright") { fill("rgb(120,130,110)"); fill("#fff", 0, 0, 160, 40); }
      else if (cam.mode === "flicker") { const v = Math.floor(t / 4) % 2 ? 40 : 215; fill(`rgb(${v},${v},${v})`); }
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
    mut("plant", "plant-2", { id: "plant-2", commonName: "מונסטרה", status: "plant", ordinal: 1, createdAt: "2026-10-01T00:00:00Z" }),
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

describe("live camera inside Leafling", () => {
  it("כלים → מד אור opens a live rear-camera preview (inline, muted), no photo input", async () => {
    await go("/tools");
    await page.getByText("מד אור", { exact: true }).click();
    await page.waitForURL(/\/tools\/light/);
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    const v = await page.getByTestId("light-preview").evaluate((el) => {
      const video = el as HTMLVideoElement;
      const s = video.srcObject as MediaStream | null;
      return { live: s?.getVideoTracks()[0]?.readyState, w: video.videoWidth, playsinline: video.hasAttribute("playsinline"), muted: video.muted, paused: video.paused };
    });
    expect(v).toMatchObject({ live: "live", playsinline: true, muted: true, paused: false });
    expect(v.w).toBeGreaterThan(0);
    const c = await page.evaluate(() => (window as never as { __cam: { constraints: { audio: boolean; video: { facingMode: unknown } }[] } }).__cam.constraints.at(-1));
    expect(c).toMatchObject({ audio: false, video: { facingMode: { ideal: "environment" } } });
    const t = await body();
    expect(t).toContain("כווני את הטלפון למקום שבו הצמח נמצא");
    expect(t).toContain("המדידה מתבצעת בזמן אמת — אין צורך לצלם תמונה.");
    expect(await page.getByRole("button", { name: "מדדי אור" }).count()).toBe(1);
    expect(await page.locator('input[type="file"]').count()).toBe(0); // never the native photo capture
    expect(await page.locator("[capture]").count()).toBe(0);
    for (const bad of ["לוקס", "lux", "שאלון"]) expect(t.includes(bad), bad).toBe(false);
    // iPhone layout: no horizontal overflow; a large preview; a comfortable touch target.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = (await page.getByTestId("light-preview").boundingBox())!;
    expect(box.width).toBeGreaterThan(330);
    expect((await page.getByTestId("light-measure").boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await shot("light-live-preview");
  });

  it("measuring samples the live stream ('מודדת את האור…'), then releases the camera; an ordinary scene is honestly undetermined", async () => {
    await page.getByTestId("light-measure").click();
    await page.getByTestId("light-measuring").waitFor();
    expect(await body()).toContain("מודדת את האור…");
    expect(await tracks()).toContain("live"); // preview stays live while sampling
    await page.getByTestId("light-result").waitFor({ timeout: 15_000 });
    expect(await page.getByTestId("light-result").getAttribute("data-verdict")).toBe("undetermined");
    expect((await tracks()).every((s) => s === "ended")).toBe(true); // no camera left running
    const t = await body();
    expect(t).toContain("המצלמה לא יכולה לדעת כמה אור יש כאן");
    expect(t).not.toMatch(/\d+\s*(lux|לוקס)/i);
    expect(await page.locator('[role="radio"][aria-checked="true"]').count()).toBe(0); // nothing guessed for the user
    await shot("light-undetermined");
  });

  it("the user's choice is saved once to the chosen plant (and its location) as her estimate — no photo stored or uploaded", async () => {
    const before = await localCounts();
    apiCalls.length = 0;
    await page.getByTestId("light-user-choice").getByText("אור בינוני").click();
    await page.getByTestId("light-plant").selectOption("plant-1");
    expect(await body()).toContain('יתווסף להיסטוריה של פוטוס וגם לפרופיל האור של "חלון מזרחי"');
    await shot("light-assign");
    await page.getByRole("button", { name: "שמירה" }).click();
    await page.waitForURL(/\/plants\/plant-1/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(A)).length, { timeout: 15_000 }).toBe(1);
    expect((await lights(A))[0]).toMatchObject({ plantId: "plant-1", locationId: "loc-east", category: "medium", method: "camera_live_user", estimate: true });
    expect((await lights(A))[0].lux ?? null).toBeNull();
    await expect.poll(async () => (await A.pullAll()).find((r) => r.id === "loc-east")!.data.lightCategory, { timeout: 15_000 }).toBe("medium");
    // Individual plant memory shows it, with its source.
    await expect.poll(body).toContain("הערכה שלך במד האור");
    // No photo anywhere: no photo records, no local blobs, no photo upload.
    expect((await A.pullAll()).filter((r) => r.entity === "photo")).toHaveLength(0);
    expect(await localCounts()).toEqual(before);
    expect(apiCalls.filter((c) => c.includes("/photos"))).toEqual([]);
  });

  it("opened from a plant: plant preselected; a dark scene at the camera's limit → 'אור חלש' estimate", async () => {
    await page.getByRole("button", { name: "מד אור" }).first().click();
    await page.waitForURL(/\/tools\/light\?plant=plant-1/);
    await setCam({ mode: "dark" });
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    await measure();
    expect(await page.getByTestId("light-result").getAttribute("data-verdict")).toBe("dark");
    const t = await body();
    expect(t).toContain("הערכה");
    expect(t).toContain("אור חלש");
    expect(t).toContain("לא מדידה של מד אור מכויל");
    expect(await page.getByTestId("light-plant").inputValue()).toBe("plant-1");
    await shot("light-dark");
    await page.getByRole("button", { name: "שמירה" }).click();
    await page.waitForURL(/\/plants\/plant-1/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(A)).filter((r) => r.method === "camera_live_dark").length, { timeout: 15_000 }).toBe(1);
    expect((await lights(A)).find((r) => r.method === "camera_live_dark")).toMatchObject({ category: "low", plantId: "plant-1", estimate: true });
    await setCam({ mode: "normal" });
  });

  it("opened from a location: the location is kept even for a plant elsewhere", async () => {
    await openMeter("/tools/light?location=loc-east");
    await measure();
    await page.getByTestId("light-user-choice").getByText("אור חזק").click();
    await page.getByTestId("light-plant").selectOption("plant-2"); // a plant with no location
    expect(await body()).toContain('לפרופיל האור של "חלון מזרחי"');
    await page.getByRole("button", { name: "שמירה" }).click();
    await page.waitForURL(/\/plants\/plant-2/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(A)).filter((r) => r.plantId === "plant-2").length, { timeout: 15_000 }).toBe(1);
    expect((await lights(A)).find((r) => r.plantId === "plant-2")).toMatchObject({ locationId: "loc-east", category: "bright_indirect", method: "camera_live_user" });
  });

  it("very bright areas are a hint only — never an automatic 'direct sun'", async () => {
    await setCam({ mode: "bright" });
    await openMeter();
    await measure();
    expect(await page.getByTestId("light-result").getAttribute("data-verdict")).toBe("undetermined");
    await page.getByTestId("light-bright-areas").waitFor();
    expect(await page.locator('[role="radio"][aria-checked="true"]').count()).toBe(0);
    await setCam({ mode: "normal" });
  });

  it("unreliable input (light changing during sampling) → asks to measure again; 'למדוד שוב' restarts the live camera", async () => {
    await setCam({ mode: "flicker" });
    await go("/tools"); await openMeter();
    await measure();
    expect(await page.getByTestId("light-result").getAttribute("data-verdict")).toBe("unstable");
    expect(await body()).toContain("האור השתנה בזמן המדידה");
    expect(await page.getByRole("button", { name: "שמירה" }).count()).toBe(0);
    await setCam({ mode: "normal" });
    const n = await calls();
    await page.getByRole("button", { name: "למדוד שוב" }).click();
    await expect.poll(camState, { timeout: 15_000 }).toBe("live");
    expect(await calls()).toBe(n + 1);
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
    expect(await page.getByTestId("light-measure").count()).toBe(0);
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
    await measure();
    expect(["undetermined", "dark", "unstable"]).toContain(await page.getByTestId("light-result").getAttribute("data-verdict"));
    expect((await tracks()).every((s) => s === "ended")).toBe(true);
  });
});

describe("per-user isolation", () => {
  it("the plant selector lists only the signed-in user's plants; B sees none of A's observations", async () => {
    await setCam({ passthrough: false, mode: "normal" });
    await openMeter();
    await measure();
    await page.getByTestId("light-user-choice").getByText("אור בינוני").click();
    const optsA = (await page.getByTestId("light-plant").locator("option").allTextContents()).join("|");
    expect(optsA).toContain("פוטוס");
    expect(optsA).not.toContain("צמח של B");

    await signInAs("B");
    await page.goto(`${proxy.base}/today`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    await openMeter();
    await measure();
    await page.getByTestId("light-user-choice").getByText("אור חלש").click();
    const optsB = (await page.getByTestId("light-plant").locator("option").allTextContents()).join("|");
    expect(optsB).toContain("צמח של B");
    expect(optsB).not.toContain("פוטוס");
    await page.getByTestId("light-plant").selectOption("plant-of-B");
    await page.getByRole("button", { name: "שמירה" }).click();
    await page.waitForURL(/\/plants\/plant-of-B/, { timeout: 10_000 });
    await expect.poll(async () => (await lights(B)).length, { timeout: 15_000 }).toBe(1);
    expect((await lights(B))[0]).toMatchObject({ plantId: "plant-of-B", method: "camera_live_user", category: "low" });
    expect(JSON.stringify(await lights(B))).not.toContain("plant-1");
    expect((await lights(A)).every((r) => r.plantId !== "plant-of-B")).toBe(true);
  });
});
