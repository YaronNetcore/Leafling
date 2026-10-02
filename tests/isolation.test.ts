// Multi-user isolation + legacy-migration security tests against the real Worker (see helpers/worker.ts).
// Scenario numbers refer to the required security tests in docs/security/MULTI_USER.md.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_SCHEMA_V1 } from "../src/worker/schema.ts";
import { AUD, Client, type TestD1, type TestR2, OWNER_EMAIL, TEAM, claimsFor, mut, newSigner, signJwt, startWorker, type Harness } from "./helpers/worker.ts";

const OWNER = { sub: "11111111-aaaa-4aaa-8aaa-000000000001", email: OWNER_EMAIL };
const BOB = { sub: "22222222-bbbb-4bbb-8bbb-000000000002", email: "bob@example.test" };
const CAROL = { sub: "33333333-cccc-4ccc-8ccc-000000000003", email: "carol@example.test" };

// Representative v1 (pre-multi-user) data, as the single-owner app stored it.
const LEGACY_PHOTO = "0b5e2b8e-7a43-4c1e-9a10-5d1f0f0c0001";
const LEGACY_PHOTO_BYTES = new TextEncoder().encode("legacy-original-jpeg-bytes");
const legacyRows = [
  { entity: "plant", id: "legacy-plant-1", data: { id: "legacy-plant-1", commonName: "מונסטרה", status: "plant", ordinal: 1 }, rev: 1 },
  { entity: "event", id: "legacy-ev-1", data: { id: "legacy-ev-1", plantId: "legacy-plant-1", type: "watered", occurredAt: "2026-09-20T08:00:00Z", payload: { note: "יומן פרטי" } }, rev: 2 },
  { entity: "photo", id: LEGACY_PHOTO, data: { id: LEGACY_PHOTO, plantId: "legacy-plant-1" }, rev: 3 },
  { entity: "profile", id: "me", data: { id: "me", region: "מרכז", experience: "some" }, rev: 4 },
];

async function seedLegacy(db: TestD1, r2: TestR2) {
  await db.batch(APP_SCHEMA_V1.map((s) => db.prepare(s)));
  const at = "2026-09-25T10:00:00.000Z";
  await db.batch([
    ...legacyRows.map((r) => db.prepare(`INSERT INTO app_records (entity, id, data, field_revs, rev, updated_at, device_id, client_time) VALUES (?, ?, ?, '{}', ?, ?, 'old-phone', ?)`)
      .bind(r.entity, r.id, JSON.stringify(r.data), r.rev, at, at)),
    ...legacyRows.map((r) => db.prepare(`INSERT INTO app_changes (seq, entity, id, mutation_id, at) VALUES (?, ?, ?, ?, ?)`).bind(r.rev, r.entity, r.id, `legacy-m-${r.rev}`, at)),
    ...legacyRows.map((r) => db.prepare(`INSERT INTO app_mutations (mutation_id, seq, result, at) VALUES (?, ?, 'applied', ?)`).bind(`legacy-m-${r.rev}`, r.rev, at)),
    db.prepare(`INSERT INTO app_conflicts (entity, record_id, field, overwritten, incoming, base_rev, overwritten_rev, applied_rev, mutation_id, device_id, client_time, at) VALUES ('plant','legacy-plant-1','nickname','"ישן"','"חדש"',0,1,1,'legacy-m-1','old-phone',?,?)`).bind(at, at),
    db.prepare(`INSERT INTO app_ai_usage (at, feature, model, plant_id, input_tokens, output_tokens, image_count, est_cost_usd, latency_ms, status, context_sections) VALUES (?, 'ask', 'claude-sonnet-5', 'legacy-plant-1', 10, 10, 0, 0.001, 5, 'ok', 'plant')`).bind(at),
  ]);
  await r2.put(`app/photos/${LEGACY_PHOTO}/original`, LEGACY_PHOTO_BYTES, { sha256: createHash("sha256").update(LEGACY_PHOTO_BYTES).digest("hex") });
  await r2.put(`app/photos/${LEGACY_PHOTO}/display`, LEGACY_PHOTO_BYTES);
}

