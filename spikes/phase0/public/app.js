// Leafling Phase 0 spike client — throwaway test harness (no build step).
// No secrets exist in this file or in the browser.

const $ = (id) => document.getElementById(id);
const show = (id, v) => { $(id).textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); };
const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// ---------- IndexedDB (local copy + pending-change queue) ----------
const dbp = new Promise((resolve, reject) => {
  const r = indexedDB.open("leafling-p0", 1);
  r.onupgradeneeded = () => {
    const db = r.result;
    db.createObjectStore("queue", { keyPath: "mutationId" });
    db.createObjectStore("fields", { keyPath: "k" });
    db.createObjectStore("meta", { keyPath: "key" });
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function tx(stores, mode, fn) {
  const db = await dbp;
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(...stores.map((s) => t.objectStore(s)))).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const getAll = (store) => tx([store], "readonly", (s) => req2p(s.getAll()));
async function meta(key, value) {
  if (value === undefined) return tx(["meta"], "readonly", (s) => req2p(s.get(key))).then((r) => r?.value);
  return tx(["meta"], "readwrite", (s) => { s.put({ key, value }); });
}

// ---------- Results (persisted locally, copied by the owner) ----------
async function record(testId, data) {
  const all = (await meta("results")) ?? {};
  all[testId] = { ...(all[testId] ?? {}), ...data, at: new Date().toISOString() };
  await meta("results", all);
}
async function pushRecord(testId, listName, item, max = 30) {
  const all = (await meta("results")) ?? {};
  const t = all[testId] ?? {};
  t[listName] = [...(t[listName] ?? []), item].slice(-max);
  all[testId] = t;
  await meta("results", all);
}

// ---------- API with Access-expiry detection ----------
class AuthError extends Error {}
let authState = "unknown";
function setAuth(state) {
  authState = state;
  $("stAuth").textContent = state === "ok" ? "מחוברת" : state === "needs-login" ? "צריך להתחבר מחדש" : "בודק התחברות…";
  $("reauth").hidden = state !== "needs-login";
}
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, redirect: "manual", credentials: "same-origin", cache: "no-store" });
  if (res.type === "opaqueredirect" || res.status === 0 || res.status === 401) {
    setAuth("needs-login");
    throw new AuthError("needs-login");
  }
  if (res.ok) setAuth("ok");
  return res;
}
async function apiJson(path, opts = {}) {
  const res = await api(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `http_${res.status}`), { status: res.status, body });
  return body;
}
$("reauth").addEventListener("click", () => { location.href = `/?reauth=${Date.now()}`; });

// ---------- Status bar ----------
async function refreshStatus() {
  $("stMode").textContent = isStandalone() ? "אפליקציה (מסך הבית)" : "Safari";
  $("stNet").textContent = navigator.onLine ? "מקוון" : "לא מקוון";
  const q = await getAll("queue");
  $("stQueue").textContent = String(q.filter((i) => i.state !== "rejected").length);
  const shared = await tx(["fields"], "readonly", (s) => req2p(s.get("p0|shared|value")));
  $("sharedKnown").textContent = shared?.value ?? "—";
  $("sharedRev").textContent = String(shared?.rev ?? 0);
}

// ---------- P0-1 ----------
$("btnWhoami").addEventListener("click", async () => {
  try {
    const t0 = performance.now();
    const w = await apiJson("/api/whoami");
    const out = { ...w, roundTripMs: Math.round(performance.now() - t0), standalone: isStandalone() };
    show("outWhoami", out);
    await record("P0-1", { signedIn: true, standalone: isStandalone(), config: w.config, roundTripMs: out.roundTripMs });
  } catch (e) { show("outWhoami", String(e.message)); }
});

