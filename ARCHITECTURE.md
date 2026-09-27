# Leafling — Technical Architecture Proposal

Status: **Proposal, pending owner approval.** Nothing in this document has been implemented.
Product source of truth: `PRODUCT_SPEC.md`. If this document contradicts it, `PRODUCT_SPEC.md` wins and this document must be corrected.
Date of platform research: 2026-09-27. Limits and prices below were checked against official Cloudflare, WebKit and Anthropic documentation on that date and must be re-checked when resources are created.

Legend used for key choices:
**Recommendation / Reason / Limitations / Security / Cost / Rejected alternative / Why rejected.**

---

## 1. Executive summary

Leafling is a single-user, Hebrew-first, RTL, iPhone-first PWA for managing personal plants. The proposed architecture is deliberately small:

- **One Cloudflare Worker** (with Workers Static Assets) serves the built PWA, the JSON API, photo delivery, the Claude proxy, and scheduled jobs (notifications, backups). One deployable, one origin, no CORS.
- **Cloudflare Access** in front of the whole origin restricts use to one authorized person without building an account system. The Worker also verifies the Access JWT (defense in depth).
- **Cloudflare D1** (SQLite) holds all structured data. An **append-only event log** per plant is the long-term memory; "current state" columns are maintained in the same atomic batch as each event.
- **Cloudflare R2** (private buckets) stores byte-identical original photos plus technical derivatives (display and thumbnail), generated **on the iPhone** at upload time so the server never needs image-processing infrastructure.
- **Local-first client**: the PWA reads from IndexedDB and writes into a local **outbox** first; a sync engine pushes idempotent mutations and pulls deltas. A network failure never loses a write.
- **Claude API** is called only from the Worker. The Worker, not the client, builds a **minimal, plant-scoped context** from D1. AI output can only *propose* changes; every mutation requires explicit confirmation and then goes through the same API as a manual edit.
- **Web Push** (supported for Home Screen web apps on iOS 16.4+, Declarative Web Push on iOS 18.4+) for important tasks only, sent from a Cron-triggered job.
- **Backups**: D1 Time Travel (point-in-time, 30 days on Workers Paid) + nightly logical export to a separate R2 backup bucket + a downloadable full export for an off-Cloudflare copy.
- **GitHub (private) → Cloudflare Workers Builds** for automatic deployments; GitHub Actions for tests. Separate preview and production resources.

Expected recurring infrastructure cost: **about US$5/month** (Workers Paid, recommended for production) plus near-zero R2 overage, plus **Claude API usage** capped by a hard monthly budget (recommended default cap US$10/month; see §21).

Nothing depends on a Mac, Xcode, the App Store, a private server, or a personal computer staying on.

---

## 2. Proposed technology stack

| Layer | Recommendation | Main rejected alternative |
|---|---|---|
| Language | TypeScript everywhere (client, Worker, shared domain) | Separate languages per tier |
| Frontend | React 19 + Vite, client-rendered SPA | SvelteKit / Next.js / Remix |
| Routing | React Router (SPA mode) | File-based SSR routers |
| Styling | Tailwind CSS v4 using **logical** utilities only (`ms-`, `pe-`, `start-`, `end-`), design tokens as CSS variables | CSS-in-JS |
| UI primitives | Radix UI primitives (dialog, sheet, tabs, popover) wrapped with `DirectionProvider dir="rtl"`; own components on top | Full component kit (MUI/Chakra) |
| Local storage | IndexedDB via **Dexie** (+ `liveQuery`) | localStorage, raw IndexedDB, PouchDB |
| Service worker | Workbox via `vite-plugin-pwa` in `injectManifest` mode (custom SW for push + caching) | Hand-written SW with no tooling |
| Validation / shared types | **Zod** schemas in `shared/`, used by client and Worker | Duplicated types |
| Server | **Cloudflare Worker** + **Hono** router, Workers Static Assets for the SPA | Cloudflare Pages + Pages Functions |
| Build integration | `@cloudflare/vite-plugin` (one Vite project builds SPA + Worker; local dev runs in `workerd`) | Two separate projects |
| Database | **Cloudflare D1** + **Drizzle ORM** for typed queries; SQL migrations committed and applied with `wrangler d1 migrations` | Durable Objects SQLite, external Postgres |
| Object storage | **Cloudflare R2** (private, bindings only) | Cloudflare Images, S3 |
| Auth | **Cloudflare Access** (Zero Trust Free) + JWT verification in Worker (`jose`) | Custom login / passkeys (kept as contingency only) |
| AI | Anthropic Messages API via official `@anthropic-ai/sdk` from the Worker; structured outputs; prompt caching | Client-side calls; Cloudflare AI Gateway (optional later) |
| Push | Web Push (VAPID) from Worker via a WebCrypto-based library; Declarative Web Push payload format when supported | Third-party push service (OneSignal etc.) |
| Weather | **Open-Meteo** (no key) called by the Worker | OpenWeatherMap, Apple WeatherKit |
| Tests | Vitest (+ `@cloudflare/vitest-pool-workers`), Playwright (WebKit, iPhone viewport) | Jest |
| CI/CD | GitHub Actions (tests, no secrets) + **Cloudflare Workers Builds** (deploy) | Deploying from a personal machine |
| Package manager | pnpm | npm/yarn (either would work) |

### Key choice: frontend framework
- **Recommendation:** React + Vite SPA, TypeScript.
- **Reason:** The app is fully behind authentication and must work offline, so SEO/SSR brings no value; a client-rendered SPA is the simplest model for a local-first app. React has the largest ecosystem for the pieces we need (Radix with RTL `DirectionProvider`, Dexie hooks, Workbox integration), and is the most reliably supported by AI-assisted development.
- **Limitations:** Larger runtime than Svelte/Solid (~45 KB gz). Mitigated by route-level code splitting and precaching.
- **Security:** No server rendering of user data → smaller attack surface; strict CSP possible (no inline scripts).
- **Cost:** None.
- **Rejected:** SvelteKit (smaller bundles, good DX). **Why:** smaller ecosystem for accessible RTL-aware primitives, and its SSR/adapter model adds concepts we do not need. Next.js/Remix rejected: SSR-centric, heavier on Workers, no benefit behind Access.

### Key choice: Hebrew RTL implementation
- `<html lang="he" dir="rtl">`, manifest `"dir": "rtl", "lang": "he"`.
- Logical CSS properties only; lint rule forbids physical `left/right/ml/mr/pl/pr`.
- Scientific names, NPK values, measurements with Latin units rendered in `<bdi>` / `dir="ltr"` spans with `unicode-bidi: isolate`. AI structured output returns scientific names in separate fields so the UI can isolate them.
- Numbers/dates via `Intl` with `he-IL`; metric units only; `Intl.PluralRules('he')` for counts.
- Hebrew font self-hosted (e.g., Rubik/Assistant/Heebo, OFL) — no runtime Google Fonts request (privacy, offline).
- Directional icons (back arrows, chevrons, swipe galleries) mirrored for RTL; gallery swipe direction follows RTL reading order.

---

## 3. Repository and project structure

Single private GitHub repository, single package (no monorepo tooling needed):

```
leafling/
├─ PRODUCT_SPEC.md                # product source of truth
├─ ARCHITECTURE.md                # this document
├─ PROJECT_STATE.md               # phase / status tracker
├─ assets/brand/                  # approved original icon (unchanged) — added in Phase 1
├─ src/
│  ├─ app/                        # React PWA
│  │  ├─ routes/                  # today, find, plants, locations, tools, plant/:id, settings…
│  │  ├─ components/              # design-system components (RTL-aware)
│  │  ├─ features/                # vertical feature modules (watering, journal, health…)
│  │  ├─ data/                    # Dexie schema, repositories, outbox, sync engine
│  │  ├─ media/                   # EXIF read, derivative generation, upload queue
│  │  ├─ sw/                      # service worker (Workbox, push, notificationclick)
│  │  └─ strings/he.ts            # all Hebrew UI copy in one place
│  ├─ worker/                     # Cloudflare Worker
│  │  ├─ index.ts                 # fetch + scheduled handlers
│  │  ├─ auth/                    # Access JWT verification
│  │  ├─ api/                     # Hono routes: sync, photos, ai, push, export
│  │  ├─ ai/                      # context builder, prompts, schemas, budget
│  │  ├─ jobs/                    # cron: notifications, backup, retention, restore-verify
│  │  └─ integrations/            # weather, plant data sources
│  └─ shared/                     # pure domain logic, used by client AND worker
│     ├─ schema/                  # Zod: entities, event payloads, mutations, AI proposals
│     ├─ domain/                  # naming (#2/#3), soil-check model, dry-down learning,
│     │                           # fertilizer windows, task generation, confidence rules,
│     │                           # group split/thin, lineage, cascade policy
│     └─ constants/
├─ migrations/                    # D1 SQL migrations (0001_init.sql …), forward-only
├─ tests/                         # unit, worker-integration, e2e (Playwright)
├─ docs/runbooks/                 # restore, key rotation, incident steps (added in Phase 1)
├─ wrangler.jsonc                 # bindings per environment (no secrets)
└─ .github/workflows/ci.yml
```

Rule: **domain rules live only in `src/shared/domain`** and are pure functions with unit tests. The client uses them for immediate offline results; the Worker uses the same code for authoritative results and notifications, so the two never disagree.

---

## 4. System components

