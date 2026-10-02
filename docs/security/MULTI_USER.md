# Leafling — multi-user isolation

Leafling serves a few independent people (currently: the original owner + two more). Each person
has a **completely private** environment. There is no shared collection, no admin view and no way
for one user to see, change, download, sync or infer another user's data.

## 1. Rules for all future work (read before touching the API, D1, R2 or local storage)
1. **Identity comes only from `authenticate()` → `resolveUser()`** (`src/worker/auth.ts`, `src/worker/users.ts`).
   Handlers receive `user.id`; they never read an owner, user id or email from the URL, headers or body.
   (`X-Leafling-User` is a client-side latch, see §5. It is compared with the verified identity, never used as one.)
2. **Every personal row has `user_id`**, and **every** SQL statement that touches a personal table binds
   `user_id = ?` with the verified id — reads, writes, counts, dedupe lookups, conflict updates, AI context.
   New personal tables must have `user_id TEXT NOT NULL` as the first column of their primary key or a
   leading index column. Global data (species catalog) must not contain personal data.
3. **"Not found" and "not yours" look identical** (same status, same body). Errors never echo stored data.
4. **R2 keys are built on the server** as `users/{userId}/photos/{uuid}/{original|display|thumb}`.
   Never accept a path, prefix or key from the browser. The bucket stays private; no public URLs. If signed
   URLs are ever introduced, authorize first and sign only keys under the caller's prefix.
5. **Responses with personal data are not shared-cacheable**: JSON is `no-store`; photos are
   `private, no-cache` (ETag revalidation). The service worker never caches `/api/*`.
6. **Local data is per user**: IndexedDB `leafling-u-{userId}`. Never store personal data in
   `localStorage`, shared IndexedDB names, Cache Storage, or module-level state that survives a user change.
   A user change always reloads the app.
7. **AI context** is assembled on the server, only from the caller's rows (one plant). The model never
   gets other plants, other users, or anything the browser claims about ownership.
8. **Add a test** to `tests/isolation.test.ts` (server) or `tests/e2e/device-isolation.e2e.ts` (device) for
   every new endpoint or storage location: user B must get nothing of user A through it.

## 2. Identity
- Cloudflare Access (Zero Trust Free, email one-time PIN) decides **who may sign in** (the Access policy's
  allowed emails). Nothing else in the app grants access.
- The Worker validates `Cf-Access-Jwt-Assertion`: RS256 signature with the team's published certs (kid
  lookup + one refresh), `aud` = `ACCESS_AUD`, `iss` = `https://<team>.cloudflareaccess.com`, `exp`,
  `nbf`, `type = app`, non-empty `sub` and `email`. Fails closed (503) if `ACCESS_AUD` is not configured.
- **Permanent key = Access `sub`** (stable per identity), not the email. `app_users`:
  `id` (internal UUID), `access_sub` (UNIQUE), `email` (latest seen), `created_at`, `last_login_at`.
  A row is created on the first verified request. An email change with the same `sub` keeps the same user.
- `/api/v1/me` returns `{ userId, email, isLegacyOwner, ai }`.

## 3. Database ownership (D1, one database for everyone)
| Table | Key | Content |
|---|---|---|
| `app_users` | `id`; `access_sub` unique | internal users |
| `app_meta` | `key` | `schema_version`, `legacy_owner`, `legacy_copied_records` |
| `user_records` | (`user_id`, `entity`, `id`) + index (`user_id`, `rev`) | all personal entities: plants (incl. seedlings/propagation/lineage fields), events (watering, soil checks, fertilizing, journal, history, milestones), photos metadata, locations, light readings, reminders/tasks, wishlist, health cases, profile/settings; trash = `deletedAt` on the record |
| `user_changes` | (`user_id`, `seq`) | per-user change sequence (server-ordered revisions) |
| `user_mutations` | (`user_id`, `mutation_id`) | per-user idempotency (a replayed id from another user is just a new mutation) |
| `user_conflicts` | `id`, index (`user_id`, `id`) | overwritten values, restorable |
| `user_ai_usage` | `id`, index (`user_id`, `at`) | AI metadata only (no prompts/answers) |
| `app_records`, `app_changes`, `app_mutations`, `app_conflicts`, `app_ai_usage` | — | **v1 tables, frozen** — no longer read or written; kept as an in-database backup |
| `spike_*` | — | Phase 0 harness (owner-only, unchanged) |

