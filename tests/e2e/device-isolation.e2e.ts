// Scenarios 10 + 11: two people on ONE device / browser profile, using the real production build
// (dist/) and the real Worker (Miniflare). A tiny local proxy plays the role of Cloudflare Access:
// it adds a freshly signed Access JWT for whoever the "tu" cookie says is signed in — exactly the
// header Access injects in production. Switching the cookie = the Access session switching account.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, OWNER_EMAIL, claimsFor, mut, signJwt, startWorker, type Harness, type Person } from "../helpers/worker.ts";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const PEOPLE: Record<string, Person> = {
  A: { sub: "aaaaaaaa-0000-4000-8000-00000000000a", email: OWNER_EMAIL },
  B: { sub: "bbbbbbbb-0000-4000-8000-00000000000b", email: "second@example.test" },
};
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

let h: Harness, server: Server, base = "", browser: Browser, ctx: BrowserContext, page: Page;
let A: Client, B: Client;
const photoId = "7e1a8f2c-1111-4222-8333-944455556666";
const photoBytes = new TextEncoder().encode("A-private-photo");

function startProxy(): Promise<void> {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const who = /(?:^|;\s*)tu=([AB])/.exec(req.headers.cookie ?? "")?.[1];
    if (url.pathname === "/cdn-cgi/access/logout") { res.writeHead(200, { "set-cookie": "tu=; Max-Age=0; Path=/", "content-type": "text/plain" }); res.end("logged out"); return; }
    if (url.pathname.startsWith("/api/")) {
      if (!who) { res.writeHead(302, { location: "/cdn-cgi/access/login" }); res.end(); return; } // what Access does
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !k.startsWith("cf-") && k !== "host" && k !== "cookie") headers.set(k, v);
      headers.set("cf-access-jwt-assertion", await signJwt(h.signer, claimsFor(PEOPLE[who])));
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r = await h.mf.dispatchFetch(`https://leafling.test${url.pathname}${url.search}`, {
        method: req.method, headers: Object.fromEntries(headers), body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
      } as never);
      const out: Record<string, string> = {};
      r.headers.forEach((v: string, k: string) => { out[k] = v; });
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; ok(); }));
}

const signInAs = (who: "A" | "B") => ctx.addCookies([{ name: "tu", value: who, url: base }]);
const dbNames = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));
/** Reads a whole object store of one IndexedDB database inside the page (raw API, no app code). */
const readStore = (dbName: string, store: string) => page.evaluate(([n, s]) => new Promise<unknown[]>((ok, ko) => {
  const open = indexedDB.open(n);
  open.onerror = () => ko(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction(s, "readonly");
    const q = tx.objectStore(s).getAll();
    q.onsuccess = () => { ok(q.result); open.result.close(); };
    q.onerror = () => ko(q.error);
  };
}), [dbName, store] as const);
const dbg = (...a: unknown[]) => { if (process.env.E2E_DEBUG) process.stderr.write(a.join(" ") + "\n"); };
const go = (path: string) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, path);

beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) throw new Error("dist/ missing — run `npm run build` (npm run test:e2e does this)");
  h = await startWorker();
  A = await Client.signIn(h, PEOPLE.A);
  B = await Client.signIn(h, PEOPLE.B);
  await A.push([
    mut("profile", "me", { id: "me", onboardingDone: true, welcomeSeen: true, pets: [], interests: [], places: [], help: {}, onboardingStep: 6, theme: "light" }),
    mut("plant", "plant-of-A", { id: "plant-of-A", commonName: "פיקוס", nickname: "הפיקוס הסודי של A", status: "plant", ordinal: 1, createdAt: "2026-10-01T00:00:00Z" }),
  ]);
  const up = await A.req(`/api/v1/photos/${photoId}/display`, { method: "PUT", body: photoBytes, headers: { "content-type": "image/jpeg", "content-length": String(photoBytes.length) } });
  expect(up.status).toBe(200);
  await startProxy();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "he-IL" });
  page = await ctx.newPage();
  if (process.env.E2E_DEBUG) {
    page.on("console", (m) => dbg("[page]", m.type(), m.text()));
    page.on("load", () => dbg("[load]", page.url()));
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) dbg("[nav]", f.url()); });
    page.on("request", (r) => { if (r.url().includes("/api/")) dbg("[req]", r.method(), new URL(r.url()).pathname); });
    page.on("response", (r) => { if (r.url().includes("/api/")) dbg("[res]", r.status(), new URL(r.url()).pathname); });
  }
});
afterAll(async () => { await browser?.close(); server?.close(); await h?.mf.dispose(); });