```
 iPhone (Home Screen PWA, Safari engine)
 ┌──────────────────────────────────────────────┐
 │ React UI  ──reads──▶ IndexedDB (Dexie)       │
 │    │ writes              ▲   ▲               │
 │    ▼                     │   │ pull deltas   │
 │ Outbox (mutations, photo blobs) ──push──┐    │
 │ Service Worker: precache, thumb cache,  │    │
 │                 push, notificationclick │    │
 └─────────────────────────────────────────┼────┘
                                           │ HTTPS, same origin
                               ┌───────────▼───────────┐
                               │  Cloudflare Access    │  (identity check, cookie)
                               └───────────┬───────────┘
                               ┌───────────▼───────────────────────────────┐
                               │ Leafling Worker                           │
                               │  static assets │ /api/sync │ /api/photos  │
                               │  /api/ai │ /api/push │ /api/export        │
                               │  scheduled(): notifications, backup,      │
                               │               retention, restore-verify   │
                               └──┬─────────┬──────────┬──────────┬────────┘
                                  │         │          │          │
                               D1 (data)  R2 photos  R2 backups   External HTTPS:
                                                                  Anthropic API,
                                                                  Open-Meteo,
                                                                  plant-data sources,
                                                                  Apple Web Push service
```

| Component | Responsibility |
|---|---|
| PWA UI | 5-tab navigation, floating +, all screens; reads only from local store |
| Local store (IndexedDB) | Full copy of the user's structured data (small: MBs), pending photo blobs, sync cursor |
| Outbox + sync engine | Durable queue of idempotent mutations; retries with backoff; pulls change log |
| Service worker | App-shell precache, thumbnail/display image cache, push display, notification click routing |
| Access | Authenticates the one authorized person before any request reaches the Worker |
| Worker API | Validates JWT + input, applies mutations atomically, serves photos, AI proxy, export |
| Worker cron | Important-task notifications, nightly backup, trash purge, monthly restore verification, weather refresh |
| D1 | Structured data, event log, change log, AI metadata, push subscriptions |
| R2 `leafling-photos` | Originals + derivatives, private |
| R2 `leafling-backups` | Nightly logical DB exports, manifests |

---

## 5. End-to-end data flow

**A. Soil check from Today (offline-capable):**
1. User taps "יבש – השקיתי". UI calls `mutate({type:'soil_check.record', plantId, result:'dry', watered:true})`.
2. Client writes, in one IndexedDB transaction: the events (`soil_check`, `watering`), the updated plant current state, the recomputed next task (via shared domain code), and an outbox entry with a client-generated `mutationId` (UUIDv7).
3. UI updates instantly (live query). A small indicator shows "נשמר במכשיר" until synced.
4. Sync engine sends the outbox batch to `POST /api/sync/push`. Worker verifies JWT, validates with Zod, checks `mutationId` idempotency table, applies all statements in one **D1 `batch()`** (atomic), recomputes tasks with the same shared code, appends to `change_log`, returns new server sequence.
5. Client marks mutation acknowledged; `pull` retrieves any server-side changes (e.g., re-derived tasks).

**B. Adding a journal photo:**
1. User picks/takes a photo. Client reads EXIF capture date (not modifying the file), computes SHA-256, generates `display` (≈1600 px long edge) and `thumb` (≈400 px) JPEG/WebP derivatives via `createImageBitmap` + canvas (derivatives contain no EXIF/GPS).
2. Original blob + derivatives stored in IndexedDB; a `photo.create` mutation is queued; UI shows the local thumbnail immediately.
3. Upload queue sends original (byte-for-byte) then derivatives to `PUT /api/photos/:id/{original|display|thumb}`. Worker verifies SHA-256 of the original before committing the `photos` row as `stored`.
4. Only after server confirmation are local original blobs eligible for removal from IndexedDB (derivatives remain in cache).

**C. AI Botanist question from a plant card:**
1. Client sends `{feature:'botanist', plantId, question, imageIds[], conversationId}` — **no plant data** in the request body beyond IDs and the question.
2. Worker checks budget + rate limit, loads that plant's memory digest from D1 via the context builder (§12), fetches referenced AI-renditions from R2, calls Claude with structured output, streams the answer back.
3. Any proposed actions arrive as typed `proposals[]`; UI renders confirm cards. On confirm, the client submits a normal mutation tagged `source:'ai_confirmed', aiProposalId`.

---

## 6. Authentication and authorization

### Recommendation: Cloudflare Access in front of the whole origin, plus JWT verification in the Worker
- **Reason:** Meets "one authorized user, no custom email/password system" with zero auth code to maintain. Access runs before the Worker, so unauthenticated traffic never reaches application code, D1, R2 or the Claude proxy — this is also the primary abuse protection for AI spend.
- **Configuration:**
  - Zero Trust **Free** plan (free up to 50 users; we use 1).
  - Self-hosted Access application covering the production hostname (all paths).
  - Policy: *Allow* — emails equal to the owner's single address. Everything else denied.
  - Identity method (owner decision, §24): **One-time PIN to email** (simplest, no third-party IdP) or Google / Apple-compatible OIDC login.
  - Application session duration: long (e.g., 1 month — maximum allowed to be confirmed at setup) to minimize re-login inside the installed PWA.
  - Optional bypass policy only for `/manifest.webmanifest` and `/icons/*` (non-sensitive, lets iOS fetch icons during "Add to Home Screen" reliably).
  - Preview hostname/`workers.dev` and preview URLs also protected by Access (Cloudflare supports Access on workers.dev, version and preview URLs); production `workers.dev` route disabled once a custom domain is used.
- **Worker verification (defense in depth):** every `/api/*` request must carry `Cf-Access-Jwt-Assertion`; the Worker verifies signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached, `kid`-matched), `aud` = application AUD tag, `exp`, and `email` == configured owner email. Failure → 401 JSON. This protects against misconfigured Access policies or an accidental public route.
- **Authorization model:** single tenant. Every row still carries `owner_id` (constant) so a future second user is a migration, not a rewrite — but no multi-user features are built.

### Access compatibility with the iPhone PWA

| Concern | Behavior | Design response |
|---|---|---|
| Installed PWA vs Safari | Home Screen web apps have their **own cookie/storage jar**, separate from Safari. Logging in inside Safari does not log in the installed app. | First launch of the installed app triggers the Access login once inside the app. Documented in onboarding help. |
| Login redirect in standalone mode | Access redirects to `<team>.cloudflareaccess.com` (out of app scope). iOS opens out-of-scope navigation in an in-app browser sheet and returns to the app when redirected back to the in-scope origin. | **Must be validated on a real iPhone in Phase 0 (spike).** One-time PIN keeps the flow on Cloudflare pages (no third-party popups), which is the most likely to work. |
| Service worker | SW script and precache requests go through Access with the cookie. If the session has expired, SW update fetch gets a redirect and fails; the **app keeps running from cache**. | SW update failures are silent and retried; never blocks use. |
| API requests (fetch) | With an expired session, Access answers a `fetch` with a 302 to the login domain (cross-origin). | All API calls use `redirect:'manual'`; an `opaqueredirect`/401 is mapped to state **"צריך להתחבר מחדש"**. The outbox keeps every pending write; a banner button performs a top-level navigation to re-authenticate; sync resumes after. **No data loss.** |
| Same-origin API | API is on the same hostname as the app. | No CORS, cookies always sent, one Access app. |
| Background behavior | iOS PWAs get **no Background Sync / Periodic Background Sync**; the SW only runs for push/notification events and while the app is open. | Sync runs on app open, on `visibilitychange`→visible, on `online`, and on a foreground interval. Nothing relies on background execution. |
| Push notifications | Push messages travel Apple Push Service → device; they never pass through Access. Subscription registration is a normal authenticated API call. | Works independently of Access session state; tapping a notification opens the app URL, which goes through Access (re-login if expired). |
| Lost / stolen phone | Access session on device remains valid until expiry. | Runbook: revoke the user's sessions in Zero Trust dashboard; rotate nothing else needed (no client secrets exist). |

- **Security implications:** No passwords stored by Leafling; no client-held secrets; identity delegated to Cloudflare. Main risk is the PWA login flow (above) — mitigated by the spike and a contingency.
- **Cost:** Free.
- **Contingency (needs owner approval only if the spike fails):** keep Access for the dashboard/preview but authenticate the production app with a **WebAuthn passkey** bound to the device (no password), verified by the Worker, issuing an HttpOnly session cookie. This is "a custom auth system" and therefore *not* part of the recommended design.
- **Rejected alternative:** custom email/password or magic-link auth. **Why:** explicitly out of scope in `PRODUCT_SPEC.md` §6; more code, more attack surface, password storage.
- **Rejected alternative:** "secret URL" / static API token in the app. **Why:** a bearer secret in the frontend violates the no-secrets-in-client principle and leaks via history/screenshots.

---

## 7. Data model overview

Exact schema is finalized in Phase 1 migrations; this is the approved-shape proposal. All IDs are **UUIDv7** generated on the client (sortable, offline-safe). All tables include `created_at`, `updated_at`, `deleted_at` (soft delete), `owner_id`.

### Core entities