Sync: idempotent push of ≤8 mutations, per-user optimistic compare-and-set on `(user_id, seq)`, conflicts
ordered by server receipt (device clocks are metadata only). Different users never contend. Export = the
paginated pull of the caller's own records; restore/trash recovery = ordinary mutations into the caller's
own key space — a manipulated backup or payload with foreign ids or `user_id` fields only ever writes the
caller's own rows.

## 4. Migration of the original data (v1 → v2)
- Applied automatically by the Worker on the first API request after deploy (`migrate()` in
  `src/worker/schema.ts`; reviewable SQL in `migrations/0002_user_ownership.sql`).
- **Additive only.** `CREATE TABLE IF NOT EXISTS` + `INSERT … SELECT` copies; nothing is dropped,
  truncated, updated or deleted in the v1 tables. IDs, revisions, relationships (plantId links), conflict
  history and mutation ids are copied verbatim, so existing phones' sync cursors stay valid.
- **Atomic and safe to interrupt:** the copy runs as one D1 batch (one transaction) whose first statement
  inserts `schema_version=2`; either everything is copied or nothing is, and a concurrent second run fails
  on that key and rolls back.
- Copied rows get `user_id = '__legacy__'`, which **no user can see**.
- **Hand-over to the original owner:** the v1 app accepted exactly one identity — the verified Access
  email equal to `OWNER_EMAIL`. On that identity's first request, one atomic batch inserts
  `app_meta.legacy_owner = <their internal id>` (primary key ⇒ can happen only once) and re-labels the
  `'__legacy__'` rows to them. Nobody else can trigger it; signing in first does not matter. If
  `OWNER_EMAIL` is missing, the data simply stays invisible (safe) until it is set.
- Photos: v1 objects stay at `app/photos/{id}/{variant}` (untouched); only the claimed owner can read them.
- Owner's existing phone: the old local database `leafling` (including unsynced changes and unsent photos)
  is copied into `leafling-u-{ownerId}` in one transaction, then removed — only when the server says the
  signed-in user is the legacy owner. For anyone else it is left alone and never uploaded.

### Backups
- **In-database backup:** the frozen v1 tables (same database).
- **D1 Time Travel** (point-in-time restore, available on the Free plan for the last 7 days) covers the
  whole database including the new tables. *Not verified by the developer — no Cloudflare access; the owner
  can see it in Dashboard → D1 → `leafling-preview` → Time Travel.*
- **App export** (Settings → "ייצוא נתונים") gives each user a JSON copy of their own records.

### Automated live check
`npm run verify:live -- <commit>` (read-only, needs `CLOUDFLARE_API_TOKEN` with Workers Scripts Read + D1 Read, optional R2 Read): maps the commit to its Workers Build and Version ID, confirms that version is active, checks Access still blocks unauthenticated requests, `ACCESS_AUD`/`OWNER_EMAIL` are set and `OWNER_EMAIL` matches the identity holding the original data, and runs the preservation checks below. It also checks the `DB`/`PHOTOS` bindings and the encrypted `ANTHROPIC_API_KEY` binding, accepts a dashboard secret/variable version only when its script hash equals the build's, reports AI calls per feature/status (failed attempts are recorded as metadata-only rows since 2026-10-02) and checks that every AI call with plant context used the caller's own plant. In a Claude cloud environment whose proxy injects the Cloudflare credential, no variable is needed. Prints only counts, versions and masked values.

### Checks after deploy (D1 console, read-only)
```sql
SELECT key, value, at FROM app_meta;                                   -- schema_version=2, legacy_owner set after the owner opened the app
SELECT COUNT(*) FROM app_records;                                       -- v1 rows (unchanged)
SELECT value FROM app_meta WHERE key='legacy_copied_records';           -- must equal the line above at migration time
SELECT user_id, COUNT(*) FROM user_records GROUP BY user_id;            -- '__legacy__' must be gone once the owner signed in
SELECT id, email, created_at, last_login_at FROM app_users;             -- one row per person
-- Writes by an old Worker instance during the few seconds of global rollout (expected 0). Such rows are
-- still safe in app_records; if any exist, re-sync from the owner's phone or copy them over by hand.
SELECT COUNT(*) FROM app_records WHERE updated_at > (SELECT at FROM app_meta WHERE key='schema_version');
```

### Recovery
- *Owner sees an empty app after deploy:* check `SELECT * FROM app_meta`. No `legacy_owner` → `OWNER_EMAIL`
  is missing/different in Worker → Settings → Variables; fix it and reload (the claim runs on the next request).
  `legacy_owner` set to an unexpected id → see the next item.