const legacySnapshot = async (db: TestD1) => ({
  records: (await db.prepare(`SELECT * FROM app_records ORDER BY entity, id`).all()).results,
  changes: (await db.prepare(`SELECT * FROM app_changes ORDER BY seq`).all()).results,
  mutations: (await db.prepare(`SELECT * FROM app_mutations ORDER BY mutation_id`).all()).results,
  conflicts: (await db.prepare(`SELECT * FROM app_conflicts ORDER BY id`).all()).results,
  ai: (await db.prepare(`SELECT * FROM app_ai_usage ORDER BY id`).all()).results,
});

let h: Harness;
let db: TestD1;
let before: Awaited<ReturnType<typeof legacySnapshot>>;
let owner: Client, bob: Client, carol: Client;

beforeAll(async () => {
  h = await startWorker({ anthropicKey: true, beforeFirstRequest: seedLegacy });
  db = await h.mf.getD1Database("DB");
  before = await legacySnapshot(db);
  // Carol signs in FIRST — legacy data must not go to whoever happens to be first.
  carol = await Client.signIn(h, CAROL);
  bob = await Client.signIn(h, BOB);
  owner = await Client.signIn(h, OWNER);
}, 120_000);
afterAll(async () => { await h?.mf.dispose(); });

describe("identity (13, 14)", () => {
  it("14: no token → 401 on every personal endpoint", async () => {
    for (const [m, p] of [["GET", "/api/v1/me"], ["POST", "/api/v1/sync/push"], ["GET", "/api/v1/sync/pull?since=0"], ["GET", "/api/v1/sync/conflicts"],
      ["POST", "/api/v1/sync/conflicts/1/resolved"], ["GET", `/api/v1/photos/${LEGACY_PHOTO}/display`], ["PUT", `/api/v1/photos/${LEGACY_PHOTO}/display`], ["POST", "/api/v1/ai"]]) {
      const r = await h.fetch(p, { method: m });
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(await r.json()).toEqual({ error: "missing_access_token" });
    }
  });

  it("13: forged / invalid tokens are rejected", async () => {
    const other = await newSigner("kid-test-1"); // same kid, different key = forged signature
    const unknownKid = await newSigner("kid-unknown");
    const good = claimsFor(BOB);
    const cases: [string, string, number][] = [
      ["forged signature", await signJwt(other, good), 401],
      ["unknown key id", await signJwt(unknownKid, good), 401],
      ["wrong audience", await signJwt(h.signer, { ...good, aud: ["someone-elses-app"] }), 401],
      ["wrong issuer", await signJwt(h.signer, { ...good, iss: "https://evil.cloudflareaccess.com" }), 401],
      ["expired", await signJwt(h.signer, { ...good, exp: Math.floor(Date.now() / 1000) - 10 }), 401],
      ["no exp", await signJwt(h.signer, { ...good, exp: undefined }), 401],
      ["not yet valid", await signJwt(h.signer, { ...good, nbf: Math.floor(Date.now() / 1000) + 3600 }), 401],
      ["alg none", (await signJwt(h.signer, good, { alg: "none" })), 401],
      ["HS256 header", (await signJwt(h.signer, good, { alg: "HS256" })), 401],
      ["no sub (service token)", await signJwt(h.signer, { ...good, sub: "" }), 401],
      ["no email", await signJwt(h.signer, { ...good, email: undefined }), 401],
      ["wrong token type", await signJwt(h.signer, { ...good, type: "org" }), 401],
      ["malformed", "not.a.jwt", 401],
    ];
    // Payload tampering: take a valid token and swap the payload to another identity.
    const valid = await signJwt(h.signer, good);
    const [hh, , ss] = valid.split(".");
    cases.push(["tampered payload (owner email)", `${hh}.${Buffer.from(JSON.stringify(claimsFor(OWNER))).toString("base64url")}.${ss}`, 401]);
    for (const [name, token, status] of cases) {
      const r = await h.fetch("/api/v1/me", { token });
      expect(r.status, name).toBe(status);
    }
  });

  it("server derives identity; browser-supplied owner hints are ignored", async () => {
    const me = await owner.json<{ userId: string; email: string; isLegacyOwner: boolean }>("/api/v1/me");
    expect(me.isLegacyOwner).toBe(true);
    const meB = await bob.json<{ userId: string; isLegacyOwner: boolean }>("/api/v1/me");
    expect(meB.isLegacyOwner).toBe(false);
    expect(new Set([owner.userId, bob.userId, carol.userId]).size).toBe(3);
    // X-Leafling-User naming someone else → refused, not honoured.
    expect((await bob.req("/api/v1/sync/pull?since=0", { user: owner.userId })).status).toBe(409);
    expect((await bob.req("/api/v1/sync/push", { method: "POST", user: owner.userId, body: JSON.stringify({ mutations: [mut("plant", "x1", { a: 1 })] }) })).status).toBe(409);
    // Writes without the latch header are refused.
    expect((await bob.req("/api/v1/sync/push", { method: "POST", user: null, body: JSON.stringify({ mutations: [mut("plant", "x2", { a: 1 })] }) })).status).toBe(428);
    // Ownership fields inside the body are just data and never select the owner.
    await bob.push([mut("plant", "bob-own", { name: "x", user_id: owner.userId, userId: owner.userId, owner: OWNER_EMAIL })]);
    expect((await owner.pullAll()).some((r) => r.id === "bob-own")).toBe(false);
  });

  it("users are keyed by Access sub, not email", async () => {
    // Same sub, new email → same internal user.
    const renamed = await Client.signIn(h, { sub: BOB.sub, email: "bob.new@example.test" });
    expect(renamed.userId).toBe(bob.userId);
    // Owner's email with a different sub (e.g. a re-created identity) → a NEW, empty user; legacy stays with the claimed owner.
    const imposter = await Client.signIn(h, { sub: "44444444-dddd-4ddd-8ddd-000000000004", email: OWNER_EMAIL });
    expect(imposter.userId).not.toBe(owner.userId);
    expect(await imposter.pullAll()).toEqual([]);
    const meI = await imposter.json<{ isLegacyOwner: boolean }>("/api/v1/me");
    expect(meI.isLegacyOwner).toBe(false);
    const users = (await db.prepare(`SELECT access_sub, email FROM app_users`).all<{ access_sub: string; email: string }>()).results;
    expect(users.find((u) => u.access_sub === BOB.sub)?.email).toBe("bob.new@example.test");
  });
});

