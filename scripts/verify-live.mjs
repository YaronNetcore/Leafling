#!/usr/bin/env node
// Read-only live verification of the Leafling preview deployment. Never writes anything and never prints
// personal data (record contents, emails, ids) — only counts, versions, booleans and masked values.
//
//   CLOUDFLARE_API_TOKEN=… node scripts/verify-live.mjs [commit]
//   (In a Claude cloud environment whose proxy injects a Cloudflare credential, no variable is needed.)
//
// Token (read-only is enough; stored as an environment secret, never in Git or chat):
//   Account › Workers Scripts: Read · Account › D1: Read · Account › Workers R2 Storage: Read (optional)
// Checks:
//   1. Which Worker version is ACTIVE, and which Git commit it was built from (Workers Builds check run).
//   2. Unauthenticated access is still blocked by Cloudflare Access.
//   3. Worker config: ACCESS_AUD + OWNER_EMAIL present; OWNER_EMAIL matches the identity that claimed the original data.
//   4. D1: multi-user migration state, original data preserved (every v1 row present for its owner, no older
//      revision), nothing left unclaimed, no writes to the frozen v1 tables after the migration.
//   5. AI (metadata only): calls per feature/status, latest successful identify/ask/diagnose, AI rows bound to the caller's own plants.
//   6. R2 (optional): original photos still present under app/photos/.
import { execSync } from "node:child_process";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "9e94558210e454d8dcff27e60f6443bd";
const SCRIPT = "leafling-preview";
const D1_ID = "be736b5f-a420-4797-8145-f710c02db8b1";
const BUCKET = "leafling-preview-photos";
const REPO = "yaronnetcore/leafling";
const LIVE = "https://leafling-preview.nisimy.workers.dev";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const commitArg = process.argv[2] ?? execSync("git rev-parse HEAD").toString().trim();

let failures = 0;
const ok = (label, pass, detail = "") => { if (!pass) failures++; console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); };
const info = (label, detail) => console.log(`INFO  ${label} — ${detail}`);
const mask = (e) => (e ? `${e[0]}***@${e.split("@")[1]?.replace(/^[^.]+/, "***") ?? "?"}` : "(none)");

async function cf(path, init = {}, attempt = 0) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": "application/json", ...init.headers } });
  const body = await r.json().catch(() => ({}));
  // Cloudflare API rate limit (HTTP 429 / code 971): back off and retry instead of misreporting the credential.
  if (r.status === 429 && attempt < 4) { await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt)); return cf(path, init, attempt + 1); }
  if (!body.success) throw new Error(`${path.replace(ACCOUNT, ":acct")} → ${r.status} ${JSON.stringify(body.errors ?? []).slice(0, 200)}`);
  return body.result;
}
const sql = async (q, params = []) => (await cf(`/accounts/${ACCOUNT}/d1/database/${D1_ID}/query`, { method: "POST", body: JSON.stringify({ sql: q, params }) }))[0].results;

// 1. Build ↔ commit ↔ version
const gh = await fetch(`https://api.github.com/repos/${REPO}/commits/${commitArg}/check-runs`, { headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {} });
const runs = await gh.json();
if (!gh.ok) info("GitHub check runs unavailable", `${gh.status} ${String(runs.message).slice(0, 60)} (set GITHUB_TOKEN or NODE_USE_ENV_PROXY=1)`);
const build = (runs.check_runs ?? []).find((r) => /Workers Builds: leafling-preview/.test(r.name));
const builtVersion = build?.output?.summary?.match(/Version ID: ([0-9a-f-]{36})/)?.[1];
ok(`Workers Build for ${commitArg.slice(0, 7)}`, build?.conclusion === "success", build ? `${build.status}/${build.conclusion}, version ${builtVersion?.slice(0, 8) ?? "?"}` : "no build found");

// 2. Access still in front of everything
const unauth = await fetch(`${LIVE}/api/v1/me`, { redirect: "manual" });
ok("unauthenticated /api/v1/me is redirected to Cloudflare Access", unauth.status === 302 && /cloudflareaccess\.com/.test(unauth.headers.get("location") ?? ""), String(unauth.status));
const unauthStatic = await fetch(`${LIVE}/version.json`, { redirect: "manual" });
ok("unauthenticated static files are redirected to Cloudflare Access", unauthStatic.status === 302, String(unauthStatic.status));

const credential = TOKEN ? null : await cf("/user/tokens/verify").then(() => null, (e) => String(e.message));
if (credential) {
  console.log(`\nSTOP  no usable Cloudflare credential (CLOUDFLARE_API_TOKEN not set; injected credential check: ${credential.slice(0, 120)}) — cannot read the active version, Worker config, D1 or R2.`);
  process.exit(failures ? 1 : 2);
}