- *Owner's Access identity was re-created (new `sub`) and they now get a new empty user:* in the D1 console,
  find both rows in `app_users` (same email). If the new row has no data
  (`SELECT COUNT(*) FROM user_records WHERE user_id='<new id>'` = 0):
  `DELETE FROM app_users WHERE id='<new id>'; UPDATE app_users SET access_sub='<new sub>' WHERE id='<old id>';`
  (the new `sub` is the value in the new row before deleting it).
- *Something went wrong in the copy:* nothing in the v1 tables changed; restore with D1 Time Travel to a
  timestamp before the deploy, or re-run the `INSERT … SELECT` copy statements of `0002` (not the `app_meta` inserts) after
  deleting the v2 rows of `'__legacy__'` only. Do **not** roll the Worker back to the single-user version: it would read the frozen
  v1 tables and miss everything written since.

## 5. Device / offline isolation
- Boot: `/api/v1/me` → internal user id → open `leafling-u-{userId}`. The last **confirmed** id is
  remembered in `localStorage` (`leafling.lastUser`) only so the app opens offline; explicit sign-out
  (Settings → "התנתקות / החלפת משתמש" → `/cdn-cgi/access/logout`) forgets it, so a signed-out device
  shows a sign-in screen offline, not the previous user's data.
- **Latch:** every API call sends `X-Leafling-User: <owner of the open local DB>`. Writes without it are
  refused (428); a mismatch with the verified identity is refused (409 `user_mismatch`) **before** anything
  is read or written. The app then stops and restarts as the signed-in user. Queued changes stay in their
  owner's database and sync when that owner signs in again.
- Settings also offers "delete my local copy from this device" (only when nothing is pending).
- Known limit: while **offline** the app shows the last confirmed user's local copy (no authentication is
  possible offline). People sharing one browser profile should sign out explicitly; separate devices or
  browser profiles are the natural setup.

## 6. Security tests
Server: `tests/isolation.test.ts` — the real deployed Worker entry in Miniflare/workerd with local D1+R2,
real RS256 JWTs from a throwaway key pair, JWKS served through a mocked outbound fetch, a representative
v1 database + v1 photo, three identities (+ an "imposter" with the owner's email but another `sub`).
Device: `tests/e2e/device-isolation.e2e.ts` — the production build in headless Chromium against the same
Worker; a local proxy injects the Access JWT for the identity in a cookie (what Access does).

| # | Requirement | Test |
|---|---|---|
| 1 | B can't retrieve A's plant | pull / delta pull / export contain nothing of A |
| 2 | B can't modify A's plant via ids | push with A's id writes B's own row; A's row unchanged |
| 3 | B can't delete A's records | soft delete / trash on A's ids; DELETE/PATCH routes don't exist |
| 4 | B can't access A's photos | GET 404 (incl. conditional requests and v1 objects), traversal rejected, same-id upload lands in B's prefix, A's bytes unchanged |
| 5 | no leak through sync | pull at every cursor; replaying A's mutation id is not reported as duplicate |
| 6 | journal/history | A's events never in B's pull |
| 7 | export | export = caller's pull |
| 8 | restore/overwrite | resolving A's conflict id → 404; manipulated restore payload only touches B |
| 9 | AI context | B with A's plant id gets only B's copy / 404; A's photo ids refused before any upstream call; A's call includes A's history only |
| 10 | same device | B's UI, B's IndexedDB, browser HTTP cache and SW caches show nothing of A |
| 11 | offline queue | A's offline change + account switch → server refuses, nothing written for B, A's queue intact, later synced under A |
| 12 | data intact after migration | v1 tables byte-identical; owner sees every row with the same revision; nobody else sees any; conflicts, mutation ids and photos stay with the owner; a non-owner signing in first gets nothing |
| 13 | forged/invalid JWT | forged signature, unknown kid, wrong aud/iss, expired, no exp, nbf in future, alg none/HS256, no sub, no email, wrong type, malformed, tampered payload |
| 14 | missing auth | every personal endpoint → 401 |
| 15 | Phase 0 | harness works for the owner, 403 for others, 401 without token |
| — | new data (2026-10) | light observations, multiple pets, identification images and AI context (light estimates, pet kinds) stay in the caller's space; foreign plant ids → own space / 404 |
| — | concurrency | three users pushing in parallel (with CAS retries) never mix; per-user revisions unique |

Run: `npm test` (unit + server isolation) and `npm run test:e2e` (builds, then the browser tests).
Each suite was also checked against deliberately broken code (unscoped pull, no legacy gate, no client
latch) and fails as expected.