describe("legacy migration (12)", () => {
  it("12: original rows preserved byte-for-byte; owner sees all of them, nobody else sees any", async () => {
    expect(await legacySnapshot(db)).toEqual(before); // v1 tables untouched (in-database backup)
    const mine = await owner.pullAll();
    for (const r of legacyRows) {
      const got = mine.find((x) => x.entity === r.entity && x.id === r.id);
      expect(got, r.id).toBeTruthy();
      expect(got!.data).toEqual(r.data);
      expect(got!.rev).toBe(r.rev); // revisions preserved → existing devices' sync cursors stay valid
    }
    for (const c of [bob, carol]) expect((await c.pullAll()).filter((r) => r.id.startsWith("legacy") || r.id === LEGACY_PHOTO)).toEqual([]);
    const leftover = await db.prepare(`SELECT COUNT(*) AS n FROM user_records WHERE user_id = '__legacy__'`).first<{ n: number }>();
    expect(leftover?.n).toBe(0);
    const meta = await db.prepare(`SELECT value FROM app_meta WHERE key = 'legacy_owner'`).first<{ value: string }>();
    expect(meta?.value).toBe(owner.userId);
  });

  it("12: legacy conflicts, mutation ids and photos stay with the owner", async () => {
    const oc = await owner.json<{ conflicts: { record_id: string; field: string }[] }>("/api/v1/sync/conflicts");
    expect(oc.conflicts.some((c) => c.record_id === "legacy-plant-1" && c.field === "nickname")).toBe(true);
    expect((await bob.json<{ conflicts: unknown[] }>("/api/v1/sync/conflicts")).conflicts).toEqual([]);
    // A legacy mutation re-sent by the owner's old phone is recognised as a duplicate (no double apply).
    const dup = await owner.json<{ results: { result: string }[] }>("/api/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations: [{ ...mut("plant", "legacy-plant-1", { commonName: "מונסטרה" }), mutationId: "legacy-m-1" }] }) });
    expect(dup.results[0].result).toBe("duplicate:applied");
    const r = await owner.req(`/api/v1/photos/${LEGACY_PHOTO}/original`);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(LEGACY_PHOTO_BYTES);
  });

  it("migration is idempotent across isolates (re-running changes nothing)", async () => {
    const { migrate } = await import("../src/worker/schema.ts");
    const count = async () => (await db.prepare(`SELECT COUNT(*) AS n FROM user_records`).first<{ n: number }>())!.n;
    const n0 = await count();
    await migrate(db as never);
    expect(await count()).toBe(n0);
  });
});

describe("cross-user isolation (1–9)", () => {
  const plantA = `pA-${randomUUID().slice(0, 8)}`;
  const photoA = randomUUID();
  const photoBytes = new TextEncoder().encode("owner photo bytes " + photoA);
  let conflictIdA = 0;

  beforeAll(async () => {
    // User A (owner) creates a plant, journal events, a health case, a photo and a conflict.
    let r = await owner.json<{ results: { appliedRev: number }[] }>("/api/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations: [
      mut("plant", plantA, { commonName: "פיקוס סודי", nickname: "אלמוני", status: "plant" }),
      mut("event", `${plantA}-e1`, { plantId: plantA, type: "watered", occurredAt: "2026-10-01T08:00:00Z", payload: { note: "יומן של A" } }),
      mut("health", `${plantA}-h1`, { plantId: plantA, title: "כתמים", state: "open", source: "user" }),
      mut("photo", photoA, { plantId: plantA }),
    ] }) });
    const rev = r.results[0].appliedRev;
    // Two edits from different devices on the same base → a server-ordered conflict for A.
    await owner.push([mut("plant", plantA, { nickname: "ראשון" }, rev, "phone")]);
    r = await owner.json("/api/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations: [mut("plant", plantA, { nickname: "שני" }, rev, "laptop")] }) });
    const oc = await owner.json<{ conflicts: { id: number; record_id: string }[] }>("/api/v1/sync/conflicts");
    conflictIdA = oc.conflicts.find((c) => c.record_id === plantA)!.id;
    const up = await owner.req(`/api/v1/photos/${photoA}/original`, { method: "PUT", body: photoBytes, headers: { "content-type": "image/jpeg", "x-sha256": createHash("sha256").update(photoBytes).digest("hex"), "content-length": String(photoBytes.length) } });
    expect(up.status).toBe(200);
    await owner.req(`/api/v1/photos/${photoA}/display`, { method: "PUT", body: photoBytes, headers: { "content-type": "image/jpeg", "content-length": String(photoBytes.length) } });
  });

  const ownerPlant = async () => (await owner.pullAll()).find((r) => r.id === plantA)!;

  it("1 / 5 / 6 / 7: B's pull, delta pull and export contain nothing of A", async () => {
    const all = await bob.pullAll(); // the export is built from exactly this paginated pull
    const leaked = JSON.stringify(all);
    for (const s of [plantA, "פיקוס סודי", "יומן של A", photoA, "legacy", "מונסטרה"]) expect(leaked.includes(s), s).toBe(false);
    for (const since of [0, 1, 2, 3, 5, 10, 100]) {
      const r = await bob.json<{ records: { id: string }[] }>(`/api/v1/sync/pull?since=${since}`);
      expect(r.records.some((x) => x.id === plantA || x.id.startsWith(plantA))).toBe(false);
    }
  });

  it("2: B cannot modify A's plant by sending its id", async () => {
    const beforeA = await ownerPlant();
    const res = await bob.json<{ results: { result: string; appliedRev: number }[] }>("/api/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations: [mut("plant", plantA, { nickname: "נפרץ" }, beforeA.rev)] }) });
    expect(res.results[0].result).toBe("applied"); // applied to B's OWN record with that id — no conflict, nothing about A
    expect(await ownerPlant()).toEqual(beforeA);
    const bobsCopy = (await bob.pullAll()).find((r) => r.id === plantA)!;
    expect(bobsCopy.data).toEqual({ nickname: "נפרץ", id: plantA });
    expect(JSON.stringify(bobsCopy)).not.toContain("פיקוס סודי");
  });

  it("3: B cannot delete A's records (soft delete or trash)", async () => {
    const beforeA = await ownerPlant();
    await bob.push([mut("plant", plantA, { deletedAt: new Date().toISOString() }), mut("event", `${plantA}-e1`, { deletedAt: new Date().toISOString() })]);
    expect(await ownerPlant()).toEqual(beforeA);
    expect((await owner.pullAll()).find((r) => r.id === `${plantA}-e1`)!.data.deletedAt).toBeUndefined();
    for (const m of ["DELETE", "PATCH"]) expect((await bob.req(`/api/v1/sync/push`, { method: m })).status).toBe(404);
  });

  it("4: B cannot read, overwrite or probe A's photos", async () => {
    for (const v of ["original", "display", "thumb"]) {
      const r = await bob.req(`/api/v1/photos/${photoA}/${v}`);
      expect(r.status, v).toBe(404);
      expect(await r.json()).toEqual({ error: "not_found" });
    }
    expect((await bob.req(`/api/v1/photos/${LEGACY_PHOTO}/original`)).status).toBe(404); // legacy objects: owner only
    expect((await bob.req(`/api/v1/photos/${photoA}/display`, { headers: { "if-none-match": "*" } })).status).toBe(404);
    // Path traversal / foreign keys are not expressible: the id must be a UUID and the variant fixed.
    for (const p of [`/api/v1/photos/..%2F..%2Fusers%2F${owner.userId}/original`, `/api/v1/photos/${photoA}/../../${photoA}/original`, `/api/v1/photos/${photoA}/raw`]) {
      expect([400, 404]).toContain((await bob.req(p)).status);
    }
    // B uploading the same photo id writes only into B's namespace; A's original is unchanged.
    const evil = new TextEncoder().encode("bob overwrite attempt");
    const up = await bob.req(`/api/v1/photos/${photoA}/original`, { method: "PUT", body: evil, headers: { "content-type": "image/jpeg", "x-sha256": createHash("sha256").update(evil).digest("hex"), "content-length": String(evil.length) } });
    expect(up.status).toBe(200);
    const a = await owner.req(`/api/v1/photos/${photoA}/original`);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(photoBytes);
    const r2 = await h.mf.getR2Bucket("PHOTOS");
    const keys = (await r2.list({ prefix: "users/" })).objects.map((o: { key: string }) => o.key);
    expect(keys).toContain(`users/${owner.userId}/photos/${photoA}/original`);
    expect(keys).toContain(`users/${bob.userId}/photos/${photoA}/original`);
    expect(keys.every((k: string) => /^users\/[0-9a-f-]{36}\/photos\/[0-9a-f-]{36}\/(original|display|thumb)$/.test(k))).toBe(true);
    // Photo responses are never cacheable across users on a shared device.
    expect(a.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("5: B cannot replay or probe A's mutation ids", async () => {
    const aMut = (await db.prepare(`SELECT mutation_id FROM user_mutations WHERE user_id = ? LIMIT 1`).bind(owner.userId).first<{ mutation_id: string }>())!.mutation_id;
    const r = await bob.json<{ results: { result: string }[] }>("/api/v1/sync/push", { method: "POST", body: JSON.stringify({ mutations: [{ ...mut("wishlist", "w1", { speciesId: "x" }), mutationId: aMut }] }) });
    expect(r.results[0].result).toBe("applied"); // not "duplicate:…" → no information about A
  });

  it("8: B cannot restore/resolve A's conflicts or recover A's trash", async () => {
    const r = await bob.req(`/api/v1/sync/conflicts/${conflictIdA}/resolved`, { method: "POST" });
    expect(r.status).toBe(404);
    const row = await db.prepare(`SELECT resolved FROM user_conflicts WHERE id = ?`).bind(conflictIdA).first<{ resolved: number }>();
    expect(row?.resolved).toBe(0);
    // A manipulated backup / restore payload with foreign ids and owner fields lands only in B's space.
    const beforeA = await ownerPlant();
    await bob.push([mut("plant", plantA, { deletedAt: null, commonName: "שחזור זדוני", user_id: owner.userId }), mut("profile", "me", { region: "B" })]);
    expect(await ownerPlant()).toEqual(beforeA);
    expect((await owner.pullAll()).find((r) => r.entity === "profile")!.data.region).toBe("מרכז");
    // A can still resolve their own.
    expect((await owner.req(`/api/v1/sync/conflicts/${conflictIdA}/resolved`, { method: "POST" })).status).toBe(200);
  });

  it("9: AI context only from the caller's own records", async () => {
    h.anthropic.length = 0;
    // B asks about A's plant id → not found; nothing sent to Anthropic.
    let r = await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "ask", plantId: plantA, question: "מה שלומו?" }) });
    // B has its own record with that id (created in test 2/8) — context must come from B's copy only.
    if (r.status === 200) {
      const sent = JSON.stringify(h.anthropic.at(-1)!.body);
      for (const s of ["פיקוס סודי", "יומן של A", "כתמים", "מרכז", "אלמוני"]) expect(sent.includes(s), s).toBe(false);
    } else expect(r.status).toBe(404);
    // B referencing A's photo → refused before any upstream call.
    const n = h.anthropic.length;
    await bob.push([mut("plant", "bob-plant", { commonName: "של B" })]);
    r = await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "diagnose", plantId: "bob-plant", photoIds: [photoA, LEGACY_PHOTO] }) });
    expect(r.status).toBe(403);
    expect(h.anthropic.length).toBe(n);
    // A's own request includes A's context.
    r = await owner.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "ask", plantId: plantA, question: "מה שלומו?", photoIds: [photoA] }) });
    expect(r.status).toBe(200);
    const sent = JSON.stringify(h.anthropic.at(-1)!.body);
    expect(sent).toContain("יומן של A");
    expect(sent).not.toContain("של B");
    // Per-user usage rows.
    const usage = (await db.prepare(`SELECT user_id FROM user_ai_usage`).all<{ user_id: string }>()).results;
    expect(usage.every((u: { user_id: string }) => [owner.userId, bob.userId, carol.userId].includes(u.user_id))).toBe(true);
  });

  it("errors never reveal another user's data", async () => {
    const r = await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "ask", plantId: "does-not-exist", question: "?" }) });
    const body = await r.text();
    expect(body).toBe(JSON.stringify({ error: "plant_not_found" }));
  });
});