describe("one device, two users", () => {
  it("A signs in and sees their own plant in their own local database", async () => {
    await signInAs("A");
    await page.goto(`${base}/`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    await go("/plants");
    await expect.poll(() => page.textContent("body"), { timeout: 15_000 }).toContain("הפיקוס הסודי של A");
    expect(await dbNames()).toContain(`leafling-u-${A.userId}`);
    // A views their photo through the API (lands in the browser HTTP cache, if anything would cache it).
    const st = await page.evaluate(async (id) => (await fetch(`/api/v1/photos/${id}/display`)).status, photoId);
    expect(st).toBe(200);
  });

  it("11: A's offline change stays queued for A and is never sent under B", async () => {
    await ctx.setOffline(true);
    await go("/settings");
    await page.getByText("כהה", { exact: true }).click();
    await expect.poll(async () => (await readStore(`leafling-u-${A.userId}`, "outbox") as { entity: string; patch: { theme?: string }; state: string }[])
      .some((o) => o.entity === "profile" && o.patch.theme === "dark" && o.state === "pending"), { timeout: 10_000 }).toBe(true);

    // The Access session on this device now belongs to B, while A's page (and A's queue) is still open.
    await signInAs("B");
    const reloaded = page.waitForEvent("load", { timeout: 30_000 });
    await ctx.setOffline(false); // fires "online" → A's page tries to sync → server refuses (user_mismatch) → reload
    await reloaded;
    await page.waitForURL(/\/welcome/, { timeout: 30_000 }); // B: brand-new user → own onboarding

    // Server: nothing of A's queue landed anywhere; B has no profile at all yet.
    expect((await B.pullAll()).length).toBe(0);
    const aProfile = (await A.pullAll()).find((r) => r.entity === "profile")!;
    expect(aProfile.data.theme).toBe("light");
    // Device: A's pending change is still safely queued in A's database.
    const stillQueued = await readStore(`leafling-u-${A.userId}`, "outbox") as { patch: { theme?: string } }[];
    expect(stillQueued.some((o) => o.patch.theme === "dark")).toBe(true);
  });

  it("10: B sees nothing of A — not in the UI, not in B's IndexedDB, not via the HTTP cache", async () => {
    expect(await dbNames()).toContain(`leafling-u-${B.userId}`);
    await go("/plants");
    await page.waitForTimeout(800);
    expect(await page.textContent("body")).not.toContain("הפיקוס הסודי של A");
    const bDump = JSON.stringify(await Promise.all(["plants", "events", "photos", "profile", "outbox", "blobs", "meta"].map((s) => readStore(`leafling-u-${B.userId}`, s))));
    expect(bDump).not.toContain("הפיקוס הסודי של A");
    expect(bDump).not.toContain("plant-of-A");
    // Same photo URL A loaded a moment ago: must NOT come back from the browser cache for B.
    const r = await page.evaluate(async (id) => { const x = await fetch(`/api/v1/photos/${id}/display`); return { s: x.status, t: await x.text() }; }, photoId);
    expect(r.s).toBe(404);
    expect(r.t).not.toContain("A-private-photo");
    // Service-worker caches hold only the public app shell — no API responses.
    const cached = await page.evaluate(async () => { const out: string[] = []; for (const k of await caches.keys()) for (const q of await (await caches.open(k)).keys()) out.push(new URL(q.url).pathname); return out; });
    expect(cached.filter((p) => p.startsWith("/api/"))).toEqual([]);
  });

  it("B's own changes go only to B", async () => {
    const before = (await A.pullAll()).length;
    // Drive one real B write through the UI: theme in settings.
    await go("/settings");
    await page.getByText("כהה", { exact: true }).click();
    await expect.poll(async () => (await B.pullAll()).some((r) => r.entity === "profile" && r.data.theme === "dark"), { timeout: 20_000 }).toBe(true);
    expect((await A.pullAll()).length).toBe(before);
    expect((await A.pullAll()).find((r) => r.entity === "profile")!.data.theme).toBe("light");
  });

  it("switching back to A syncs A's queued change under A", async () => {
    await signInAs("A");
    await page.goto(`${base}/`);
    await page.waitForURL(/\/today/, { timeout: 30_000 });
    await expect.poll(async () => (await A.pullAll()).find((r) => r.entity === "profile")!.data.theme, { timeout: 20_000 }).toBe("dark");
    const outboxA = await readStore(`leafling-u-${A.userId}`, "outbox") as unknown[];
    expect(outboxA.length).toBe(0);
  });

  it("explicit sign-out forgets the device's user; offline start then shows sign-in, not A's data", async () => {
    await go("/settings");
    await page.getByText("התנתקות / החלפת משתמש").click();
    await page.waitForURL(/\/cdn-cgi\/access\/logout/);
    await ctx.setOffline(true);
    await page.goto(`${base}/`).catch(() => undefined); // served by the service worker shell offline
    await expect.poll(() => page.textContent("body").catch(() => ""), { timeout: 15_000 }).toContain("כדי להיכנס צריך חיבור לאינטרנט");
    expect(await page.textContent("body")).not.toContain("הפיקוס הסודי של A");
    await ctx.setOffline(false);
  });
});

describe("existing device with the pre-multi-user local database", () => {
  let c2: BrowserContext;
  let p2: Page;
  const STORES: [string, string, boolean, string[]][] = [
    ["plants", "id", false, ["status", "locationId", "speciesId", "createdAt"]], ["events", "id", false, ["plantId", "type", "occurredAt"]],
    ["locations", "id", false, []], ["lights", "id", false, ["locationId"]], ["photos", "id", false, ["plantId", "createdAt", "uploadState"]],
    ["wishlist", "id", false, ["speciesId"]], ["health", "id", false, ["plantId", "state"]], ["reminders", "id", false, ["plantId"]],
    ["profile", "id", false, []], ["outbox", "seq", true, ["mutationId", "entity", "recordId", "state"]], ["blobs", "key", false, []], ["meta", "key", false, []],
  ];

  beforeAll(async () => {
    c2 = await browser.newContext({ viewport: { width: 393, height: 852 }, locale: "he-IL" });
    p2 = await c2.newPage();
    await p2.goto(`${base}/manifest.webmanifest`); // same origin, app not running
    // Recreate the v1 database exactly as the single-owner app left it (Dexie version 1 = IDB version 10),
    // including a change that was made offline and never synced.
    await p2.evaluate((stores) => new Promise<void>((ok, ko) => {
      const req = indexedDB.open("leafling", 10);
      req.onupgradeneeded = () => {
        for (const [name, key, auto, idx] of stores) {
          const os = req.result.createObjectStore(name, { keyPath: key, autoIncrement: auto });
          for (const i of idx) os.createIndex(i, i);
        }
      };
      req.onsuccess = () => {
        const tx = req.result.transaction(["plants", "outbox", "meta"], "readwrite");
        tx.objectStore("plants").put({ id: "phone-plant", commonName: "פוטוס", nickname: "הפוטוס מהטלפון הישן", status: "plant", ordinal: 1, createdAt: "2026-09-30T00:00:00Z" });
        tx.objectStore("outbox").add({ mutationId: "old-phone-pending-1", entity: "plant", recordId: "phone-plant", patch: { id: "phone-plant", commonName: "פוטוס", nickname: "הפוטוס מהטלפון הישן", status: "plant", ordinal: 1 }, baseRev: 0, clientTime: "2026-09-30T00:00:00Z", deviceId: "old-phone", state: "pending" });
        tx.objectStore("meta").put({ key: "deviceId", value: "old-phone" });
        tx.oncomplete = () => { req.result.close(); ok(); };
        tx.onerror = () => ko(tx.error);
      };
      req.onerror = () => ko(req.error);
    }), STORES);
  });
  afterAll(async () => { await c2?.close(); });

  const names2 = () => p2.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ""));

  it("another user signing in on that device never imports or uploads it", async () => {
    await c2.addCookies([{ name: "tu", value: "B", url: base }]);
    await p2.goto(`${base}/`);
    await p2.waitForURL(/\/today|\/welcome/, { timeout: 30_000 });
    await p2.waitForTimeout(1500);
    expect(await names2()).toContain("leafling"); // untouched
    expect(JSON.stringify(await B.pullAll())).not.toContain("הפוטוס מהטלפון הישן");
    expect(JSON.stringify(await A.pullAll())).not.toContain("הפוטוס מהטלפון הישן");
  });

  it("the original owner gets it imported (incl. the unsynced change), synced under the owner only", async () => {
    await c2.addCookies([{ name: "tu", value: "A", url: base }]);
    await p2.goto(`${base}/`);
    await expect.poll(async () => JSON.stringify(await A.pullAll()), { timeout: 30_000 }).toContain("הפוטוס מהטלפון הישן");
    expect(JSON.stringify(await B.pullAll())).not.toContain("הפוטוס מהטלפון הישן");
    await expect.poll(names2, { timeout: 10_000 }).not.toContain("leafling");
  });
});