// ---------- P0-2 / P0-3: queue + sync ----------
async function deviceId() {
  let id = await meta("deviceId");
  if (!id) { id = crypto.randomUUID(); await meta("deviceId", id); }
  return id;
}
async function enqueue(entityId, field, value) {
  const dev = await deviceId();
  const k = `p0|${entityId}|${field}`;
  await tx(["queue", "fields"], "readwrite", async (q, f) => {
    const cur = await req2p(f.get(k));
    const baseRev = cur?.rev ?? 0;
    q.put({ mutationId: crypto.randomUUID(), entity: "p0", entityId, field, value, baseRev, clientTime: new Date().toISOString(), deviceId: dev, createdAt: Date.now(), state: "pending" });
    f.put({ k, value, rev: baseRev });
  });
  refreshStatus();
}

let syncing = false;
async function sync() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  const batchSize = Number($("batchSize").value);
  try {
    for (;;) {
      const pending = (await getAll("queue")).filter((i) => i.state === "pending").sort((a, b) => a.createdAt - b.createdAt).slice(0, batchSize);
      if (!pending.length) break;
      const t0 = performance.now();
      let body;
      try {
        body = await apiJson("/api/sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mutations: pending.map(({ mutationId, entity, entityId, field, value, baseRev, clientTime, deviceId }) => ({ mutationId, entity, entityId, field, value, baseRev, clientTime, deviceId })) }),
        });
      } catch (e) {
        if (e instanceof AuthError) throw e;
        await pushRecord("P0-9", "syncPush", { batch: pending.length, error: e.message, status: e.status ?? null });
        show("outSync", { error: e.message, batch: pending.length, note: "Queued changes are kept. Try a smaller batch size." });
        if (e.status === 400 && e.body?.error?.startsWith("bad_")) {
          await tx(["queue"], "readwrite", (q) => pending.forEach((p) => q.put({ ...p, state: "rejected", error: e.body.error })));
        }
        break;
      }
      const ms = Math.round(performance.now() - t0);
      await pushRecord("P0-9", "syncPush", { batch: pending.length, ms, d1Statements: body.d1Statements, d1Queries: body.d1Queries });
      await tx(["queue", "fields"], "readwrite", async (q, f) => {
        const all = await req2p(q.getAll());
        const acked = new Set(body.results.map((r) => r.mutationId));
        for (const r of body.results) q.delete(r.mutationId);
        for (const r of body.results) {
          if (r.appliedRev == null) continue;
          const k = `p0|${r.entityId}|${r.field}`;
          // Rebase only still-queued edits (not part of this acknowledged batch) from the same base.
          const stillPending = all.filter((i) => !acked.has(i.mutationId) && i.state === "pending" && `p0|${i.entityId}|${i.field}` === k);
          for (const p of stillPending) if (p.baseRev === r.baseRev) q.put({ ...p, baseRev: r.appliedRev });
          const cur = await req2p(f.get(k));
          f.put({ k, value: cur?.value ?? null, rev: r.appliedRev });
        }
      });
      const conflicts = body.results.filter((r) => r.result === "applied_conflict_recorded").length;
      const duplicates = body.results.filter((r) => r.result.startsWith("duplicate")).length;
      show("outSync", { pushed: body.results.length, conflicts, duplicates, ms, d1Statements: body.d1Statements });
      await pushRecord("P0-2", "pushes", { n: body.results.length, conflicts, duplicates, ms });
    }
    // Pull server changes (never overwrite a field that still has a pending local change)
    const since = (await meta("lastSeq")) ?? 0;
    const pull = await apiJson(`/api/sync/pull?since=${since}`);
    await tx(["queue", "fields"], "readwrite", async (q, f) => {
      const pending = await req2p(q.getAll());
      for (const c of pull.changes) {
        const k = `p0|${c.entityId}|${c.field}`;
        if (pending.some((p) => p.state === "pending" && `p0|${p.entityId}|${p.field}` === k)) continue;
        f.put({ k, value: c.value, rev: c.rev });
      }
    });
    await meta("lastSeq", pull.serverSeq);
  } catch (e) {
    if (!(e instanceof AuthError)) show("outSync", `sync error: ${e.message}`);
  } finally {
    syncing = false;
    refreshStatus();
  }
}
$("btnAdd20").addEventListener("click", async () => {
  const stamp = new Date().toISOString().slice(11, 19);
  for (let i = 0; i < 20; i++) await enqueue("item-1", `f${i % 5}`, `${stamp}-${i}`);
  await record("P0-2", { lastEnqueued: 20, onlineWhenEnqueued: navigator.onLine });
  sync();
});
$("btnSync").addEventListener("click", sync);
$("btnShared").addEventListener("click", async () => {
  const v = $("sharedValue").value.trim();
  if (!v) return;
  await enqueue("shared", "value", v);
  $("sharedValue").value = "";
  sync();
});
$("btnConflicts").addEventListener("click", async () => {
  try {
    const { conflicts } = await apiJson("/api/sync/conflicts");
    const box = $("conflicts");
    box.textContent = "";
    if (!conflicts.length) { box.textContent = "אין התנגשויות."; return; }
    for (const c of conflicts) {
      const d = document.createElement("div");
      d.className = "conflict";
      d.textContent = `#${c.id} · ${c.entity_id}.${c.field}: "${c.overwritten_value}" (rev ${c.overwritten_rev}) ← "${c.new_value}" (rev ${c.applied_rev}, base ${c.base_rev}) · client time ${c.client_time} ${c.resolved ? "· שוחזר" : ""}`;
      if (!c.resolved) {
        const b = document.createElement("button");
        b.textContent = "שחזר ערך קודם";
        b.addEventListener("click", async () => { await apiJson(`/api/sync/conflicts/${c.id}/restore`, { method: "POST" }); await sync(); $("btnConflicts").click(); });
        d.append(" ", b);
      }
      box.append(d);
    }
    await record("P0-3", { conflictsSeen: conflicts.length, restored: conflicts.filter((c) => c.resolved).length });
  } catch (e) { $("conflicts").textContent = e.message; }
});