| Table | Purpose / key fields |
|---|---|
| `user_profile` | Onboarding answers & settings: region (city/area/country + rounded lat/lon for weather), experience level, grow interests, spaces, help preferences, notification prefs, quiet hours, appearance, timezone |
| `pets` | kind (dog/cat/bird/rabbit/rodent/reptile/other), optional name |
| `locations` | name (required), indoor/outdoor, window distance/direction, direct sun, AC; outdoor exposure/rain/wind |
| `light_readings` | location_id, measured_at, method (`manual_lux`, `camera_relative`, `questionnaire`), value/category, time-of-day bucket, season — builds a profile, never one fixed value |
| `species` | Catalog entry: scientific name, family, external IDs (GBIF/Wikidata/WFO), representative image, flags |
| `species_names` | species_id, name, language (`he`, `en`, `la`…), type (common/local/scientific/alias) — search index (FTS5) |
| `species_facts` | species_id, topic (care.water, care.light, safety.cat…), structured value JSON, **provenance** (source type, source ref/URL, retrieved_at, verification status, confidence) — see §15 |
| `plants` | Personal card: species_id, `species_ordinal` (#2, #3), nickname, status (`rooting`/`seedling`/`plant`/`sick` — exactly four), `kind` (`single` / `group`), group counts (sown, germinated, alive), current location_id, current pot (diameter, material, drainage), current substrate, acquired/sow/start dates with precision, main_photo_id, archived_at |
| `plant_lineage` | parent_plant_id, child_plant_id, relation (`cutting_of`, `split_from`, `division_of`), occurred_at — explicit only, never inferred |
| `plant_events` | Append-only event log (§8) |
| `photos` | original/display/thumb R2 keys, sha256, mime, bytes, width/height, captured_at + source (`exif`/`user`/`upload`/`unknown`), upload_state, is_in_timelapse |
| `photo_links` | photo_id ↔ (plant / journal event / health case / location / fertilizer / wishlist), role — one logical photo, many appearances |
| `tasks` | plant_id, kind (soil_check, fertilize_window, rooting_check, seedling_step, repot, treatment_step, health_followup, custom_reminder), window_start/window_end, important flag, origin (`rule`/`treatment`/`reminder`/`ai_confirmed`), treatment_id, reminder_id, state (open/done/postponed/skipped/superseded), completed_by_event_id |
| `suggestions` | kind (photo_progress, light_measurement…), plant/location, shown_at, dismissed_until — **no due dates, never overdue** |
| `custom_reminders` | plant_id, kind (rotate/support/inspect/custom), text, recurrence (once / every N days/weeks), next_at, active |
| `health_cases` | plant_id, title, state (active/monitoring/resolved), diagnosis source (`ai`/`professional`/`user`), likely cause, confidence, alternatives, evidence, missing info, urgency, contagious_suspected, previous_case_id (optional link), opened/resolved at |
| `treatments` | case_id, plan steps (generate `tasks`), started/ended, conflict notes |
| `fertilizers` | name, photo, NPK, manufacturer instructions (verbatim text), dose |
| `wishlist_items` | species_id, personal note, created_at, purchased_at, created_plant_id |
| `user_materials` | substrate materials owned (for Soil Mix Builder) |
| `ai_conversations`, `ai_messages` | User-visible chat history (user data, exportable, deletable) |
| `ai_proposals` | request_id, type, payload, rationale, confidence, state (proposed/accepted/rejected/expired), resulting_mutation_id |
| `ai_requests` | Operational metadata only (§11) |
| `push_subscriptions` | endpoint, keys, device label, last_success_at, failure_count |
| `notification_log` | task ids included, sent_at, result |
| `sync_mutations` | mutation_id (PK), received_at, result hash — idempotency |
| `change_log` | seq (autoincrement), table, row_id, op — drives delta pull |
| `backup_runs` | started/finished, object key, row counts, checksum, status |

### Rules encoded in the model
- **Naming (§18 spec):** `species_ordinal` is assigned at creation as (max ordinal ever used for that species) + 1; the first plant has ordinal 1 and is displayed **without** a number; later ones display `#2`, `#3`. Ordinals are never reused or shown as `#1`. Nickname overrides the display name only; identity (id, species, ordinal) never changes. Split children receive new ordinals the same way.
- **Statuses:** DB `CHECK` constraint allows only the 4 personal statuses. Wishlist is a separate table, never a status.
- **Pot/substrate:** all nullable.
- **Current state + history:** a change to pot/substrate/location/status writes an event (`from`→`to`) *and* updates the current column **in the same atomic batch** (e.g., pot 12→17→21 cm fully preserved in events).
- **Search:** SQLite FTS5 over species names (unicode61 tokenizer with diacritics removal handles Hebrew); personal name search runs client-side on the local store.

### Archive / Delete cascade & retention (open decision #12 — proposal)
- **Archive:** hides the plant from active lists, Today, tasks and notifications; keeps everything; fully reversible. Archived plants remain available to AI only when that plant is explicitly the subject.
- **Delete plant:** soft delete into "נמחקו לאחרונה" for **30 days** (restorable), then hard purge by cron: events, tasks, links, AI conversations about that plant, and photos not linked to any other entity are removed from D1 and R2.
- **Lineage preservation:** if a deleted plant has descendants, a minimal **tombstone** (species, display name, dates) and the events the descendants inherit (pre-split history) are retained so lineage and shared history of living plants stay intact.
- **Delete photo:** soft delete 30 days, then purge original + derivatives.
- **Delete location with plants:** allowed; plants get "ללא מיקום" and a `location_changed` event; light readings go to trash with the location.
- **Delete fertilizer:** events keep a name/NPK snapshot.
- Backups retain deleted data for the backup retention window (§16) — documented so "delete" semantics are honest.

---

## 8. Event-history architecture

### Recommendation: one append-only `plant_events` table with typed, versioned payloads
Fields: `id` (UUIDv7), `plant_id`, `type`, `occurred_at`, `occurred_precision` (`exact`/`day`/`month`/`unknown`), `payload` (JSON validated by a per-type Zod schema), `payload_version`, `source` (`user` / `system` / `ai_confirmed` / `import`), `ai_proposal_id`, `device_id`, `recorded_at` (server), `supersedes_event_id` (for corrections), `deleted_at`, and visibility flags `in_history`, `in_journal`.

Event types (extensible): `soil_check`, `watering`, `fertilizing`, `fertilizer_skipped`, `repot`, `substrate_changed`, `location_changed`, `status_changed`, `pot_changed`, `pruning`, `note`, `milestone` (first_sprout, new_leaf, first_flower, new_growth, first_root, repotted, recovered, other), `photo_added`, `sowing`, `germination_update`, `thinning`, `split`, `separated`, `propagation_started`, `cutting_taken` (on mother), `root_check`, `water_change`, `moved_to_substrate`, `propagation_completed`, `diagnosis`, `professional_diagnosis`, `treatment_started`, `treatment_step_done`, `treatment_ended`, `recovery_observation`, `reminder_done`, `task_postponed`, `measurement` (height etc.).

- **Reason:** Single Source of Truth (spec §46): one watering event feeds History, Journal (if meaningful), dry-down learning, AI context and export. Append-only events make sync conflict-free for the most common writes and give the long-term memory an honest, auditable basis.
- **Journal vs History:** same table, different views. Journal = `in_journal` (notes, photos, milestones, meaningful automatic events like "שורש ראשון"); History = `in_history` technical log with filters (הכול/השקיה/דישון/עציץ/מיקום/בריאות/התפתחות). No duplicate manual logging.
- **Corrections:** editing an event writes a new version with `supersedes_event_id`; deletion is soft. History shows the corrected value; audit remains.
- **Group history inheritance:** when a group (seed batch / cuttings) is **split**, each child card gets `split_from` lineage + a `separated` event. A child's history view = its own events ∪ parent events with `occurred_at ≤ split time`. No events are copied → no duplication, preserved dates (e.g., first sprout).
- **Thinning / partial success:** updates group counts via events; no card is created per seed and no "dead cards".
- **Propagation → plant:** same `plants` row continues (status `rooting` → `seedling`/`plant` by confirmed `status_changed`), preserving the whole record.
- **Limitations:** D1 has no interactive transactions; all multi-statement writes use `batch()` (atomic). Payload JSON is not relationally constrained → Zod validation at both ends + `payload_version` migrations in code.
- **Security:** events never deleted by AI; `source` makes AI-originated changes auditable.
- **Cost:** thousands of events per year ≈ a few MB — far below D1 limits.
- **Rejected alternative:** separate table per event type. **Why:** many joins for History/Journal/AI context, many migrations; loses the uniform timeline.
- **Rejected alternative:** full event sourcing (current state only derived by replay). **Why:** unnecessary complexity; current-state columns updated atomically are simpler and fast for lists.

---

## 9. Photo-storage and thumbnail design

### Recommendation: private R2 bucket; originals byte-identical; derivatives generated on the iPhone
Object keys: `photos/{photoId}/original` (original MIME preserved), `photos/{photoId}/display.jpg` (~1600 px long edge), `photos/{photoId}/thumb.jpg` (~400 px). Keys are write-once; the Worker refuses to overwrite `original`.

- **Reason:**
  - Spec §21/§24: originals immutable; technical thumbnails allowed. Client-side generation needs no paid image service and no server CPU.
  - Lists and grids load only thumbnails; plant header, compare and timelapse use `display`; fullscreen can open the original on demand. Satisfies "do not load all full-res images in lists" (§50).
  - Derivatives are re-encoded through canvas → **no EXIF/GPS** in anything except the stored original.
- **Integrity:** client computes SHA-256 of the original; Worker recomputes on upload and stores it; nightly job can spot-verify.
- **Capture date:** EXIF `DateTimeOriginal` read client-side (e.g., `exifr`), else user chooses today/date/unknown (spec §22). *iOS may omit some metadata depending on how the photo is picked — to be validated in Phase 0; fallback UX already required by spec.*
- **HEIC:** stored as received. Safari decodes HEIC for derivative generation. AI renditions are always JPEG (Claude accepts JPEG/PNG/GIF/WebP).
- **Upload path:** `PUT` through the Worker to the R2 binding (request body limit 100 MB on Free/Pro zones — ample for photos). Retries resume per object; server confirmation required before local blob eviction.
- **Timelapse / Compare:** use `display` derivatives of the originals, in capture-date order, **no crop/align/overlay**; framing identical to the original. Compare (side-by-side or slider) likewise. Originals remain available via "פתח מקור".
- **Placeholder species images** live in the species catalog (`species` image, with license/attribution), are visually marked, and never enter Journal/Timelapse.
- **Video (open decision #13):** **recommend not in v1.** iPhone video is large (hundreds of MB), exceeds comfortable upload-through-Worker limits, needs multipart upload and poster-frame generation, and Claude cannot analyze video. The `photos` table has a `media_type` column so video can be added later without redesign.
- **Security — private delivery:** no public bucket, no `r2.dev`, no custom-domain bucket exposure, no presigned URLs. All reads go `GET /api/photos/:id/:variant` → Worker (after Access + JWT) → R2 binding. Response headers: `Cache-Control: private, max-age=31536000, immutable`, `Content-Type` from stored metadata, `X-Content-Type-Options: nosniff`. The service worker caches thumbnails/display images in Cache Storage (bounded LRU).
- **Privacy note:** originals keep their embedded EXIF (including GPS if present) because originals are immutable. They are never public and never sent to Claude (AI receives stripped renditions).
- **Cost:** R2 Standard: 10 GB-month free, then US$0.015/GB-month; Class A 1 M/month free, Class B 10 M/month free; **zero egress**. 5,000 photos × ~3.5 MB ≈ 17.5 GB ≈ US$0.12/month.
- **Rejected alternative:** Cloudflare Images / Image Transformations. **Why:** extra service and potential cost for something the phone does for free; still would need originals in R2.
- **Rejected alternative:** Worker-side WASM resizing. **Why:** CPU/memory limits (128 MB isolate), complexity.
- **Rejected alternative:** presigned R2 URLs for direct upload/download. **Why:** bearer URLs can leak and bypass Access; not needed at this scale.

---

## 10. Offline, caching and synchronization design

### Recommendation: local-first with an outbox; server is the durable source of truth
**What is cached:**

| Data | Where | Policy |
|---|---|---|
| App shell (HTML/JS/CSS/fonts/icons) | SW precache (Workbox, content-hashed) | Updated on deploy; new version activates on next launch with a gentle "גרסה חדשה זמינה" |
| All structured personal data (plants, events, tasks, locations, species entries in use, settings) | IndexedDB | Full sync — even hundreds of plants/thousands of events is only a few MB |
| Thumbnails | Cache Storage | Prefetched for active plants; LRU cap (e.g., 150 MB) |
| Display images | Cache Storage | On demand, LRU cap (e.g., 300 MB) |
| Originals | Not cached, except pending uploads held in IndexedDB until confirmed |
| AI conversations | IndexedDB (read-only offline) | |
| Species catalog | Entries for owned/wishlist species + recent searches | |

`navigator.storage.persist()` is requested (WebKit grants it based on heuristics such as running as a Home Screen web app); persistent origins are protected from eviction. Settings shows storage usage and sync/backup state.

**Offline-capable actions:** Today task responses (soil check, watering, fertilizing, rooting checks), notes, journal photos (queued upload), milestones, status/location/pot/substrate changes, adding a plant (species chosen from local catalog or "unknown" placeholder), custom reminders, light readings (manual), viewing everything cached.
**Online-only:** AI features (Botanist, identification, Diagnose, Pest ID, "What is this?", label reading), external species lookup, weather, push subscription, export. UI states "צריך חיבור לאינטרנט" with retry — never fails silently.

**Queued writes (outbox):**
- Each mutation: `mutationId`, type, payload, created_at, attempt count, state.
- FIFO per entity; photos upload in a separate queue with dependency on their `photo.create` mutation.
- Retries with exponential backoff + jitter; resumes on `online`/`visibilitychange`/app start.
- Items are **never dropped automatically**. Permanently rejected mutations (validation error) move to a visible "לא נשמר — לבדיקה" list with the original content retained.

**Synchronization protocol:**
- `POST /api/sync/push` — batch of mutations → per-mutation result; idempotent via `sync_mutations`.
- `GET /api/sync/pull?since=<seq>` — rows changed since the client's last `change_log` seq, paginated.
- Initial load and "resync from server" button for recovery.

**Conflict handling** (one user, possibly two devices, e.g., iPhone + desktop browser):
- **Events:** append-only with unique IDs → union; no conflicts.
- **Entity fields:** per-field last-writer-wins using client `updated_at` plus server `rev`; mutations carry `baseRev`. If a field was concurrently changed, the losing value is written to history as an event (never silently lost) and a subtle notice appears.
- **Status / treatment end / task completion:** idempotent state transitions; completing an already completed task is a no-op.
- **Delete vs edit:** soft delete wins; edit is kept on the tombstone and restorable from trash.
- **Derived data (tasks, next check):** recomputed on the server after each push with the shared domain code; the client's optimistic value is replaced on pull.

**Weak or interrupted connections:** request timeouts (e.g., 15 s for sync, streamed AI with heartbeat), small sync batches, resumable per-object photo upload, AI requests are not auto-retried after partial output (to avoid double cost) but the user can retry with one tap; the question text is kept.

- **Limitations:** iOS has no Background Sync — queued data syncs the next time the app is opened. If the user deletes the Home Screen app, its local storage (including unsynced writes) is deleted by iOS; the UI therefore keeps pending counts visible and syncs aggressively when online.
- **Security:** local data is protected by device passcode/encryption; no secrets stored locally; Access cookie is HttpOnly.
- **Cost:** none beyond Worker requests (well within limits).
- **Rejected alternative:** online-only app with `fetch` + HTTP cache. **Why:** violates "personal data must not disappear because of a temporary network failure."
- **Rejected alternative:** CRDT/sync frameworks (Automerge, Replicache, PowerSync, ElectricSQL). **Why:** heavy dependencies or paid services for a single-user app whose conflicts are rare; append-only events + field LWW with history is sufficient and understandable.

---

## 11. AI service architecture

### Recommendation: Worker-side Claude proxy with feature-specific endpoints, structured outputs, budgets and metadata-only logging

**Endpoints** (all `POST /api/ai/*`, JSON in, streamed or JSON out):
`botanist`, `identify`, `diagnose` (incl. image-quality pre-check), `recovery-check`, `pest-id`, `what-is-this`, `label-read` (fertilizer label), `root-ball`, `location-fit`, `species-profile-draft` (catalog enrichment, §15), `tool-assist` (Watering/Sowing/Propagation/Repotting/Pot Size/Soil Mix explanations).

**Model routing (proposal):**
| Use | Model | Why |
|---|---|---|
| Botanist, Diagnose, identification, pest ID, "What is this?", recovery check | `claude-sonnet-5` (US$2 / US$10 per M input/output tokens) | Strong vision + reasoning at moderate cost |
| Image quality pre-check, label OCR/extraction, short classification | `claude-haiku-4-5` (US$1 / US$5 per M) | Cheap, fast |
| Escalation (optional, user-triggered "בדיקה מעמיקה") | `claude-opus-5` (US$5 / US$25 per M) | Only if owner approves |
Model IDs are configuration, not code, so they can be changed without redeploying logic.

**Request pipeline:**
1. Access + JWT verified.
2. Input validation (Zod): question length cap, image count cap (e.g., ≤ 4 Diagnose, ≤ 5 Botanist), referenced photo IDs must belong to the owner and (for plant-scoped features) to **that plant**.
3. Rate limit (Workers Rate Limiting binding: e.g., 20 AI requests / 10 min) + **budget check** (D1 counters: daily and monthly estimated spend; hard stop with calm Hebrew message when reached).
4. Context builder (§12) assembles minimal structured context.
5. Claude call: fixed system prompt (Hebrew output, uncertainty rules, safety rules, no-mutation rule) cached with prompt caching; `max_tokens` capped per feature; structured output schema per feature.
6. Output validation: response parsed against Zod; malformed → one repair attempt at most, else friendly error.
7. Post-processing guardrails: confidence clamped by server rules (§12), proposals validated against allowed types, high-risk proposals (e.g., discard plant, heavy root pruning, chemical treatment near pets) require `confidence ≥ likely` or are downgraded to "consider consulting".
8. Persist: conversation messages (user data), `ai_proposals`, `ai_requests` metadata.

**Structured AI response shape (all features):**
```
{
  answer_he,                       // main text
  observed: [...], interpretation: [...], missing_info: [...],   // "מה אני רואה / מה אני חושב / מה חסר"
  confidence: "known" | "likely" | "possible" | "insufficient",
  alternatives: [{label, scientific_name?, confidence, why}],
  retake_request?: {reason, what_to_photograph},
  urgency?: "green" | "yellow" | "orange" | "red",
  contagious_suspected?: boolean,
  proposals: [{type, payload, rationale, confidence}]   // never executed by the server
}
```
Proposal types: `create_task`, `create_reminder`, `change_status`, `change_location`, `start_treatment`, `end_treatment`, `add_note`, `record_event`, `update_plant_field`, `save_identified_species`, `add_plant_insight`.

**No silent mutations (spec §43):** the AI endpoints have **no write path** to user data except storing the conversation and the *proposal* rows. Accepting a proposal is a separate client action that submits a normal, validated mutation (`source:'ai_confirmed'`). There is no tool-use loop that can write.

**Secret handling:** `ANTHROPIC_API_KEY` is a Worker secret (encrypted, never in repo, never returned to clients, never logged). Separate Anthropic **workspaces/keys** for production and preview, each with its own console spend limit.

**Spending controls (layered):**
1. Anthropic Console workspace **monthly spend limit** (hard ceiling, enforced by Anthropic).
2. Leafling monthly and daily budgets in D1 (soft/hard thresholds; e.g., warn at 80 %, stop at 100 %).
3. Per-request caps: `max_tokens`, image count, image resolution (≤ ~1.15 MP rendition), context token budget.
4. Prompt caching of the stable system prompt + schemas.
5. Rate limiting.
6. Preview environment uses a mock Claude by default; real calls only with an explicit preview key with a tiny limit.

**AI request logging without unnecessary personal data:** `ai_requests` stores: id, timestamp, feature, model, plant_id (reference only), conversation_id, input/output/cache tokens, image count, estimated cost, latency, stop reason, status/error code, **names** of context sections included (e.g., `["profile","watering_stats","active_case"]`) and a hash of the assembled context. **No prompt text, no answer text, no images in operational logs.** Worker `console.log` never prints bodies (lint rule + logger wrapper). The user-visible conversation is stored as user data, deletable and exportable. Anthropic API data handling follows Anthropic's commercial terms (API data not used for training by default; retention per current policy — to be confirmed at key creation).

- **Rejected alternative:** Cloudflare AI Gateway in front of Anthropic. **Why:** adds a service and, if logging is enabled, stores prompts/images containing personal data; our own budget/rate-limit/metadata logging covers the need. It remains an optional later addition (with logging disabled) for caching/analytics.
- **Rejected alternative:** calling Claude from the browser. **Why:** would expose the API key; forbidden by spec §40.
- **Rejected alternative:** agentic tool-use with write tools. **Why:** conflicts with "AI never silently changes user data".

---

## 12. AI context-building and plant-memory design

### Recommendation: server-side, deterministic "plant memory digest" + intent-based sections under a token budget

**Principles enforced in code:**
- The client sends only IDs and the question. The Worker queries D1 **by `plant_id`** — the context builder API has no way to query other plants (`buildContext(plantId, intent)`), making "unrelated plants never included" structural, not a convention.
- Never the whole DB. Hard token budget per feature (e.g., 3,000 tokens of structured context, excluding images).
- A **context isolation test** asserts that serialized contexts contain no IDs, names or nicknames of other plants.

**Plant memory digest** (computed from events, cached per plant and invalidated on new events):
1. Identity: display name, species (scientific + Hebrew), status, age / days since start, kind (single/group + counts).
2. Current state: location summary + light profile category, pot (if known), substrate (if known), indoor/outdoor.
3. Watering behavior: last watering, last soil check result, personal dry-down statistics with sample size and confidence, season bucket.
4. Fertilizing: last date, fertilizer used (name/NPK), window state.
5. Health: active cases and treatments; resolved cases only as one-line summaries (last 12 months) unless the question concerns recurrence.
6. Development: stage (seedling/propagation), root state, milestones.
7. Recent notes (last N, truncated).
8. Confirmed plant insights (user-accepted AI observations).
9. Species knowledge facts **with provenance tags** (verified / unverified).

**Intent-based inclusion:** a rules-based classifier (keywords + entry point: Diagnose, Today task, tool) selects sections: e.g., watering question → 1–3 + species water facts; diagnosis → 1–5 + recent events 30 days; pet-safety question → species safety facts + pet kinds (not pet names). Household context (region, experience level) included only when relevant; experience level changes explanation depth only.

**Relevant-but-not-unrelated edge cases:**
- Contagion: the AI returns `contagious_suspected`; the **app** (not the AI) lists co-located plants from local data and suggests checking them. Neighbor data is never sent.
- Lineage question: only the explicit mother/descendant display names and species of *that* plant.
- General Botanist chat without a selected plant: no personal plant data at all; user may pick one plant ("My Plant") to attach.

**Long-term personalized memory — weighting & patterns:**
- Recommendation = blend of species prior (+ season, pot, substrate, location) and personal evidence: `weight_personal = n / (n + k)` where `n` = qualifying observed cycles and `k` a per-metric constant (e.g., 4).
- **Pattern claims require ≥ 3 consistent observations** (configurable per metric); fewer → wording "נראה ש…" at most, and a single event never produces a pattern.
- Dry-down cycles computed from `watering` → subsequent `soil_check: dry`, bucketed by season; outliers flagged not averaged blindly. Displayed when sufficient: last watering, typical range, number of cycles (spec §26).
- Weather can move a check earlier/later but never produces a watering conclusion (spec §26, §36).

**Confidence conventions (open decision #17 — proposal):**
- Four levels with fixed Hebrew labels: **ידוע / גבוה**, **סביר / בינוני**, **אפשרי / נמוך**, **אין מספיק מידע**. No percentages (false precision).
- Displayed as text + icon shape (not color alone — accessibility).
- AI self-reports a level; the server clamps it: no photo → max `likely` for visual diagnoses; retake requested → max `possible`; personal statistics with n < 3 → `insufficient`/`possible`; identification with close alternatives → cannot be `known`.

**AI image handling & cost:**
- Client uploads a JPEG AI-rendition (long edge ≤ 1568 px, ≤ ~1.15 MP, EXIF stripped). Image token cost ≈ width × height / 750 → ≈ 1,500 tokens per image ≈ US$0.003 per image on Sonnet 5.
- Existing journal photos are referenced by ID; the Worker reads their `display` rendition from R2 (no re-upload).
- Diagnose flow: cheap Haiku quality pre-check on the first image; retake requested only when materially needed.
- Max images per request configurable; conversation history trimmed to last N turns + short summary.

**Cost control summary:** stable cached system prompt, compact JSON context, intent-selected sections, capped images and outputs, Haiku for cheap steps, budgets (§11).

---

## 13. Security and secret management

**Secrets (Worker secrets per environment, set via Cloudflare dashboard/Wrangler — never in Git, never in frontend bundles):**
| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | AI proxy |
| `VAPID_PRIVATE_KEY` (public key is non-secret config) | Web Push |
| (optional) plant-identification provider key, if approved | Identify |
Non-secret config in `wrangler.jsonc`: Access team domain, AUD tag, owner email, model IDs, budgets.
Local development uses `.dev.vars` (gitignored) with preview/mock values. GitHub needs **no** Cloudflare token if Workers Builds deploys; if a GitHub Actions deploy is ever used, a least-privilege API token stored as a GitHub encrypted secret.

**Controls:**
- Access in front of everything + JWT verification in Worker.
- Strict CSP (`default-src 'self'`, `img-src 'self' blob: data:`, `connect-src 'self'`, no inline scripts), `frame-ancestors 'none'`, HSTS, `Referrer-Policy: no-referrer`, `Permissions-Policy` limiting to camera where needed.
- Zod validation on every API input; parameterized queries only (Drizzle/D1 binds).
- Photo endpoints check ownership + object existence; content-type and size limits on upload; SHA-256 verification.
- User text rendered as text (no HTML from AI; Markdown rendered with a sanitizing renderer with an allowlist).
- Prompt-injection posture: AI output cannot mutate data; photos/labels are data, not instructions; system prompt states it; proposals validated server-side.
- Secret scanning enabled on the GitHub repo; Dependabot/Renovate for dependency updates; lockfile committed.
- Logs contain no bodies, no photo bytes, no AI content; user-identifying data limited to plant IDs.
- Key rotation runbook (Anthropic key, VAPID keys → requires re-subscribe).

**Privacy:** single private system; no analytics, ads or tracking (spec §50); fonts and assets self-hosted; weather requests use coarse location (city-level coordinates rounded to ~0.1°); plant-data lookups send only species names; Claude receives only minimal plant-scoped context and EXIF-stripped images.

---

## 14. Notifications

### Current iPhone capability (validated against WebKit documentation)
- Web Push is supported **only for web apps added to the Home Screen**, iOS/iPadOS **16.4+**; not in Safari tabs.
- Permission must be requested from a user gesture inside the installed app.
- **No silent push**: every push must show a notification.
- **Declarative Web Push** (iOS/iPadOS 18.4+) delivers notifications described in the payload even without service-worker code executing — more reliable; the SW path remains as fallback for older iOS.
- Badging API (`navigator.setAppBadge`) is available to Home Screen apps.
- If the user removes the Home Screen app or revokes permission, the subscription stops working (server sees 404/410 and disables it).
- No background sync/periodic sync; push cannot be used to sync data silently.

### Recommendation
- **Only important tasks** trigger push (spec §37): soil check due, treatment steps, seedling and propagation care tasks, and custom reminders the user marked important. Never for photo suggestions, light-profile suggestions or engagement.
- **Scheduling:** a Worker **Cron Trigger** (e.g., every hour) computes, per the user's timezone and chosen notification time and quiet hours, which important tasks entered their window; sends **one digest notification per day** by default (e.g., "3 צמחים מחכים לבדיקת אדמה"), with separate pushes only for urgent treatment steps. Deduplicated via `notification_log`.
- **Payload** contains minimal text (no sensitive detail beyond plant display names, user can choose generic text) and a deep link (`/today` or `/plant/:id`).
- **Tap** opens the app at the right screen; badge shows count of open important tasks.
- **Fallback:** Today screen is always the source of truth; notifications are a convenience. Settings shows push status per device and a "send test notification" button.
- **Security:** VAPID private key as a Worker secret; subscription endpoints stored in D1; Apple's push service sees only encrypted payloads.
- **Cost:** free (Apple push service, Worker cron).
- **Rejected alternative:** third-party push providers (OneSignal/Firebase). **Why:** extra account, tracking SDKs, data sharing; not needed.
- **Rejected alternative:** email/SMS reminders. **Why:** out of product tone; adds services.

---

## 15. External plant and weather data

### Weather (open decision #11)
- **Recommendation:** **Open-Meteo** forecast API, called from the Worker, once or twice daily per user region (cached in D1), used only for background adjustments: move soil checks (heat/rain for outdoor), cold/heat warnings for outdoor/balcony plants, sowing timing.
- **Reason:** free, no API key (nothing to secret-manage), good global coverage including Israel, hourly temperature/precipitation/humidity/wind.
- **Limitations:** free tier is for **non-commercial** use with fair-use limits (fine for a personal app; must be re-evaluated if Leafling is ever commercialized). No SLA → weather is optional input; failure just means no adjustment.
- **Security/Privacy:** only rounded city coordinates are sent; no identifiers.
- **Cost:** free.
- **Rejected alternatives:** OpenWeatherMap (requires key, lower free quota), Apple WeatherKit REST (requires paid Apple Developer membership — contradicts no-Apple-dependency direction), Israel Meteorological Service open data (Israel-only, less convenient API — could be a later enhancement).

### General plant database (open decision #10)
There is no free, reliable, openly licensed **care** database with Hebrew names. Taxonomy and names are available openly; care and pet-toxicity knowledge are not reliably available as open structured data.

**Recommendation: build Leafling's own species catalog in D1 with per-fact provenance, enriched lazily:**
1. **Names & taxonomy:** GBIF Backbone / World Flora Online (accepted names, synonyms) and **Wikidata** (CC0; Hebrew labels/aliases, taxon IDs). Queried from the Worker when a species is searched and not yet in the catalog; results stored with source IDs.
2. **Care profile:** drafted by Claude (`species-profile-draft`) as structured facts (light, water/soil-check guidance, substrate, temperature, humidity, fertilizing windows and when not to fertilize, propagation methods, common problems), **every fact stored with `verification: 'ai_unverified'`** and shown with a subtle "מידע כללי — לא אומת" marker until verified.
3. **Pet safety:** facts must cite a reputable source URL (e.g., ASPCA toxic/non-toxic plant pages, veterinary/poison-control references) to be shown as verified; otherwise the UI says safety is **unknown/not verified** and never asserts safety. No airborne-toxicity claims without a cited basis (spec §16).
4. **Verification:** the owner can mark facts verified (with source), and a curated seed set for owned/wishlist species can be reviewed in Phase 6. Manufacturer fertilizer instructions are always authoritative (stored verbatim).
5. **Identification from photos:** Claude vision with alternatives and explicit confidence (spec §15). **Optional** addition (owner decision): Pl@ntNet API (free quota for non-commercial use, requires key) as a second opinion for species ID candidates.

- **Provenance fields per fact:** `source_type` (`curated`, `open_db`, `ai_unverified`, `user_verified`, `manufacturer`, `professional`), `source_ref` (URL/ID), `license`, `retrieved_at`, `verified_at`, `confidence`.
- **Security/Privacy:** only species names/IDs leave the system.
- **Cost:** open sources free; Claude drafts ≈ a few cents per new species, one-time.
- **Rejected alternatives:** Perenual / Trefle as primary source. **Why:** restrictive licenses/quotas, uneven data quality, service stability concerns (Trefle), and no Hebrew; would still need provenance handling. iNaturalist API: good names (incl. Hebrew) but usage terms are restrictive for app backends — acceptable only for manual reference.

---

## 16. Backup, restore and disaster recovery

### Recommendation (open decision #7): three layers
| Layer | What | Frequency / retention | Protects against |
|---|---|---|---|
| 1. D1 **Time Travel** | Point-in-time restore of the database | Continuous; **30 days on Workers Paid** (7 days on Free) | Bad migration, bug, accidental mass change |
| 2. **Nightly logical backup** | Cron Worker exports every table to gzipped NDJSON + manifest (schema version, row counts, SHA-256) into R2 bucket `leafling-backups` | Daily kept 30 days, weekly kept 12 weeks, monthly kept 12 months (a few MB each) | Longer-horizon recovery, schema-independent copy, restore into new DB |
| 3. **Off-Cloudflare export** | "ייצוא גיבוי מלא" in Settings: downloads the latest logical backup (JSON) + photo originals in yearly ZIP parts to the iPhone Files app / iCloud Drive | On demand; gentle, non-nagging "last export" date shown in Settings (no push) | Cloudflare account loss/lockout |

**Photos:** originals are write-once; app deletes are soft (30 days) before purge. Recommended: nightly job copies new originals to a **second bucket** (`leafling-photos-backup`) — protects against accidental bucket-level deletion/bugs; costs only storage beyond the free 10 GB. R2 bucket-lock/retention rules to be enabled on the backup bucket if available on the account at setup (verify).

**Export format:** open, documented JSON (NDJSON per table + manifest) and original image files named `{photoId}.{ext}` with a `photos.json` index — readable without Leafling. This is a backup-grade export. The user-facing "year summary"/nice export remains a future nice-to-have (spec open decision #18) and is **not** built.

**Restore procedures (runbooks in `docs/runbooks/`):**
- *Undo recent damage:* `wrangler d1 time-travel restore <db> --timestamp=…` (run from Cloudflare dashboard/CI; no personal computer required — a manual GitHub Actions `workflow_dispatch` job can run Wrangler).
- *Full logical restore:* create a new D1 database, apply migrations to the backup's schema version, import NDJSON, verify counts/checksums, switch the Worker binding, deploy.
- *Photo restore:* copy objects from the backup bucket.
- *Client recovery:* "סנכרון מחדש מהשרת" rebuilds IndexedDB.

**Restore verification:** a monthly cron job restores the latest logical backup into a scratch D1 database and verifies row counts and checksums, then clears it; result shown in Settings ("מצב גיבוי"). Failures shown in-app (and optionally a push — owner decision, since spec limits push to plant tasks).

**Disaster scenarios:** bad deploy → roll back Worker version (instant) + Time Travel if data affected; migration bug → migrations are forward-only, expand/contract, backup taken immediately before each production migration; lost phone → data is in cloud, revoke Access sessions; Cloudflare account loss → off-Cloudflare export.

- **Targets (proposal):** RPO ≤ minutes for synced data (Time Travel), ≤ 24 h worst case via logical backups; RTO ≤ 1 hour.
- **Cost:** backups are MBs; photo mirror doubles photo storage (≈ US$0.15–0.30/month at 10–20 GB beyond free tier).
- **Rejected alternative:** storing backups in GitHub (artifacts/repo). **Why:** personal data in source control/CI storage; retention and access control are wrong for that purpose.

---

## 17. GitHub and Cloudflare deployment workflow

### Recommendation: Cloudflare **Workers Builds** connected to the private GitHub repo; GitHub Actions for checks
1. Pull request / branch push → **GitHub Actions**: typecheck, lint (incl. RTL/logical-CSS and no-body-logging rules), unit tests, Worker integration tests (Miniflare/`workerd` with local D1/R2), migration test, build, Playwright WebKit smoke. No secrets required.
2. Non-production branches → Workers Builds **preview** deployment of the `leafling-preview` Worker with **preview-only bindings** (separate D1, R2, secrets, mock AI by default), protected by Access. Preview URL posted to the PR.
3. Merge to `main` → Workers Builds production deploy command: backup trigger → `wrangler d1 migrations apply leafling-prod --remote` → `wrangler deploy`.
4. Rollback: Workers versions/deployments allow instant rollback of code; data rollback via Time Travel.
5. Branch protection on `main` (required checks).

- **Reason:** No personal computer involved in deployment; no Cloudflare API token stored in GitHub; native preview URLs.
- **Limitations:** Workers Builds has build-minute quotas (to be confirmed at setup; single-developer usage is small). Migrations run before the new code is live → every migration must be backward compatible with the currently deployed code (expand/contract).
- **Security:** deployment credentials stay inside Cloudflare; GitHub repo private with secret scanning.
- **Cost:** free for this volume (GitHub private repo + Actions free minutes; Workers Builds included).
- **Rejected alternative:** GitHub Actions deploy with `wrangler deploy` and a Cloudflare API token. **Why:** requires storing a powerful token in GitHub; kept only as fallback.
- **Rejected alternative:** Cloudflare Pages Git integration. **Why:** see §18/§2 — Pages lacks Cron Triggers and other Worker features; Cloudflare's current feature investment is in Workers.

### Cloudflare Pages vs Workers (explicit evaluation)
- **Recommendation:** Workers with Static Assets.
- **Reason:** one deployable for SPA + API + **Cron Triggers** (needed for notifications and backups) + Rate Limiting binding + gradual deployments + better observability + Vite plugin. Cloudflare's own comparison lists Cron Triggers, Rate Limiting, Gradual Deployments, Vite plugin support and richer observability as Workers-only.
- **Limitations:** Workers Static Assets: 20,000 files per version on Free (100,000 Paid), 25 MiB per file — far above our needs.
- **Rejected:** Pages (+Functions). **Why:** would require a second Worker for cron jobs anyway; features Pages uniquely offers (branch aliases, file-based routing, custom domains outside Cloudflare zones) are not needed.

---

## 18. Development, preview and production environments

| Environment | Where | Data | AI | Auth |
|---|---|---|---|---|
| Local dev | Vite + `@cloudflare/vite-plugin` running the Worker in `workerd` with local D1/R2 (Miniflare). Runs in any dev environment, including cloud dev sessions — no dependency on a specific personal machine. | Synthetic seed data (e.g., 300 plants, 20k events) | Mock by default; optional preview key | Access bypassed locally; JWT check uses a dev test key |
| Preview | `leafling-preview` Worker (Workers Builds preview), D1 `leafling-preview`, R2 `leafling-preview-photos` | Synthetic only — **never production data** | Mock by default; preview Anthropic workspace with tiny spend limit when enabled | Access (same owner policy) |
| Production | `leafling` Worker on custom domain (recommended) | Real data | Production Anthropic workspace with spend limit | Access + JWT |

- Production and preview **never share bindings**. Note: *version preview URLs of the production Worker* would use production bindings — they are therefore not used for testing schema changes; all branch previews go to the separate preview Worker.
- **Custom domain (owner decision):** the PWA's identity, storage and push subscription are tied to its origin; changing the origin later means reinstalling and resyncing. A stable custom (sub)domain is recommended from the first real use; `*.workers.dev` is acceptable for Phase 0–1 testing only.
- Workers plan: Free is sufficient for local/preview experiments; **Workers Paid (US$5/month) recommended for production** (see §21).

---

## 19. Testing strategy

| Layer | Tooling | Focus |
|---|---|---|
| Domain unit tests | Vitest | Naming (#2/#3, never #1, no reuse), soil-check state machine (dry→asked watered; only "yes" creates watering), dry-down learning & weighting, pattern threshold (≥3), confidence clamping, fertilizer windows, seedling/propagation groups (split/thin/partial success, history inheritance), lineage, cascade/retention, treatment conflicts, "suggestions never overdue", status never auto-changed |
| Schema/contract | Vitest + Zod | Event payload versions, mutation schemas, AI output schemas |
| Worker integration | `@cloudflare/vitest-pool-workers` (real `workerd`, D1, R2 in-process) | Sync idempotency (duplicate mutation), atomic batches, conflict rules, JWT rejection cases, photo upload hash mismatch, overwrite refusal, budget/rate-limit stops |
| Migrations | Vitest | Apply all migrations to empty DB; upgrade from each previous release snapshot; backup→restore round trip equality |
| AI | Mocked Anthropic client | **Context isolation test** (no other plant data), minimal-context size budget, proposals never auto-applied, malformed output handling, confidence clamps. A small manual evaluation set (real photos/questions) run on demand, not in CI (costs money) |
| Offline/sync | Vitest + fake-indexeddb; Playwright with network toggling | Writes while offline survive reload; outbox drains; re-auth flow keeps queue |
| E2E | Playwright **WebKit**, iPhone viewport, `he-IL` locale | Critical flows per phase, RTL layout snapshots, 5 tabs exactly, floating + has exactly 2 actions |
| Accessibility | axe-core in Playwright | Contrast, labels, tap target sizes, non-color-only meaning |
| Performance | Seeded large dataset | Lists virtualized, Today renders < 1 s from local store |
| Real device checklist | Manual on owner's iPhone per phase | Install, Access login/re-login, push, camera/gallery/EXIF, offline, safe areas, Dark Mode |

---

## 20. Monitoring and error handling

- **Workers Observability (Workers Logs)** enabled with structured JSON logs (request id, route, status, latency, error code) — no bodies/personal content. Sampling if volume ever grows.
- **Client errors:** captured by a small handler and sent (sanitized: message, stack, route, app version) to `/api/client-errors`, stored in D1 with 30-day retention. **No third-party error tracker** (privacy).
- **Health panel in Settings:** last sync, pending outbox items, pending photo uploads, last backup + verification result, push status, AI budget used this month, storage used on device.
- **Cron job results** recorded in D1; failures surface as an in-app banner.
- **Error UX:** every network/AI action has loading, failure and retry states in calm Hebrew copy; no silent failures; no guilt wording.
- **Cloudflare account notifications** (email) for Worker error spikes can be enabled at no cost.
- Rejected: Sentry/Datadog. **Why:** extra cost, third-party access to personal context.

---

## 21. Cost estimate and service limits

### Service limits relevant to Leafling (checked 2026-09-27)
| Service | Free | Paid (Workers Paid, US$5/mo) | Leafling expected use |
|---|---|---|---|
| Workers requests | 100,000/day | 10 M/month included | < 2,000/day |
| Workers CPU per invocation | **10 ms** | 30 s default, up to 5 min | Backup/export/restore-verify and push encryption may exceed 10 ms |
| Subrequests per invocation | 50 | 10,000 | Backup job, photo mirror |
| Cron Triggers | 5 per account | 250 | 3–4 |
| D1 database size | 500 MB | 10 GB | < 100 MB for years |
| D1 rows read / written | 5 M/day / 100 k/day | 25 B / 50 M per month | Tiny |
| D1 queries per invocation | 50 | 1,000 | Sync batches, backup need more than 50 |
| D1 Time Travel | 7 days | **30 days** | Recovery window |
| D1 bound params / statement size | 100 / 100 KB | same | Batch sizing |
| R2 storage | 10 GB-month free | then US$0.015/GB-month | 5–20 GB over years |
| R2 operations | 1 M Class A, 10 M Class B / month free | then US$4.50 / US$0.36 per M | Tiny |
| R2 egress | Free | Free | — |
| Access (Zero Trust Free) | Up to 50 users | — | 1 user |
| Request body | 100 MB (Free/Pro zone) | — | Photos only |
| Isolate memory | 128 MB | 128 MB | Streaming export |

### Recommendation: Workers Paid for production
- **Reason:** the 10 ms CPU and 50-queries-per-invocation limits of the Free plan make nightly backups, restore verification, sync of large batches and full exports fragile; 30-day Time Travel is a meaningful safety improvement for personal data.
- **Rejected:** staying on Free in production. **Why:** saves US$5/month but weakens backup/restore reliability, which the spec treats as a critical invariant.

### Monthly cost estimate
| Item | Estimate |
|---|---|
| Workers Paid (includes D1/Workers quotas) | US$5.00 |
| R2 photos + backups + photo mirror | US$0.00–0.50 |
| Cloudflare Access | US$0 |
| Open-Meteo, GBIF/WFO/Wikidata | US$0 |
| GitHub private repo + Actions | US$0 |
| Custom domain (optional) | ≈ US$10–15 per **year** at registrar cost |
| **Claude API** (variable) | see below |

**Claude API estimate (Sonnet 5 at US$2/M input, US$10/M output; Haiku 4.5 at US$1/US$5):**
- Typical Botanist question with context (≈ 4k input incl. cached prompt, ≈ 700 output): ≈ US$0.015.
- Diagnose with 3 images (≈ 4.5k image tokens + 4k context, ≈ 1.2k output) + Haiku pre-check: ≈ US$0.03–0.04.
- Moderate use (≈ 10 AI requests/day, a third with images): **≈ US$5–10/month**. Light use: ≈ US$1–3.
- Recommended default hard cap: **US$10/month** (owner decision), enforced by both the Anthropic console limit and Leafling's budget counter.

**Expected total: ≈ US$6–16/month**, dominated by optional AI usage.

---

## 22. Phased implementation roadmap

Dependency-aware; each phase ends with a **complete, tested vertical slice** on the owner's iPhone. No screen is built before the persistence and shared domain behavior it depends on.

**Phase 0 — Platform validation spikes (throwaway, preview account resources only)**
Depends on: architecture approval.
- Access login + session expiry + re-login inside the **installed** iPhone PWA (One-time PIN and the chosen IdP).
- Web Push from a Worker to the installed PWA (standard + Declarative Web Push).
- Photo picker: camera vs gallery, HEIC/JPEG, EXIF date availability, derivative generation speed.
- IndexedDB persistence (`storage.persist()`), quota behavior.
- Light-meter feasibility check (camera relative-brightness experiment).
Exit: written findings appended to ARCHITECTURE.md; contingency decisions escalated if any spike fails.

**Phase 1 — Foundation**
Repo scaffold; Worker + static assets; Access + JWT verification; D1 with first migrations (profile, species, plants, events, photos, locations, tasks, sync tables, change log); R2 buckets; CI; preview + production environments; app shell with RTL design tokens, light/warm-dark themes, exact 5-tab bottom navigation and floating + (with its two entries wired to "coming soon" only inside the + sheet — no placeholder tabs with fake data); PWA manifest + icons from the approved asset; **nightly backup job + Time Travel confirmed before any real data is entered**.

**Phase 2 — Core domain, sync and first vertical slice: "My Plants"**
Local store + outbox + sync engine + conflict rules; species catalog minimal (manual/local entries); naming rule; locations (name only + optional details); add-plant flow (photo/skip, status, nickname, location, status-specific questions, "+ פרטים נוספים"); My Plants tabs/search/filter/sort; plant card header (gallery, name, species, location, status, "אצלי מאז"), edit/archive/delete with trash; History tab from events; photo pipeline (originals, derivatives, private delivery, gallery, fullscreen, set main, delete). Onboarding (6 questions, skippable) + Settings basics. Export of logical backup.

**Phase 3 — Today, soil-check watering and care plan**
Tasks model and generation from shared domain; soil-check flow (dry/slightly moist/very moist/not checked; watered yes/no; "משהו לא בסדר" route prepared for Diagnose); dry-down learning v1 with confidence; Care Plan section; postpone/complete; "לא דורשים טיפול היום — N צמחים"; custom reminders; empty states. Journal tab (notes, photos, milestones), suggestions (photo progress), Compare and Timelapse.

**Phase 4 — Notifications**
Push subscription in Settings/onboarding (opt-in), cron digest for important tasks, quiet hours, badge, notification-click routing, device status + test notification.

**Phase 5 — AI foundation + AI Botanist**
Claude proxy, secrets, budgets, rate limits, metadata logging, context builder + isolation tests, structured outputs, uncertainty rendering, proposal/confirm cards; AI Botanist from plant card (plant-scoped) and from floating + (general or pick-a-plant), multiple images.

**Phase 6 — Find Plant, identification, species pages, Wishlist**
Species search (Hebrew/common/scientific/aliases via FTS5 + external name lookup); photo identification with alternatives; General Plant Page with tabs (טיפול | ריבוי | בטיחות 🐾 | בעיות) backed by provenance-tagged facts; pet-safety rules; "+ הוספה לצמחים שלי" reusing the add flow; Wishlist tab and "🌱 קניתי את הצמח!" conversion; weather integration in background (region → Open-Meteo) adjusting checks.

**Phase 7 — Diagnose and Health**
Guided photos, quality pre-check, symptoms and follow-ups, results with confidence/alternatives/evidence/missing info/urgency, contagious suspicion → neighbor check list (app-side), health cases, treatments producing dated tasks mirrored to Today, recovery checks, conflict warnings, professional diagnosis entry, past cases.

**Phase 8 — Seedlings, propagation and Plant Family**
Seed batches (counts, germination tracking, stages, thinning, separation creating cards with inherited history, transplant checklist, summary & comparison to past grows); propagation records (methods, root checks, water changes, move to substrate, completion to seedling/plant, group outcomes); lineage and "🌳 משפחת הצמח".

**Phase 9 — Fertilizing, Locations & light**
Fertilizer windows, My Fertilizers (label photo + AI label read, manufacturer authoritative), Fertilizer Calculator; location pages with light history/profile, "האם צמח יתאים לכאן?", Light Meter (per Phase 0 findings), seasonal remeasurement suggestions.

**Phase 10 — Remaining tools**
Watering Assistant, Pot Size Assistant, Sowing Assistant, Propagation Assistant, Repotting Guide (with optional root-ball AI), Pest Identification ("מצאתי אותו…" → Diagnose), "מה זה הדבר הזה?", Soil Mix Builder (with owned materials).

**Phase 11 — Hardening**
Large-dataset performance, DR drill (full restore into scratch environment), accessibility pass, security review, copy/tone review, final real-device regression.

---

## 23. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Access login does not complete cleanly inside the installed iPhone PWA | Medium / High | Phase 0 spike; One-time PIN; long session; outbox preserves data during re-auth; passkey contingency (owner approval) |
| iOS push unreliable or permission lost | Medium / Medium | Today screen is authoritative; Declarative Web Push; device status + test button; subscription health tracking |
| iOS evicts local storage / user deletes Home Screen app with unsynced data | Low / High | `storage.persist()`; aggressive sync when online; visible pending counts; server is source of truth |
| No background sync on iOS | Certain / Low | Sync on open/foreground/online; design never depends on background execution |
| AI hallucinated care or toxicity information | Medium / High | Provenance tags; unverified marker; pet safety requires cited source; explicit uncertainty; no auto-mutation |
| Claude cost overrun | Low / Medium | Console hard limit + app budget + rate limits + token/image caps |
| Buggy migration corrupts data | Low / High | Forward-only expand/contract migrations, tested upgrades, backup before migrate, Time Travel |
| Preview accidentally touching production data | Low / High | Separate Worker and bindings; no version-preview URLs of prod for schema changes |
| D1 lacks interactive transactions | Certain / Low | Atomic `batch()`; idempotent mutations |
| Cloudflare account lockout/loss | Very low / High | Off-Cloudflare export; documented export format |
| Plant data licensing issues | Medium / Low | Prefer CC0/CC-BY sources; store license per fact/image |
| iPhone photo metadata missing | Medium / Low | Spec-mandated fallback (today/date/unknown) |
| Light meter cannot produce real lux in web | High / Low | Never fake lux; manual/qualitative approach (§24) |
| Scope creep | Medium / Medium | Spec invariants as tests; phases gated by owner approval |

---

## 24. Decisions that still require owner approval

Each item lists the recommendation; approving ARCHITECTURE.md approves these unless the owner says otherwise.

1. **Frontend stack** (open decision #1): React + Vite + TypeScript SPA, Tailwind (logical utilities), Radix primitives, Dexie, Workbox.
2. **Code architecture** (#2): single Worker (static assets + Hono API + cron), shared pure domain module, local-first client with outbox.
3. **Cloudflare services** (#3): Workers (not Pages), D1, R2, Access; **Workers Paid US$5/month for production**.
4. **Authentication** (#4): Cloudflare Access with owner-email-only policy; identity method **One-time PIN (recommended)** vs Google login; long session; passkey fallback only if the Phase 0 spike fails (would need separate approval).
5. **Data schema** (#5): event-log + current-state model in §7–8, including naming ordinals (first plant has no number, #2/#3 never reused).
6. **Offline/sync** (#6): full structured-data sync to device, outbox, field-level LWW with history of overwritten values.
7. **Backup** (#7): Time Travel 30 days + nightly logical backup (30 daily / 12 weekly / 12 monthly) + photo mirror bucket + on-demand off-Cloudflare export; monthly automated restore verification; whether backup failures may use push (recommend: in-app only).
8. **Notifications** (#8): Web Push for Home Screen app only; daily digest by default, separate push only for urgent treatment steps; user-chosen time and quiet hours.
9. **Light Meter** (#9): no numeric lux from the camera; offer (a) guided questionnaire → light category, (b) manual lux entry from any external meter, (c) optional camera *relative* brightness indicator clearly labeled as approximate — final approach after Phase 0 test.
10. **Plant data & provenance** (#10): own D1 catalog; names/taxonomy from GBIF/WFO/Wikidata; AI-drafted care facts marked unverified; pet safety only "verified" with cited source; optional Pl@ntNet second-opinion identification (requires a key) — approve or decline.
11. **Weather** (#11): Open-Meteo (free, non-commercial terms).
12. **Archive/Delete** (#12): archive reversible; delete → 30-day trash → purge; lineage tombstones retained.
13. **Journal video** (#13): not in v1.
14. **Manual drag sorting** (#14): not in v1 (sorting by location/name/date only).
15. **Claude strategy** (#15): Sonnet 5 primary, Haiku 4.5 for cheap steps, optional Opus escalation; image caps; **monthly AI budget cap (recommend US$10)**.
16. **Image storage** (#16): original + display (~1600 px) + thumb (~400 px) generated on device; Timelapse/Compare use display derivatives of originals without crop/alignment.
17. **Confidence conventions** (#17): four Hebrew text levels, no percentages, server-side clamping rules.
18. **Export/year summary** (#18) and **statistics screen** (#19): remain out of scope; only the backup-grade export above is built.
19. **Custom domain:** use a stable custom (sub)domain for production (existing domain or ~US$10–15/year) vs `workers.dev`.
20. **App icon derivation:** the supplied icon includes its own rounded tile, drop shadow and outer background. iOS applies its own rounded mask, so using the full image would show a "tile within a tile". Recommend derivatives that **crop to the inner cream tile** (no redesign, no redrawing), scaled with padding so the plant and "Leafling" wordmark are not clipped. Requires owner approval since it changes framing.

### PWA / iPhone icon requirements (for implementation)
Original preserved unchanged as `assets/brand/leafling-icon-original.jpg` (supplied 1254×1254 JPEG). Derivatives (PNG, **opaque** cream background — iOS renders transparency as black):
| File | Size | Use |
|---|---|---|
| `apple-touch-icon.png` | 180×180 | iPhone Home Screen (`<link rel="apple-touch-icon">`) |
| `icon-167.png`, `icon-152.png` | 167×167, 152×152 | iPad Home Screen (optional) |
| `icon-192.png` | 192×192 | Web manifest `purpose: "any"` |
| `icon-512.png` | 512×512 | Web manifest `purpose: "any"`, splash generation |
| `icon-maskable-512.png` | 512×512 | Manifest `purpose: "maskable"`, key content inside central 80 % safe zone |
| `favicon-32.png` / `favicon.svg` optional | 32×32 | Browser tab |
| `apple-touch-startup-image` set (optional) | per current iPhone screen sizes | Launch screen on cream background (`#FBF7EE`-like token) |
Checks: preview at 60×60 pt (180 px) and 40 pt Spotlight size; the wordmark must remain legible at 180 px and nothing may touch the mask corners. Manifest: `name: "Leafling"`, `short_name: "Leafling"`, `display: "standalone"`, `lang: "he"`, `dir: "rtl"`, `start_url: "/today"`, `scope: "/"`, `theme_color` / `background_color` from the cream/green tokens.

---
*End of architecture proposal. Implementation must not begin until the owner explicitly approves this document.*
