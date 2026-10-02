import type { Identity } from "./auth.ts";
import type { AppEnv } from "./env.ts";
import { HttpError, logEvent } from "./http.ts";
import { LEGACY_OWNER } from "./schema.ts";

// Internal users. The permanent key is the verified Access `sub` (never the email, never anything
// the browser sends). A row is created on first verified access.
//
// Legacy (pre-multi-user) data belongs to the original owner. The v1 app accepted exactly one
// identity — the verified Access email equal to OWNER_EMAIL — so that identity, and only that one,
// may claim the '__legacy__' rows, exactly once (app_meta 'legacy_owner' PRIMARY KEY makes the
// claim atomic and unrepeatable). Anyone else who signs in first simply gets an empty environment.

export interface AppUser { id: string; email: string; isLegacyOwner: boolean }

let legacyOwnerCache: string | null = null; // set once claimed; never changes afterwards

async function legacyOwner(env: AppEnv): Promise<string | null> {
  if (legacyOwnerCache) return legacyOwnerCache;
  const r = await env.DB.prepare(`SELECT value FROM app_meta WHERE key = 'legacy_owner'`).first<{ value: string }>();
  if (r) legacyOwnerCache = r.value;
  return r?.value ?? null;
}

const REASSIGN = [
  `UPDATE user_records SET user_id = ?1 WHERE user_id = '${LEGACY_OWNER}'`,
  `UPDATE user_changes SET user_id = ?1 WHERE user_id = '${LEGACY_OWNER}'`,
  `UPDATE user_mutations SET user_id = ?1 WHERE user_id = '${LEGACY_OWNER}'`,
  `UPDATE user_conflicts SET user_id = ?1 WHERE user_id = '${LEGACY_OWNER}'`,
  `UPDATE user_ai_usage SET user_id = ?1 WHERE user_id = '${LEGACY_OWNER}'`,
];

async function claimLegacy(env: AppEnv, userId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO app_meta (key, value, at) VALUES ('legacy_owner', ?1, ?2)`).bind(userId, now),
      ...REASSIGN.map((s) => env.DB.prepare(s).bind(userId)),
    ]);
    logEvent("users.legacy_claim", { outcome: "claimed" });
  } catch {
    // The batch rolled back as a whole. Normal cause: a concurrent request claimed first. Anything else
    // (e.g. a key collision) leaves the legacy rows untouched and still invisible — see recovery docs.
    legacyOwnerCache = null;
    if (!(await legacyOwner(env))) logEvent("users.legacy_claim", { outcome: "failed_rolled_back" });
  }
}

export async function resolveUser(env: AppEnv, who: Identity): Promise<AppUser> {
  const db = env.DB;
  const now = new Date().toISOString();
  let row = await db.prepare(`SELECT id, email, last_login_at FROM app_users WHERE access_sub = ?`).bind(who.sub)
    .first<{ id: string; email: string; last_login_at: string }>();
  if (!row) {
    await db.prepare(`INSERT OR IGNORE INTO app_users (id, access_sub, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), who.sub, who.email, now, now).run();
    row = await db.prepare(`SELECT id, email, last_login_at FROM app_users WHERE access_sub = ?`).bind(who.sub)
      .first<{ id: string; email: string; last_login_at: string }>();
    if (!row) throw new HttpError(500, "user_create_failed");
    logEvent("users.created", { outcome: "ok" });
  } else if (row.email !== who.email || Date.parse(row.last_login_at) < Date.now() - 3600_000) {
    await db.prepare(`UPDATE app_users SET email = ?, last_login_at = ? WHERE id = ?`).bind(who.email, now, row.id).run();
  }

  let owner = await legacyOwner(env);
  if (!owner && env.OWNER_EMAIL && who.email === env.OWNER_EMAIL.trim().toLowerCase()) {
    await claimLegacy(env, row.id);
    owner = await legacyOwner(env);
  }
  return { id: row.id, email: who.email, isLegacyOwner: owner === row.id };
}