// ---------- P0-4 ----------
$("btnPersist").addEventListener("click", async () => {
  const persisted = navigator.storage?.persist ? await navigator.storage.persist() : "unsupported";
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const q = await getAll("queue");
  const out = { persisted, usageMB: est.usage ? +(est.usage / 1e6).toFixed(1) : null, quotaMB: est.quota ? Math.round(est.quota / 1e6) : null, queueItems: q.length, standalone: isStandalone() };
  show("outPersist", out);
  await record("P0-4", out);
});

// ---------- P0-5 / P0-6: photos ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Minimal EXIF reader: finds the "Exif\0\0" TIFF block (JPEG APP1 or HEIC item) and reads DateTimeOriginal + GPS presence.
function readExif(u8) {
  const limit = Math.min(u8.length, 512 * 1024);
  let start = -1;
  for (let i = 0; i < limit - 6; i++) {
    if (u8[i] === 0x45 && u8[i + 1] === 0x78 && u8[i + 2] === 0x69 && u8[i + 3] === 0x66 && u8[i + 4] === 0 && u8[i + 5] === 0) { start = i + 6; break; }
  }
  if (start < 0) return { exifFound: false };
  const dv = new DataView(u8.buffer, u8.byteOffset + start, Math.min(u8.length - start, 256 * 1024));
  const le = dv.getUint16(0) === 0x4949;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const readIfd = (off) => { const tags = {}; const n = u16(off); for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 }; } return tags; };
  const ascii = (t) => { if (!t) return null; const off = t.count > 4 ? u32(t.valOff) : t.valOff; let s = ""; for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(dv.getUint8(off + i)); return s; };
  try {
    const ifd0 = readIfd(u32(4));
    const exifPtr = ifd0[0x8769] ? u32(ifd0[0x8769].valOff) : null;
    const exif = exifPtr ? readIfd(exifPtr) : {};
    return { exifFound: true, dateTimeOriginal: ascii(exif[0x9003]) ?? ascii(ifd0[0x0132]), hasGps: Boolean(ifd0[0x8825]), make: ascii(ifd0[0x010f]), model: ascii(ifd0[0x0110]) };
  } catch { return { exifFound: true, parseError: true }; }
}
async function decodeImage(file) {
  try { return await createImageBitmap(file); } catch {
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url); return img;
  }
}
async function resize(src, longEdge, quality) {
  const w = src.width, h = src.height, s = Math.min(1, longEdge / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", quality));
}
async function put(path, blob, headers) {
  const res = await api(path, { method: "PUT", body: blob, headers: { "content-type": blob.type || "image/jpeg", ...headers } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function handlePhotos(files, source) {
  const outs = [];
  for (const file of files) {
    const o = { source, name: file.name, type: file.type, sizeMB: +(file.size / 1e6).toFixed(2) };
    try {
      let t = performance.now();
      const buf = await file.arrayBuffer(); const u8 = new Uint8Array(buf);
      o.readMs = Math.round(performance.now() - t);
      t = performance.now(); const sha = hex(await crypto.subtle.digest("SHA-256", buf)); o.sha256Ms = Math.round(performance.now() - t);
      t = performance.now(); const crc = crc32(u8).toString(16).padStart(8, "0"); o.crc32Ms = Math.round(performance.now() - t);
      Object.assign(o, readExif(u8));
      t = performance.now(); const bmp = await decodeImage(file); o.decodeMs = Math.round(performance.now() - t); o.px = `${bmp.width}x${bmp.height}`;
      t = performance.now(); const display = await resize(bmp, 1600, 0.85); o.displayMs = Math.round(performance.now() - t); o.displayKB = Math.round(display.size / 1024);
      t = performance.now(); const thumb = await resize(bmp, 400, 0.8); o.thumbMs = Math.round(performance.now() - t); o.thumbKB = Math.round(thumb.size / 1024);
      const id = crypto.randomUUID();
      t = performance.now();
      const up = await put(`/api/photos/${id}/original`, file, { "x-sha256": sha, "x-crc32": crc, "x-original-name": encodeURIComponent(file.name), "x-captured-at": o.dateTimeOriginal ?? "" });
      o.uploadMs = Math.round(performance.now() - t); o.uploadStatus = up.status;
      if (up.status === 200) { await put(`/api/photos/${id}/display`, display, {}); await put(`/api/photos/${id}/thumb`, thumb, {}); }
      o.storedSha256Matches = up.body.sha256 === sha;
    } catch (e) { o.error = e.message; }
    outs.push(o);
    await pushRecord("P0-5", "photos", o, 20);
    show("outPhotos", outs);
  }
}
$("fileCamera").addEventListener("change", (e) => handlePhotos([...e.target.files], "camera"));
$("fileLibrary").addEventListener("change", (e) => handlePhotos([...e.target.files], "library"));
$("btnMismatch").addEventListener("click", async () => {
  const blob = new Blob([crypto.getRandomValues(new Uint8Array(2048))], { type: "image/jpeg" });
  const r = await put(`/api/photos/${crypto.randomUUID()}/original`, blob, { "x-sha256": "0".repeat(64), "x-crc32": "00000000" });
  const out = { expected: 422, got: r.status, body: r.body, pass: r.status === 422 };
  show("outPhotos", out);
  await record("P0-6", { mismatchRejected: out.pass });
});

// ---------- P0-7: export feasibility ----------
function updateZipLink() {
  $("zipLink").href = `/api/export/photos.zip?repeatToMB=${$("zipTarget").value}&maxEntries=${$("zipMax").value}`;
}
$("zipTarget").addEventListener("change", updateZipLink);
$("zipMax").addEventListener("input", updateZipLink);
updateZipLink();
$("btnListPhotos").addEventListener("click", async () => {
  try {
    const { photos } = await apiJson("/api/photos");
    show("outList", { count: photos.length, totalMB: +(photos.reduce((s, p) => s + p.size, 0) / 1e6).toFixed(1), photos: photos.map((p) => ({ id: p.id, mime: p.mime, MB: +(p.size / 1e6).toFixed(2), capturedAt: p.captured_at })) });
  } catch (e) { show("outList", e.message); }
});
$("zipLink").addEventListener("click", async () => {
  await pushRecord("P0-7", "zipAttempts", { targetMB: $("zipTarget").value, maxEntries: $("zipMax").value, startedAt: new Date().toISOString() });
  const box = $("outExport");
  box.textContent = "ההורדה התחילה. אחרי שתסתיים, סמני את התוצאה:";
  const mk = (label, result) => { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", async () => { await pushRecord("P0-7", "zipOutcomes", { targetMB: $("zipTarget").value, result, at: new Date().toISOString() }); box.textContent = `נשמר: ${result}`; }); return b; };
  box.append(document.createElement("br"), mk("נשמר בקבצים ונפתח", "saved-and-opened"), " ", mk("נשמר ב-iCloud Drive", "saved-icloud"), " ", mk("נכשל / נתקע", "failed"), " ", mk("האפליקציה נסגרה/נטענה מחדש", "app-reloaded"));
});
let shareFiles = [];
$("btnSharePrep").addEventListener("click", async () => {
  try {
    const n = Number($("shareCount").value);
    const { photos } = await apiJson("/api/photos");
    const t0 = performance.now();
    shareFiles = [];
    for (const p of photos.slice(0, n)) {
      const res = await api(`/api/photos/${p.id}/original`);
      const blob = await res.blob();
      const ext = (p.mime.split("/")[1] || "bin").replace("jpeg", "jpg");
      shareFiles.push(new File([blob], `${(p.captured_at || "unknown").slice(0, 10).replace(/[^0-9-]/g, "") || "unknown"}_${p.id}.${ext}`, { type: p.mime }));
    }
    const mb = shareFiles.reduce((s, f) => s + f.size, 0) / 1e6;
    $("btnShare").disabled = !shareFiles.length;
    show("outExport", { prepared: shareFiles.length, MB: +mb.toFixed(1), ms: Math.round(performance.now() - t0), canShareFiles: Boolean(navigator.canShare?.({ files: shareFiles })) });
  } catch (e) { show("outExport", e.message); }
});
$("btnShare").addEventListener("click", async () => {
  try {
    await navigator.share({ files: shareFiles, title: "Leafling photos" });
    await pushRecord("P0-7", "shareOutcomes", { files: shareFiles.length, result: "share-completed" });
    show("outExport", "שיתוף הושלם");
  } catch (e) {
    await pushRecord("P0-7", "shareOutcomes", { files: shareFiles.length, result: `share-failed:${e.name}` });
    show("outExport", `share failed: ${e.name} ${e.message}`);
  }
});

// ---------- P0-8: push ----------
const b64uToU8 = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
$("btnPushEnable").addEventListener("click", async () => {
  const out = { standalone: isStandalone(), pushManager: "PushManager" in window, notification: "Notification" in window };
  try {
    const perm = await Notification.requestPermission();
    out.permission = perm;
    if (perm !== "granted") throw new Error("permission_not_granted");
    const { publicKey } = await apiJson("/api/push/public-key");
    if (!publicKey) throw new Error("vapid_public_key_not_configured");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(publicKey) }));
    const j = sub.toJSON();
    await apiJson("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: { endpoint: j.endpoint, keys: j.keys }, deviceLabel: "iPhone" }) });
    out.subscribed = true; out.endpointHost = new URL(j.endpoint).hostname;
  } catch (e) { out.error = e.message; }
  show("outPush", out);
  await record("P0-8", out);
});
document.querySelectorAll("[data-push]").forEach((b) => b.addEventListener("click", async () => {
  const mode = b.dataset.push, delaySec = Number(b.dataset.delay ?? 0);
  try {
    const r = await apiJson("/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, delaySec, badge: 3 }) });
    show("outPush", { ...r, note: "Record whether and when the notification appeared, and whether its text ends with '· SW'." });
    await pushRecord("P0-8", "sends", { mode, delaySec, sentAt: r.sentAt, statuses: r.statuses ?? "scheduled" });
  } catch (e) { show("outPush", e.message); }
}));
$("btnBadgeClear").addEventListener("click", async () => { try { await navigator.clearAppBadge?.(); show("outPush", "badge cleared"); } catch (e) { show("outPush", e.message); } });
if (new URLSearchParams(location.search).get("from") === "push") {
  record("P0-8", { openedFromNotification: true, notificationSentAt: new URLSearchParams(location.search).get("t"), openedAt: new Date().toISOString() });
}

// ---------- P0-10: AI ----------
let aiFiles = [];
$("aiImages").addEventListener("change", (e) => { aiFiles = [...e.target.files].slice(0, 4); $("aiImgCount").textContent = `${aiFiles.length} תמונות`; });
$("btnAi").addEventListener("click", async () => {
  try {
    const t0 = performance.now();
    const images = [];
    for (const f of aiFiles) {
      const blob = await resize(await decodeImage(f), 1568, 0.8);
      const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
      images.push({ mediaType: "image/jpeg", data: b64 });
    }
    const prepMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const res = await api("/api/ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: $("aiModel").value, prompt: $("aiPrompt").value, images }) });
    const body = await res.json();
    const out = { httpStatus: res.status, model: $("aiModel").value, images: images.length, prepMs, totalMs: Math.round(performance.now() - t1), ...body };
    show("outAi", out);
    delete out.text;
    await pushRecord("P0-10", "calls", out);
  } catch (e) { show("outAi", e.message); }
});

// ---------- P0-11: light ----------
let stream = null, timer = null, lastLuma = null;
$("btnCam").addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    const v = $("video"); v.srcObject = stream; v.hidden = false; await v.play();
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() ?? {};
    const settings = track.getSettings?.() ?? {};
    await record("P0-11", { capabilityKeys: Object.keys(caps), exposureInfo: { exposureMode: caps.exposureMode ?? null, exposureTime: caps.exposureTime ?? null, iso: caps.iso ?? null, exposureCompensation: caps.exposureCompensation ?? null }, settingsKeys: Object.keys(settings) });
    show("outLight", { capabilities: caps, settings });
    const c = document.createElement("canvas"); c.width = 64; c.height = 64; const g = c.getContext("2d", { willReadFrequently: true });
    timer = setInterval(() => {
      g.drawImage(v, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      lastLuma = +(s / (d.length / 4)).toFixed(1);
      $("luma").textContent = `${lastLuma} / 255 (יחסי, לא לוקס)`;
    }, 500);
  } catch (e) { show("outLight", e.message); }
});
$("btnCamStop").addEventListener("click", () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); $("video").hidden = true; });
$("btnLightSave").addEventListener("click", async () => {
  if (lastLuma == null) return;
  const label = $("lightLabel").value;
  try {
    await apiJson("/api/light/readings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, meanLuma: lastLuma }) });
    await pushRecord("P0-11", "readings", { label, meanLuma: lastLuma });
    show("outLight", `saved ${label}: ${lastLuma}`);
  } catch (e) { show("outLight", e.message); }
});

// ---------- Results ----------
$("btnCopyResults").addEventListener("click", async () => {
  const results = (await meta("results")) ?? {};
  const summary = {
    device: { ua: navigator.userAgent, standalone: isStandalone(), screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, lang: navigator.language },
    queueNow: (await getAll("queue")).length,
    results,
  };
  const text = JSON.stringify(summary, null, 1);
  show("outResults", text);
  try { await navigator.clipboard.writeText(text); } catch { /* shown on screen for manual copy */ }
  try { await apiJson("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ testId: "summary", device: navigator.userAgent, payload: summary }) }); } catch { /* local copy remains */ }
});

// ---------- Boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
addEventListener("online", () => { refreshStatus(); sync(); });
addEventListener("offline", refreshStatus);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
setInterval(() => { if (document.visibilityState === "visible") sync(); }, 20000);
refreshStatus();
sync();