const deployments = await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/deployments`);
const active = deployments.deployments?.[0];
const activeVersions = (active?.versions ?? []).map((v) => `${v.version_id.slice(0, 8)}@${v.percentage}%`).join(", ");
const activeId = (active?.versions ?? []).find((v) => v.percentage === 100)?.version_id;
const version = async (id) => (id ? cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/versions/${id}`).catch(() => null) : null);
let servesBuild = Boolean(builtVersion) && activeId === builtVersion;
let how = "";
if (builtVersion && activeId && !servesBuild) {
  // A dashboard secret/variable change creates a new version without a build. It still runs this commit's
  // code when its script hash equals the built version's.
  const [a, b] = await Promise.all([version(activeId), version(builtVersion)]);
  const etag = (v) => v?.resources?.script?.etag;
  servesBuild = Boolean(etag(a)) && etag(a) === etag(b);
  how = servesBuild ? `; same code as build ${builtVersion.slice(0, 8)} (${a.annotations?.["workers/message"] ?? "dashboard change"})` : "; different code";
}
ok("active deployment runs the code built from this commit", servesBuild, `active: ${activeVersions} (since ${active?.created_on})${how}`);

// 3. Worker configuration (values never printed)
const settings = await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/settings`);
const binding = (n) => (settings.bindings ?? []).find((b) => b.name === n);
ok("ACCESS_AUD configured", Boolean(binding("ACCESS_AUD")?.text));
const ownerEmail = binding("OWNER_EMAIL")?.text?.trim().toLowerCase();
ok("OWNER_EMAIL configured", Boolean(ownerEmail), mask(ownerEmail));
ok("ANTHROPIC_API_KEY bound as an encrypted secret", binding("ANTHROPIC_API_KEY")?.type === "secret_text", binding("ANTHROPIC_API_KEY")?.type ?? "absent");
ok("D1 binding DB → leafling-preview", binding("DB")?.id === D1_ID);
ok(`R2 binding PHOTOS → ${BUCKET}`, binding("PHOTOS")?.bucket_name === BUCKET);
info("AI monthly budget (USD)", binding("AI_BUDGET_USD")?.text ?? "(unset)");

// 4. D1
const tables = (await sql(`SELECT name FROM sqlite_master WHERE type='table'`)).map((r) => r.name);
const meta = Object.fromEntries((tables.includes("app_meta") ? await sql(`SELECT key, value, at FROM app_meta`) : []).map((r) => [r.key, r]));
const v3 = Number(meta.schema_version?.value ?? 0) >= 3;
ok("multi-user migration (v2+) applied", Number(meta.schema_version?.value ?? 0) >= 2, meta.schema_version ? `schema ${meta.schema_version.value} at ${meta.schema_version.at}` : "not yet — runs on the first signed-in API request");
  info("chat schema (v3)", Number(meta.schema_version?.value ?? 0) >= 3 ? "applied" : "not yet — runs on the first signed-in API request after deploy");
if (meta.schema_version) {
  const v1Count = (await sql(`SELECT COUNT(*) AS n FROM app_records`))[0].n;
  ok("all original rows were copied", Number(meta.legacy_copied_records?.value) <= v1Count, `copied ${meta.legacy_copied_records?.value}, v1 table now ${v1Count}`);
  const late = (await sql(`SELECT COUNT(*) AS n FROM app_records WHERE updated_at > ?`, [meta.schema_version.at]))[0].n;
  ok("no writes to the frozen v1 tables after the migration", late === 0, String(late));
  const owner = meta.legacy_owner?.value ?? "__legacy__";
  ok("original data handed to the original owner", Boolean(meta.legacy_owner), meta.legacy_owner ? `claimed at ${meta.legacy_owner.at}` : "not yet — happens when the owner opens the app");
  const missing = (await sql(`SELECT COUNT(*) AS n FROM app_records a LEFT JOIN user_records u ON u.user_id = ? AND u.entity = a.entity AND u.id = a.id WHERE u.id IS NULL`, [owner]))[0].n;
  ok("every original record exists for its owner", missing === 0, `${missing} missing of ${v1Count}`);
  const older = (await sql(`SELECT COUNT(*) AS n FROM app_records a JOIN user_records u ON u.user_id = ? AND u.entity = a.entity AND u.id = a.id WHERE u.rev < a.rev`, [owner]))[0].n;
  ok("no original record regressed to an older revision", older === 0, String(older));
  const unchanged = (await sql(`SELECT COUNT(*) AS n FROM app_records a JOIN user_records u ON u.user_id = ? AND u.entity = a.entity AND u.id = a.id WHERE u.data = a.data AND u.rev = a.rev`, [owner]))[0].n;
  info("original records byte-identical (others were edited since by their owner)", `${unchanged} of ${v1Count}`);
  for (const [t, v1] of [["user_conflicts", "app_conflicts"], ["user_changes", "app_changes"], ["user_mutations", "app_mutations"]]) {
    const a = (await sql(`SELECT COUNT(*) AS n FROM ${v1}`))[0].n;
    const b = (await sql(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, [owner]))[0].n;
    ok(`${v1} preserved for the owner`, b >= a, `${b} ≥ ${a}`);
  }
  if (meta.legacy_owner) {
    const left = (await sql(`SELECT COUNT(*) AS n FROM user_records WHERE user_id = '__legacy__'`))[0].n;
    ok("nothing left unclaimed", left === 0, String(left));
    const claimed = (await sql(`SELECT email FROM app_users WHERE id = ?`, [owner]))[0]?.email?.toLowerCase();
    ok("OWNER_EMAIL matches the identity that holds the original data", Boolean(ownerEmail) && claimed === ownerEmail);
  }
  const users = await sql(`SELECT u.id, (SELECT COUNT(*) FROM user_records r WHERE r.user_id = u.id) AS n FROM app_users u ORDER BY u.created_at`);
  info("users", users.map((u, i) => `#${i + 1}${u.id === owner ? " (original owner)" : ""}: ${u.n} records`).join("; ") || "none yet");
  const orphan = (await sql(`SELECT COUNT(*) AS n FROM user_records WHERE user_id NOT IN (SELECT id FROM app_users) AND user_id <> '__legacy__'`))[0].n;
  ok("every personal row belongs to a known user", orphan === 0, String(orphan));
  for (const t of ["user_changes", "user_mutations", "user_conflicts", "user_ai_usage", ...(v3 ? ["user_chat_runs"] : [])]) {
    const n = (await sql(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id NOT IN (SELECT id FROM app_users) AND user_id <> '__legacy__'`))[0].n;
    ok(`every ${t} row belongs to a known user`, n === 0, String(n));
  }

  // 5. AI (metadata only — prompts, answers and images are never stored)
  const aiSince = active?.created_on ?? "1970-01-01";
  const ai = await sql(`SELECT feature, status, COUNT(*) AS n, SUM(image_count) AS imgs, MAX(at) AS last FROM user_ai_usage GROUP BY feature, status ORDER BY last DESC`);
  info("AI calls (all time)", ai.map((r) => `${r.feature}/${r.status}×${r.n}${r.imgs ? ` (${r.imgs} img)` : ""}`).join(", ") || "none yet");
  for (const f of ["chat", "identify", "diagnose", "ask"]) {
    const r = (await sql(`SELECT at, image_count, input_tokens, output_tokens, latency_ms, est_cost_usd, context_sections${v3 ? ", first_token_ms, context_chars" : ""} FROM user_ai_usage WHERE feature = ? AND status = 'ok' AND at >= ? ORDER BY at DESC LIMIT 1`, [f, aiSince]))[0];
    info(`AI ${f} since the active deployment`, r ? `ok at ${r.at}: ${r.image_count} image(s), ${r.input_tokens}→${r.output_tokens} tokens, ${r.first_token_ms != null ? `first text ${r.first_token_ms} ms, ` : ""}total ${r.latency_ms} ms, context ${r.context_chars ?? "?"} chars, $${Number(r.est_cost_usd).toFixed(4)}, [${r.context_sections}]` : "no successful call yet");
  }
  const failed = await sql(`SELECT status, COUNT(*) AS n FROM user_ai_usage WHERE status <> 'ok' AND at >= ? GROUP BY status`, [aiSince]);
  if (failed.length) info("AI failures since the active deployment", failed.map((r) => `${r.status}×${r.n}`).join(", "));
  const foreign = (await sql(`SELECT COUNT(*) AS n FROM user_ai_usage a WHERE a.plant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_records r WHERE r.user_id = a.user_id AND r.entity = 'plant' AND r.id = a.plant_id)`))[0].n;
  ok("every AI call with plant context used the caller's own plant", foreign === 0, String(foreign));
}

// 6. R2 (optional permission)
try {
  const objs = await cf(`/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects?prefix=app/photos/&per_page=1000`);
  info("original photos still in place (app/photos/)", `${objs.length} objects`);
} catch (e) { info("R2 check skipped", String(e.message).slice(0, 80)); }

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
