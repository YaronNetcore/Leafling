#!/usr/bin/env node
// Read-only live verification of the Leafling preview deployment. Never writes anything and never prints
// personal data (record contents, emails, ids) — only counts, versions, booleans and masked values.
//
//   CLOUDFLARE_API_TOKEN=… node scripts/verify-live.mjs [commit]
//
// Token (read-only is enough; stored as an environment secret, never in Git or chat):
//   Account › Workers Scripts: Read · Account › D1: Read · Account › Workers R2 Storage: Read (optional)
// Checks:
//   1. Which Worker version is ACTIVE, and which Git commit it was built from (Workers Builds check run).
//   2. Unauthenticated access is still blocked by Cloudflare Access.
//   3. Worker config: ACCESS_AUD + OWNER_EMAIL present; OWNER_EMAIL matches the identity that claimed the original data.
//   4. D1: multi-user migration state, original data preserved (every v1 row present for its owner, no older
//      revision), nothing left unclaimed, no writes to the frozen v1 tables after the migration.
//   5. R2 (optional): original photos still present under app/photos/.
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

async function cf(path, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...init.headers } });
  const body = await r.json().catch(() => ({}));
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

if (!TOKEN) {
  console.log("\nSTOP  CLOUDFLARE_API_TOKEN not set — cannot read the active version, Worker config, D1 or R2.");
  process.exit(failures ? 1 : 2);
}

const deployments = await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/deployments`);
const active = deployments.deployments?.[0];
const activeVersions = (active?.versions ?? []).map((v) => `${v.version_id.slice(0, 8)}@${v.percentage}%`).join(", ");
ok("active deployment serves the version built from this commit", Boolean(builtVersion) && (active?.versions ?? []).some((v) => v.version_id === builtVersion && v.percentage === 100), `active: ${activeVersions} (since ${active?.created_on})`);

// 3. Worker configuration (values never printed)
const settings = await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/settings`);
const binding = (n) => (settings.bindings ?? []).find((b) => b.name === n);
ok("ACCESS_AUD configured", Boolean(binding("ACCESS_AUD")?.text));
const ownerEmail = binding("OWNER_EMAIL")?.text?.trim().toLowerCase();
ok("OWNER_EMAIL configured", Boolean(ownerEmail), mask(ownerEmail));
info("ANTHROPIC_API_KEY secret", binding("ANTHROPIC_API_KEY") ? "present" : "absent");

// 4. D1
const tables = (await sql(`SELECT name FROM sqlite_master WHERE type='table'`)).map((r) => r.name);
const meta = Object.fromEntries((tables.includes("app_meta") ? await sql(`SELECT key, value, at FROM app_meta`) : []).map((r) => [r.key, r]));
ok("migration v2 applied", meta.schema_version?.value === "2", meta.schema_version ? `at ${meta.schema_version.at}` : "not yet — runs on the first signed-in API request");
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
}

// 5. R2 (optional permission)
try {
  const objs = await cf(`/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects?prefix=app/photos/&per_page=1000`);
  info("original photos still in place (app/photos/)", `${objs.length} objects`);
} catch (e) { info("R2 check skipped", String(e.message).slice(0, 80)); }

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