describe("new personal data types stay per user (light, pets, identification)", () => {
  const plant = `light-${randomUUID().slice(0, 8)}`;
  const loc = `loc-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    const r = await owner.push([
      mut("location", loc, { name: "חלון מזרחי של A", kind: "indoor" }),
      mut("plant", plant, { commonName: "פילודנדרון של A", status: "plant", ordinal: 1, locationId: loc }),
      mut("light", `${plant}-l1`, { plantId: plant, locationId: loc, category: "bright_indirect", method: "camera_exposure", estimate: true, measuredAt: "2026-10-01T09:00:00Z" }),
      mut("profile", "me", { pets: [{ id: "p1", kind: "dog", name: "מיקאסה" }, { id: "p2", kind: "dog", name: "בייליס" }, { id: "p3", kind: "cat", name: null }] }),
    ]);
    expect(r.status).toBe(200);
  });

  it("B cannot see A's light observations or pets through sync/export", async () => {
    const all = JSON.stringify(await bob.pullAll());
    for (const s of [plant, loc, "חלון מזרחי של A", "מיקאסה", "בייליס"]) expect(all.includes(s), s).toBe(false);
  });

  it("B writing a light observation onto A's plant id lands only in B's space", async () => {
    await bob.push([mut("light", `${plant}-evil`, { plantId: plant, locationId: loc, category: "low", method: "user_choice", estimate: true })]);
    const mine = await owner.pullAll();
    expect(mine.some((r) => r.id === `${plant}-evil`)).toBe(false);
    expect(mine.filter((r) => r.entity === "light" && r.data.plantId === plant).map((r) => r.data.category)).toEqual(["bright_indirect"]);
  });

  it("multiple pets of one kind are stored and synced as separate records in the owner's profile only", async () => {
    const prof = (await owner.pullAll()).find((r) => r.entity === "profile")!;
    const pets = prof.data.pets as { id: string; kind: string; name: string | null }[];
    expect(pets.filter((p) => p.kind === "dog").map((p) => p.name)).toEqual(["מיקאסה", "בייליס"]);
    // Remove one dog → the other stays.
    await owner.push([mut("profile", "me", { pets: pets.filter((p) => p.id !== "p1") }, prof.rev)]);
    const after = (await owner.pullAll()).find((r) => r.entity === "profile")!.data.pets as { id: string; name: string | null }[];
    expect(after.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(JSON.stringify(await bob.pullAll())).not.toContain("בייליס");
  });

  it("AI context: A gets A's light (marked as an estimate) and pet kinds; B gets none of it", async () => {
    h.anthropic.length = 0;
    let r = await owner.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "ask", plantId: plant, question: "האם זה בטוח לכלב שלי והאם יש מספיק אור?" }) });
    expect(r.status).toBe(200);
    const sent = JSON.stringify(h.anthropic.at(-1)!.body);
    expect(sent).toContain("lightObservations");
    expect(sent).toContain("NOT a calibrated light meter");
    expect(sent).toContain("bright_indirect");
    expect(sent).not.toMatch(/lux\\":\s*\d/); // never a fabricated lux value
    expect(sent).toContain("\\\"kind\\\":\\\"dog\\\"");
    expect(sent).not.toContain("בייליס"); // pet names are not sent
    // B asks about the same plant id → B has no such plant → 404, nothing sent upstream.
    const n = h.anthropic.length;
    r = await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "ask", plantId: plant, question: "?" }) });
    expect(r.status).toBe(404);
    expect(h.anthropic.length).toBe(n);
  });

  it("identification: images reach the model as image blocks; requests are bound to the caller", async () => {
    h.anthropic.length = 0;
    const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
    const r = await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "identify", images: [jpegB64, jpegB64] }) });
    expect(r.status).toBe(200);
    const body = h.anthropic.at(-1)!.body as { messages: { content: { type: string; source?: { data: string; media_type: string } }[] }[] };
    const imgs = body.messages[0].content.filter((c) => c.type === "image");
    expect(imgs.length).toBe(2);
    expect(imgs[0].source).toMatchObject({ media_type: "image/jpeg", data: jpegB64 });
    expect(JSON.stringify(body)).not.toContain("פילודנדרון של A");
    const usage = (await db.prepare(`SELECT user_id FROM user_ai_usage WHERE feature = 'identify'`).all<{ user_id: string }>()).results;
    expect(usage.every((u) => u.user_id === bob.userId)).toBe(true);
    // Too many / invalid images are refused with a clear code.
    expect(await (await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "identify", images: Array(5).fill(jpegB64) }) })).json()).toEqual({ error: "too_many_images" });
    expect(await (await bob.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "identify", images: ["data:image/jpeg;base64,xx"] }) })).json()).toEqual({ error: "bad_image" });
  });

  it("upstream failure: clear error code, metadata-only usage row for the caller, no key or content in the response", async () => {
    h.anthropicStatus = 401;
    try {
      const r = await carol.req("/api/v1/ai", { method: "POST", body: JSON.stringify({ mode: "identify", images: [Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")] }) });
      expect(r.status).toBe(502);
      const text = await r.text();
      expect(JSON.parse(text)).toEqual({ error: "ai_upstream_401" });
      expect(text).not.toContain("test-not-a-real-key");
      const rows = (await db.prepare(`SELECT user_id, feature, status, image_count, input_tokens, est_cost_usd FROM user_ai_usage WHERE status LIKE 'ai_upstream_%'`).all()).results;
      expect(rows).toEqual([{ user_id: carol.userId, feature: "identify", status: "ai_upstream_401", image_count: 1, input_tokens: 0, est_cost_usd: 0 }]);
    } finally { h.anthropicStatus = undefined; }
  });
});

describe("concurrent multi-user sync", () => {
  it("parallel pushes of three users never mix and each keeps its own ordering", async () => {
    const rounds = 6;
    const ids = { a: [] as string[], b: [] as string[], c: [] as string[] };
    const run = async (c: Client, tag: "a" | "b" | "c") => {
      for (let i = 0; i < rounds; i++) {
        const id = `cc-${tag}-${i}`;
        ids[tag].push(id);
        for (let attempt = 0; attempt < 10; attempt++) {
          const r = await c.push([mut("location", id, { name: `${tag}-${i}` })]);
          if (r.status === 200) break;
          expect(r.status).toBe(409); // optimistic CAS → retry
        }
      }
    };
    await Promise.all([run(owner, "a"), run(bob, "b"), run(carol, "c"), run(owner, "a")]);
    const [ra, rb, rc] = await Promise.all([owner.pullAll(), bob.pullAll(), carol.pullAll()]);
    const names = (rs: { entity: string; id: string; data: Record<string, unknown> }[]) => rs.filter((r) => r.entity === "location" && r.id.startsWith("cc-")).map((r) => String(r.data.name));
    expect(names(ra).every((n) => n.startsWith("a-"))).toBe(true);
    expect(names(rb).every((n) => n.startsWith("b-"))).toBe(true);
    expect(names(rc).every((n) => n.startsWith("c-"))).toBe(true);
    expect(new Set(names(rb)).size).toBe(rounds);
    // Per-user revisions are strictly increasing and unique.
    for (const rs of [ra, rb, rc]) { const revs = rs.map((r) => r.rev); expect(new Set(revs).size).toBe(revs.length); }
  });
});

describe("Phase 0 harness (15)", () => {
  it("15: still works for the owner and stays owner-only", async () => {
    const r = await h.fetch("/api/whoami", { token: owner.token });
    expect(r.status).toBe(200);
    expect((await h.fetch("/api/whoami", { token: bob.token })).status).toBe(403);
    expect((await h.fetch("/api/whoami", {})).status).toBe(401);
    expect((await h.fetch("/api/sync/pull", { token: bob.token })).status).toBe(403);
  });
  it("config sanity", () => { expect(AUD).not.toBe(""); expect(TEAM).toContain("cloudflareaccess"); });
});
