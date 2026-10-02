# Leafling — Technical Architecture

Status: **APPROVED by the owner on 2026-09-27 (revision 3.1).** Implementation proceeds phase by phase per §22; Phase 0 (platform validation) is the only phase currently authorized.
Product source of truth: `PRODUCT_SPEC.md`. If this document contradicts it, `PRODUCT_SPEC.md` wins and this document must be corrected.
Platform research date: 2026-09-27. Limits and prices were checked against official Cloudflare, WebKit and Anthropic documentation on that date and must be re-checked when resources are created.

Legend used for key choices:
**Recommendation / Reason / Limitations / Security / Cost / Rejected alternative / Why rejected.**

Revision 2 changes (owner feedback): Cloudflare **Free plan** for version 1 with documented, test-based upgrade triggers; **workers.dev** address initially; explicit source-of-truth model (D1 durable, IndexedDB offline copy + pending queue); practical low-cost backups split into essential vs optional; Pl@ntNet moved to future; owner-approved decisions recorded (email one-time code, display-size copies for Timelapse/Compare, no Journal video in v1, icon crop for derivatives); `PRODUCT_SPEC.md` committed to the repository.

Revision 3 changes (owner final corrections, approval): sync conflicts are ordered by **server-assigned revision / server receipt order**, never by device clocks (client timestamps are metadata only), and every overwritten value stays preserved and restorable; version 1 essential backup now includes an **on-demand export of original photos** in manageable yearly/batched downloads; AI models limited to **Sonnet 5 and Haiku 4.5** with a **US$10/month** cap — Opus is not enabled in version 1; all §24 decisions approved.

Revision 3.1 (owner security correction, 2026-09-27): the **VAPID private key is never stored in D1** or any database — in every environment, including Phase 0 — only as the encrypted Worker secret `VAPID_PRIVATE_KEY`; the photo ZIP export (E3b) is an **unproven mechanism subject to a Phase 0 feasibility test** with an explicit stop rule.

---

## 1. Executive summary

Leafling is a single-user, Hebrew-first, RTL, iPhone-first PWA for managing personal plants. The architecture is deliberately small and starts at **US$0/month for infrastructure**:

- **One Cloudflare Worker** (with Workers Static Assets) on the **Workers Free plan** serves the built PWA, the JSON API, private photo delivery, the Claude proxy, and one consolidated scheduled job. One deployable, one origin, no CORS.
- **Initial address: `leafling.<account-subdomain>.workers.dev`.** A custom domain can be added later (§18 describes the move).
- **Cloudflare Access** (Zero Trust Free) protects the whole origin; the one authorized person signs in with an **email one-time code** (approved). The Worker also verifies the Access JWT.
- **Source of truth:** **Cloudflare D1 is the durable, synchronized source of truth.** **IndexedDB on the iPhone is the offline local copy and the pending-change queue.** Unsynced changes survive closing the app and authentication expiry; conflicts are ordered by server revision / receipt order (never device clocks) and overwritten values are always kept and restorable (§10).
- **Cloudflare R2** (private) stores byte-identical original photos plus display-size and thumbnail copies generated on the iPhone.
- **Claude API** is called only from the Worker, which builds a minimal, single-plant context from D1. AI can only *propose* changes; every mutation needs explicit confirmation.
- **Web Push** (Home Screen web apps, iOS 16.4+; Declarative Web Push iOS 18.4+) for important tasks only.
- **Backups (essential, free):** D1 Time Travel (7 days on Free), a Time Travel bookmark before every production migration, an on-demand full structured-data export **and an on-demand export of all original photos** (yearly/batched downloads) to the iPhone Files app / iCloud Drive, with tested import paths for both — together a complete independent backup. Scheduled duplicate copies and automated restore tests are **optional** later additions (§16).
- **GitHub (private) → Cloudflare Workers Builds** for automatic deployments; GitHub Actions for tests.

Workers Paid (US$5/month) is **not** required for version 1. It is adopted only if one of the measurable triggers in §21 is reached.

Nothing depends on a Mac, Xcode, the App Store, a private server, or a personal computer staying on.

---

## 2. Proposed technology stack

| Layer | Recommendation | Main rejected alternative |
|---|---|---|
| Language | TypeScript everywhere (client, Worker, shared domain) | Separate languages per tier |
| Frontend | React 19 + Vite, client-rendered SPA | SvelteKit / Next.js / Remix |
| Routing | React Router (SPA mode) | File-based SSR routers |
| Styling | Tailwind CSS v4 using **logical** utilities only (`ms-`, `pe-`, `start-`, `end-`), design tokens as CSS variables | CSS-in-JS |
| UI primitives | Radix UI primitives (dialog, sheet, tabs, popover) with `DirectionProvider dir="rtl"`; own components on top | Full component kit (MUI/Chakra) |
| Local storage | IndexedDB via **Dexie** (+ `liveQuery`) | localStorage, raw IndexedDB, PouchDB |
| Service worker | Workbox via `vite-plugin-pwa` in `injectManifest` mode (custom SW for push + caching) | Hand-written SW with no tooling |
| Validation / shared types | **Zod** schemas in `shared/`, used by client and Worker | Duplicated types |
| Server | **Cloudflare Worker** (Free plan) + **Hono** router, Workers Static Assets for the SPA | Cloudflare Pages + Pages Functions |
| Build integration | `@cloudflare/vite-plugin` (one Vite project builds SPA + Worker; local dev runs in `workerd`) | Two separate projects |
| Database | **Cloudflare D1** + **Drizzle ORM**; SQL migrations committed and applied with `wrangler d1 migrations` | Durable Objects SQLite, external Postgres |
| Object storage | **Cloudflare R2** (private, bindings only) | Cloudflare Images, S3 |
| Auth | **Cloudflare Access** (Zero Trust Free), email one-time code, + JWT verification in Worker (`jose`) | Custom login / passkeys (contingency only) |
| AI | Anthropic Messages API via official `@anthropic-ai/sdk` from the Worker; structured outputs; prompt caching | Client-side calls; Cloudflare AI Gateway |
| Push | Web Push (VAPID) from Worker via a WebCrypto-based library; Declarative Web Push payload when supported | Third-party push service |
| Weather | **Open-Meteo** (no key) called by the Worker | OpenWeatherMap, Apple WeatherKit |
| Tests | Vitest (+ `@cloudflare/vitest-pool-workers`), Playwright (WebKit, iPhone viewport) | Jest |
| CI/CD | GitHub Actions (tests, no secrets) + **Cloudflare Workers Builds** (deploy) | Deploying from a personal machine |
| Package manager | pnpm | npm/yarn |

### Key choice: frontend framework
- **Recommendation:** React + Vite SPA, TypeScript.
- **Reason:** The app is fully behind authentication and must work offline, so SSR brings no value; a client-rendered SPA is the simplest model for a local-first app. React has the largest ecosystem for what we need (Radix with RTL `DirectionProvider`, Dexie hooks, Workbox) and is the most reliably supported by AI-assisted development.
- **Limitations:** Larger runtime than Svelte/Solid (~45 KB gz). Mitigated by route-level code splitting and precaching.
- **Security:** No server rendering of user data; strict CSP possible (no inline scripts).
- **Cost:** None.
- **Rejected:** SvelteKit. **Why:** smaller ecosystem for accessible RTL-aware primitives; SSR/adapter concepts not needed. Next.js/Remix rejected: SSR-centric, heavier on Workers, no benefit behind Access.

### Key choice: Hebrew RTL implementation
- `<html lang="he" dir="rtl">`, manifest `"dir": "rtl", "lang": "he"`.
- Logical CSS properties only; a lint rule forbids physical `left/right/ml/mr/pl/pr`.
- Scientific names, NPK values and Latin-script measurements rendered in `<bdi>` / `dir="ltr"` spans with `unicode-bidi: isolate`. AI structured output returns scientific names in separate fields so the UI can isolate them.
- Numbers/dates via `Intl` with `he-IL`; metric units only; `Intl.PluralRules('he')`.
- Hebrew font self-hosted (e.g., Rubik/Assistant/Heebo, OFL) — no runtime Google Fonts request (privacy, offline).
- Directional icons mirrored for RTL; gallery swipe direction follows RTL reading order.

---

## 3. Repository and project structure

Single private GitHub repository, single package:

```
leafling/
├─ PRODUCT_SPEC.md                # product source of truth (committed, unchanged)
├─ ARCHITECTURE.md                # this document
├─ PROJECT_STATE.md               # phase / status tracker
├─ assets/brand/                  # approved original icon, unchanged — added at start of Phase 1
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
│  │  ├─ api/                     # Hono routes: sync, photos, ai, push, export, import
│  │  ├─ ai/                      # context builder, prompts, schemas, budget
│  │  ├─ jobs/                    # consolidated cron: notifications, trash purge, weather
│  │  └─ integrations/            # weather, plant name sources
│  └─ shared/                     # pure domain logic, used by client AND worker
│     ├─ schema/                  # Zod: entities, event payloads, mutations, AI proposals, export format
│     ├─ domain/                  # naming (#2/#3), soil-check model, dry-down learning,
│     │                           # fertilizer windows, task generation, confidence rules,
│     │                           # group split/thin, lineage, cascade policy
│     └─ constants/
├─ migrations/                    # D1 SQL migrations (0001_init.sql …), forward-only
├─ tests/                         # unit, worker-integration, e2e (Playwright)
├─ docs/runbooks/                 # restore, domain move, key rotation (added in Phase 1)
├─ wrangler.jsonc                 # bindings per environment (no secrets)
└─ .github/workflows/ci.yml
```

Rule: **domain rules live only in `src/shared/domain`** as pure, unit-tested functions. The client uses them for immediate offline results; the Worker uses the same code for authoritative results and notifications.

---

## 4. System components

```
 iPhone (Home Screen PWA, Safari engine)
 ┌──────────────────────────────────────────────┐
 │ React UI  ──reads──▶ IndexedDB (local copy)  │
 │    │ writes              ▲   ▲               │
 │    ▼                     │   │ pull deltas   │
 │ Pending-change queue (outbox + photo blobs) ─┼─push─┐
 │ Service Worker: precache, image cache,       │      │
 │                 push, notificationclick      │      │
 └──────────────────────────────────────────────┘      │ HTTPS, same origin
                               ┌───────────────────────▼┐
                               │  Cloudflare Access     │  (email one-time code, cookie)
                               └───────────┬────────────┘
                               ┌───────────▼───────────────────────────────┐
                               │ Leafling Worker (Workers Free)            │
                               │  static assets │ /api/sync │ /api/photos  │
                               │  /api/ai │ /api/push │ /api/export|import │
                               │  scheduled() (one hourly cron):           │
                               │    notifications, trash purge, weather    │
                               └──┬───────────────┬──────────────┬─────────┘
                                  │               │              │
                        D1 (durable source   R2 photos      External HTTPS:
                         of truth)           (private)      Anthropic API, Open-Meteo,
                                                            plant-name sources,
                                                            Apple Web Push service
```

| Component | Responsibility |
|---|---|
| PWA UI | 5-tab navigation, floating +, all screens; reads only from the local copy |
| IndexedDB local copy | Offline copy of the user's structured data (MBs) + sync cursor |
| Pending-change queue | Durable outbox of idempotent mutations + pending photo blobs; survives app close and auth expiry |
| Service worker | App-shell precache, image cache, push display, notification click routing |
| Access | Authenticates the one authorized person before any request reaches the Worker |
| Worker API | Verifies JWT + input, applies mutations atomically to D1, serves photos, AI proxy, export/import |
| Worker cron | One hourly trigger dispatching: important-task notifications, trash purge, weather refresh |
| D1 | **Durable source of truth**: structured data, event log, conflict records, change log, AI metadata, push subscriptions |
| R2 `leafling-photos` | Originals + derivatives, private |

---

## 5. End-to-end data flow

**A. Soil check from Today (offline-capable):**
1. User taps "יבש – השקיתי". UI calls `mutate({type:'soil_check.record', plantId, result:'dry', watered:true})`.
2. Client writes, in one IndexedDB transaction: the events (`soil_check`, `watering`), the updated plant current state, the recomputed next task (shared domain code), and a queue entry with a client-generated `mutationId` (UUIDv7). The change is now durable on the device.
3. UI updates instantly. A small indicator shows "נשמר במכשיר" until D1 confirms.
4. Sync engine sends the queue batch to `POST /api/sync/push`. Worker verifies JWT, validates with Zod, checks the `mutationId` idempotency table, compares each field's `baseRev` with the server revision (§10), applies all statements in one **D1 `batch()`** (atomic), assigns new server revisions from the `change_log` sequence, recomputes tasks with the same shared code, returns the new server sequence.
5. Only after D1 acknowledges is the queue entry marked synced; `pull` then retrieves server-side changes.

**B. Adding a journal photo:**
1. User picks/takes a photo. Client reads EXIF capture date (without modifying the file), computes SHA-256, generates `display` (~1600 px long edge) and `thumb` (~400 px) copies via `createImageBitmap` + canvas (copies contain no EXIF/GPS).
2. Original blob + copies stored in IndexedDB; a `photo.create` mutation is queued; UI shows the local thumbnail immediately.
3. Upload queue streams the original (byte-for-byte) to `PUT /api/photos/:id/original`; the Worker streams it straight into R2 passing the client's SHA-256 as the R2 checksum, so **R2 verifies integrity** without the Worker hashing (keeps CPU within the Free plan). Then display and thumb copies.
4. Only after D1 records the photo as `stored` is the local original eligible for removal from IndexedDB (copies stay cached).

**C. AI Botanist question from a plant card:**
1. Client sends `{feature:'botanist', plantId, question, imageIds[], conversationId}` — no plant data beyond IDs and the question.
2. Worker checks budget + rate limit, loads that plant's memory digest from D1 (§12), attaches referenced AI-size images, calls Claude with structured output, streams the answer back.
3. Proposed actions arrive as typed `proposals[]`; UI renders confirm cards. On confirm, the client submits a normal mutation tagged `source:'ai_confirmed', aiProposalId`.

---

## 6. Authentication and authorization

### Recommendation: Cloudflare Access (email one-time code) in front of the whole origin, plus JWT verification in the Worker
- **Reason:** Meets "one authorized user, no custom email/password system" with no auth code to maintain. Access runs before the Worker, so unauthenticated traffic never reaches application code, D1, R2 or the Claude proxy — this is also the primary abuse protection for AI spend.
- **Configuration:**
  - Zero Trust **Free** plan (free up to 50 users; we use 1).
  - Access protection on the Worker's **workers.dev** URL (Cloudflare supports Access for workers.dev, version, preview and deployment URLs).
  - Policy: *Allow* — email equals the owner's single address. Everything else denied.
  - Identity method: **One-time PIN (email one-time code)** — **approved for the initial Access test.**
  - Application session duration: long (e.g., 1 month; maximum allowed confirmed at setup) to minimize re-login in the installed PWA.
  - Optional bypass only for `/manifest.webmanifest` and `/icons/*` (non-sensitive) so iOS can fetch icons when adding to the Home Screen.
- **Worker verification (defense in depth):** every `/api/*` request must carry `Cf-Access-Jwt-Assertion`; the Worker verifies the signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (cached, `kid`-matched), `aud` = application AUD tag, `exp`, and `email` == configured owner email. Failure → 401 JSON. Protects against a misconfigured policy or an accidentally public route.
- **Authorization model:** single tenant. Every row carries `owner_id` (constant) so a future second user is a migration, not a rewrite; no multi-user features are built.

### Access compatibility with the iPhone PWA

| Concern | Behavior | Design response |
|---|---|---|
| Installed PWA vs Safari | Home Screen web apps have their own cookie/storage jar, separate from Safari. | First launch of the installed app performs the one-time-code login inside the app once. |
| Login redirect in standalone mode | Access redirects to `<team>.cloudflareaccess.com` (outside app scope). iOS opens out-of-scope navigation in an in-app browser sheet and returns when redirected back to the app origin. | **Validated on a real iPhone in Phase 0.** One-time code keeps the flow on Cloudflare pages (no third-party popups). |
| Service worker | SW script and precache requests go through Access. If the session expired, the SW update fetch fails; the **app keeps running from cache**. | SW update failures are silent and retried. |
| API requests | With an expired session, Access answers `fetch` with a 302 to the login domain. | All API calls use `redirect:'manual'`; an `opaqueredirect`/401 becomes state **"צריך להתחבר מחדש"**. The pending-change queue keeps every write; a banner button performs a top-level navigation to sign in; sync resumes after. **No data loss.** |
| Same-origin API | API is on the same workers.dev hostname as the app. | No CORS; one Access application. |
| Background behavior | iOS PWAs have **no Background Sync / Periodic Background Sync**; the SW runs only for push/notification events and while the app is open. | Sync runs on app open, on becoming visible, on `online`, and on a foreground interval. |
| Push notifications | Push travels Apple Push Service → device, never through Access. Subscription registration is a normal authenticated call. | Works regardless of Access session state; tapping opens the app URL (sign-in if expired). |
| Lost / stolen phone | The session remains valid until expiry. | Runbook: revoke sessions in the Zero Trust dashboard. No client secrets exist to rotate. |

- **Security:** No passwords stored by Leafling; no client-held secrets.
- **Cost:** Free.
- **Contingency (separate owner approval, only if the Phase 0 spike fails):** WebAuthn passkey sign-in verified by the Worker with an HttpOnly session cookie. Not part of the recommended design.
- **Rejected:** custom email/password or magic-link auth. **Why:** out of scope per `PRODUCT_SPEC.md` §6; more code and attack surface.
- **Rejected:** "secret URL" / static token in the app. **Why:** a bearer secret in the frontend violates the no-secrets-in-client principle.

---

## 7. Data model overview

Exact schema is finalized in Phase 1 migrations; this is the approved shape. IDs are **UUIDv7** generated on the client (sortable, offline-safe). Tables include `created_at`, `deleted_at` (soft delete), `owner_id`, a server-assigned `rev` (from the global `change_log` sequence) and per-field server revisions for mutable fields. Client-side `client_updated_at` and `device_id` are stored as **metadata only** and are never used to order or resolve changes.

### Core entities

| Table | Purpose / key fields |
|---|---|
| `user_profile` | Onboarding answers & settings: region (city/area/country + rounded lat/lon for weather), experience level, grow interests, spaces, help preferences, notification prefs, quiet hours, appearance, timezone, last export date |
| `pets` | kind (dog/cat/bird/rabbit/rodent/reptile/other), optional name |
| `locations` | name (required), indoor/outdoor, window distance/direction, direct sun, AC; outdoor exposure/rain/wind |
| `light_readings` | location_id, measured_at, method (`manual_lux`, `camera_relative`, `questionnaire`), value/category, time-of-day bucket, season — a profile, never one fixed value |
| `species` | Catalog entry: scientific name, family, external IDs (GBIF/Wikidata/WFO), representative image + license |
| `species_names` | species_id, name, language (`he`, `en`, `la`…), type (common/local/scientific/alias) — FTS5 search |
| `species_facts` | species_id, topic, structured value, **provenance** (§15) |
| `plants` | Personal card: species_id, `species_ordinal`, nickname, status (`rooting`/`seedling`/`plant`/`sick` — exactly four), `kind` (`single`/`group`), group counts, current location, current pot, current substrate, key dates with precision, main_photo_id, archived_at |
| `plant_lineage` | parent_plant_id, child_plant_id, relation (`cutting_of`, `split_from`, `division_of`), occurred_at — explicit only |
| `plant_events` | Append-only event log (§8) |
| `photos` | R2 keys (original/display/thumb), sha256, crc32 (computed on the phone, used for streamed photo export), mime, `media_type` (image only in v1), bytes, width/height, captured_at + source (`exif`/`user`/`upload`/`unknown`), upload_state, in_timelapse |
| `photo_links` | photo ↔ plant / journal event / health case / location / fertilizer / wishlist — one logical photo, many appearances |
| `tasks` | plant_id, kind (soil_check, fertilize_window, rooting_check, seedling_step, repot, treatment_step, health_followup, custom_reminder), window start/end, important flag, origin (`rule`/`treatment`/`reminder`/`ai_confirmed`), state, completed_by_event_id |
| `suggestions` | kind (photo_progress, light_measurement…), dismissed_until — **no due dates, never overdue** |
| `custom_reminders` | plant_id, kind (rotate/support/inspect/custom), text, recurrence, next_at, active |
| `health_cases` | plant_id, state (active/monitoring/resolved), diagnosis source (`ai`/`professional`/`user`), likely cause, confidence, alternatives, evidence, missing info, urgency, contagious_suspected, previous_case_id |
| `treatments` | case_id, plan steps (generate `tasks`), started/ended, conflict notes |
| `fertilizers` | name, photo, NPK, manufacturer instructions (verbatim), dose |
| `wishlist_items` | species_id, personal note, purchased_at, created_plant_id |
| `user_materials` | Owned substrate materials (Soil Mix Builder) |
| `ai_conversations`, `ai_messages` | User-visible chat history (user data; exportable, deletable) |
| `ai_proposals` | request_id, type, payload, rationale, confidence, state, resulting_mutation_id |
| `ai_requests` | Operational metadata only (§11) |
| `sync_conflicts` | Every overwritten value from a concurrent edit (§10): entity, field, overwritten value, winning value, base/server revisions, receipt sequence, device and client-timestamp metadata, resolution state — never auto-deleted |
| `rejected_mutations` | Mutations the server could not apply, with full original content (§10) |
| `push_subscriptions` | endpoint, keys, device label, last_success_at, failure_count |
| `notification_log` | tasks included, sent_at, result |
| `sync_mutations` | mutation_id (PK), received_at, result — idempotency |
| `change_log` | seq (autoincrement), table, row_id, op — drives delta pull |
| `export_runs` | Data and photo export runs: timestamps, scope (year/batch), row/photo counts, checksums (for Settings "מצב גיבוי") |

### Rules encoded in the model
- **Naming:** `species_ordinal` = (highest ordinal ever used for that species) + 1. The first plant has ordinal 1 and is displayed **without** a number; later ones display `#2`, `#3`. `#1` is never shown; ordinals are never reused. Nickname overrides the display name only; identity never changes. Split children receive new ordinals the same way.
- **Statuses:** DB `CHECK` allows only the 4 personal statuses. Wishlist is a separate table, never a status.
- **Pot/substrate:** nullable.
- **Current state + history:** a change to pot/substrate/location/status writes an event (`from`→`to`) *and* updates the current column in the same atomic batch (e.g., pot 12→17→21 cm preserved).
- **Search:** SQLite FTS5 over species names; personal-name search runs on the local copy.

### Archive / Delete cascade & retention (open decision #12 — approved)
- **Archive:** hides the plant from active lists, Today, tasks and notifications; keeps everything; reversible.
- **Delete plant:** soft delete into "נמחקו לאחרונה" for **30 days** (restorable), then purge by the cron job: events, tasks, links, AI conversations about that plant, and photos not linked elsewhere are removed from D1 and R2.
- **Lineage preservation:** if a deleted plant has descendants, a minimal tombstone (species, display name, dates) and the events the descendants inherit are retained.
- **Delete photo:** soft delete 30 days, then purge original + copies.
- **Delete location with plants:** allowed; plants get "ללא מיקום" with a `location_changed` event.
- **Delete fertilizer:** events keep a name/NPK snapshot.
- Exports the user saved earlier and D1 Time Travel (7 days) still contain deleted data — documented so "delete" is honest.

---

## 8. Event-history architecture

### Recommendation: one append-only `plant_events` table with typed, versioned payloads
Fields: `id` (UUIDv7), `plant_id`, `type`, `occurred_at`, `occurred_precision` (`exact`/`day`/`month`/`unknown`), `payload` (JSON validated by a per-type Zod schema), `payload_version`, `source` (`user`/`system`/`ai_confirmed`/`import`), `ai_proposal_id`, `device_id`, `recorded_at` (server), `supersedes_event_id`, `deleted_at`, visibility flags `in_history`, `in_journal`.

Event types (extensible): `soil_check`, `watering`, `fertilizing`, `fertilizer_skipped`, `repot`, `pot_changed`, `substrate_changed`, `location_changed`, `status_changed`, `pruning`, `note`, `milestone` (first_sprout, new_leaf, first_flower, new_growth, first_root, repotted, recovered, other), `photo_added`, `sowing`, `germination_update`, `thinning`, `split`, `separated`, `propagation_started`, `cutting_taken` (on mother), `root_check`, `water_change`, `moved_to_substrate`, `propagation_completed`, `diagnosis`, `professional_diagnosis`, `treatment_started`, `treatment_step_done`, `treatment_ended`, `recovery_observation`, `reminder_done`, `task_postponed`, `measurement`, `field_conflict` (§10).

- **Reason:** Single Source of Truth (spec §46): one watering event feeds History, Journal (if meaningful), dry-down learning, AI context and export. Append-only events make sync conflict-free for the most common writes and give long-term memory an auditable basis.
- **Journal vs History:** same table, different views. Journal = `in_journal` (notes, photos, milestones, meaningful automatic events). History = `in_history` technical log with filters (הכול/השקיה/דישון/עציץ/מיקום/בריאות/התפתחות). No duplicate manual logging.
- **Corrections:** editing an event writes a new version with `supersedes_event_id`; deletion is soft.
- **Group history inheritance:** on split, each child gets `split_from` lineage + a `separated` event. A child's history = its own events ∪ parent events with `occurred_at ≤ split time`. No copying, dates preserved.
- **Thinning / partial success:** updates group counts via events; no card per seed and no dead cards.
- **Propagation → plant:** the same `plants` row continues through confirmed `status_changed` events.
- **Limitations:** D1 has no interactive transactions; multi-statement writes use `batch()` (atomic). Payload JSON validated by Zod at both ends with `payload_version`.
- **Security:** AI cannot delete events; `source` makes AI-originated changes auditable.
- **Cost:** thousands of events per year ≈ a few MB.
- **Rejected:** a table per event type. **Why:** many joins and migrations; loses the uniform timeline.
- **Rejected:** full event sourcing with replay. **Why:** unnecessary complexity.

---

## 9. Photo-storage and thumbnail design

### Recommendation: private R2 bucket; originals byte-identical; copies generated on the iPhone
Object keys: `photos/{photoId}/original` (original MIME preserved), `photos/{photoId}/display.jpg` (~1600 px long edge), `photos/{photoId}/thumb.jpg` (~400 px). Keys are write-once; the Worker refuses to overwrite `original`.

- **Reason:** Originals immutable (spec §21); technical thumbnails allowed. Client-side generation needs no paid image service and no server CPU. Lists load only thumbnails (spec §50).
- **Copies carry no EXIF/GPS** (re-encoded through canvas).
- **Integrity:** client computes SHA-256; the Worker streams the upload to R2 with that checksum and R2 rejects mismatches — no Worker-side hashing (Free-plan CPU friendly).
- **Capture date:** EXIF `DateTimeOriginal` read client-side, else today/date/unknown (spec §22). iOS metadata availability validated in Phase 0.
- **HEIC:** stored as received; Safari decodes it for copy generation. AI images are always JPEG.
- **Upload path:** streamed `PUT` through the Worker to R2 (100 MB request body limit on Free — ample for photos). Retries per object; D1 confirmation required before local blob eviction.
- **Timelapse / Compare — approved:** use the **uncropped display-size copies** of the originals, in capture-date order, with no crop/align/overlay; framing identical to the original. "פתח מקור" opens the original.
- **Placeholder species images** live in the species catalog, are visibly marked, and never enter Journal/Timelapse.
- **Journal video — approved: excluded from version 1.** `media_type` keeps the door open.
- **Private delivery:** no public bucket, no `r2.dev`, no presigned URLs. Reads go `GET /api/photos/:id/:variant` → Worker (after Access + JWT) → R2 binding, streamed (no buffering). Headers: `Cache-Control: private, max-age=31536000, immutable`, stored `Content-Type`, `X-Content-Type-Options: nosniff`. The service worker caches thumbnails/display copies (bounded LRU).
- **Privacy:** originals keep embedded EXIF (possibly GPS) because they are immutable; they are never public and never sent to Claude.
- **Cost:** R2 Standard: 10 GB-month free, then US$0.015/GB-month; 1 M Class A and 10 M Class B operations/month free; zero egress. ~2,800 photos at ~3.5 MB fit in the free 10 GB; 5,000 photos ≈ US$0.11/month.
- **Rejected:** Cloudflare Images / transformations. **Why:** extra service and potential cost for work the phone does for free.
- **Rejected:** Worker-side WASM resizing. **Why:** CPU (10 ms Free) and memory (128 MB) limits.
- **Rejected:** presigned R2 URLs. **Why:** bearer URLs can leak and bypass Access.

---

## 10. Offline, caching and synchronization design

### Source-of-truth model
| Store | Role | Guarantees |
|---|---|---|
| **D1** | **The durable, synchronized source of truth.** A change is "saved" only when D1 has committed it. | Atomic batches, idempotent mutations, Time Travel, export source |
| **IndexedDB (iPhone)** | **Offline local copy** of structured data and the **pending-change queue** (mutations + photo blobs not yet confirmed by D1). | Survives closing the app, restarting the phone, and Access session expiry; entries are removed only after D1 acknowledgement |
| Cache Storage | App shell and image cache | Disposable; rebuilt from the network |

Consequences:
- The UI reads from IndexedDB so it works offline; it clearly distinguishes **"נשמר במכשיר, ממתין לסנכרון"** from synced state.
- If the local copy is lost or inconsistent, "סנכרון מחדש מהשרת" rebuilds it from D1 — but only after any pending queue entries are pushed (the rebuild never wipes unsynced changes).
- The server never trusts the client's derived values (tasks, next check); it recomputes them.

### Caching
| Data | Where | Policy |
|---|---|---|
| App shell (HTML/JS/CSS/fonts/icons) | SW precache (content-hashed) | Updated on deploy; new version activates on next launch with a gentle "גרסה חדשה זמינה" |
| All structured personal data | IndexedDB | Full sync — hundreds of plants/thousands of events are a few MB |
| Thumbnails | Cache Storage | Prefetched for active plants; LRU cap (e.g., 150 MB) |
| Display copies | Cache Storage | On demand; LRU cap (e.g., 300 MB) |
| Originals | Not cached, except pending uploads in IndexedDB |
| AI conversations | IndexedDB (read-only offline) | |
| Species catalog | Entries for owned/wishlist species + recent searches | |

`navigator.storage.persist()` is requested (WebKit grants it by heuristics such as running as a Home Screen web app; persistent origins are protected from eviction). Settings shows device storage use and sync state.

**Offline-capable actions:** Today task responses, notes, journal photos (queued upload), milestones, status/location/pot/substrate changes, adding a plant (local catalog or "unknown" placeholder), custom reminders, manual light readings, viewing everything cached.
**Online-only:** AI features, external species lookup, weather, push subscription, export/import. UI says "צריך חיבור לאינטרנט" with retry.

### Pending-change queue (outbox)
- Each entry: `mutationId`, type, payload, created_at, attempts, state (`pending`/`sending`/`failed-retryable`/`rejected`).
- Written in the **same IndexedDB transaction** as the local data change, so a local change can never exist without its queue entry.
- FIFO per entity; photo uploads depend on their `photo.create` mutation.
- Retries with exponential backoff + jitter; resumes on app start, visibility, `online`.
- **Authentication expiry:** a 401/redirect pauses the queue (entries stay `pending`), shows "צריך להתחבר מחדש", and resumes after sign-in. Nothing is dropped.
- **Never dropped automatically.** A mutation the server permanently rejects (e.g., validation) is stored in D1 `rejected_mutations` *and* kept locally in a visible "לא נשמר — לבדיקה" list with its full content, until the user resolves or dismisses it.
- iOS limitation: there is no background sync, so the queue drains when the app is opened. If the user deletes the Home Screen app, iOS deletes its local storage, including unsynced changes; the UI therefore keeps the pending count visible and syncs as soon as it is online.

### Synchronization protocol
- `POST /api/sync/push` — small batches of mutations (sized to stay within Free-plan per-invocation limits, §21) → per-mutation results; idempotent via `sync_mutations`.
- `GET /api/sync/pull?since=<seq>` — changes since the client's last `change_log` seq, paginated.
- Initial load and "סנכרון מחדש מהשרת" for recovery.

### Conflict handling — server ordering, conflict history never silently discarded
Scenario: one user, possibly two devices (iPhone + another browser) or an old queued change arriving late.

**Ordering source:** the **server** decides order. D1 processes mutations one at a time (single writer); each accepted change receives a monotonically increasing server revision from the `change_log` sequence. **Device clocks are never trusted for ordering** — iPhone timestamps (`client_updated_at`) are kept only as metadata for display and diagnostics.

- **Events:** append-only with unique IDs → all kept; no conflict. (An event's `occurred_at` is the user-stated domain time, e.g. "watered yesterday", used for History display and learning — it is not a sync-ordering key.)
- **Entity fields:** every mutation carries, per changed field, the `baseRev` it was based on.
  - If the field's current server revision equals `baseRev` → apply normally.
  - If the field changed on the server after `baseRev` (a concurrent edit) → the change is applied in **server receipt order** (the later-received write becomes current), **and** the server writes a `sync_conflicts` row plus a `field_conflict` event holding the overwritten value, the new value, both revisions, the receipt sequence and device/client-time metadata.
  - If both values are identical → no conflict is recorded.
- **Preservation:** every overwritten value is visible in History and in a small "שינויים שהתנגשו" list; the user can restore it with one tap (a restore is itself a normal new change with a new server revision). Conflict records are never auto-deleted (purged only with a hard-deleted plant after the trash period).
- **Status / treatment end / task completion:** idempotent transitions; a duplicate completion is a recorded no-op.
- **Delete vs edit:** soft delete wins; the edit is kept on the tombstone and restorable from trash.
- **Derived data:** recomputed on the server after each push; client optimistic values replaced on pull.

### Weak or interrupted connections
Request timeouts (e.g., 15 s for sync), small batches, per-object photo upload retries, streamed AI responses. AI requests are not auto-retried after partial output (avoids double cost); the user can retry with one tap and the question text is kept.

- **Security:** local data protected by iPhone passcode/encryption; no secrets stored locally; Access cookie HttpOnly.
- **Cost:** none beyond Worker requests.
- **Rejected:** online-only app. **Why:** violates "personal data must not disappear because of a temporary network failure."
- **Rejected:** CRDT/sync frameworks (Automerge, Replicache, PowerSync, ElectricSQL). **Why:** heavy dependencies or paid services for a single-user app; append-only events + recorded field conflicts are sufficient.

---

## 11. AI service architecture

### Recommendation: Worker-side Claude proxy with feature endpoints, structured outputs, budgets and metadata-only logging

**Endpoints** (`POST /api/ai/*`): `botanist`, `identify`, `diagnose` (with image-quality pre-check), `recovery-check`, `pest-id`, `what-is-this`, `label-read`, `root-ball`, `location-fit`, `species-profile-draft` (§15), `tool-assist`.

**Model routing (proposal):**
| Use | Model | Why |
|---|---|---|
| Botanist, Diagnose, identification, pest ID, "What is this?", recovery check | `claude-sonnet-5` (US$2 / US$10 per M input/output tokens) | Strong vision + reasoning at moderate cost |
| Image quality pre-check, label extraction, short classification | `claude-haiku-4-5` (US$1 / US$5 per M) | Cheap, fast |
Model IDs are configuration, but the Worker enforces an **allowlist of exactly these two models** in version 1. **Opus is not enabled in version 1** and may be added only after explicit future owner approval.

**Request pipeline:**
1. Access + JWT verified.
2. Zod validation: question length cap, image count cap (e.g., ≤ 4 Diagnose, ≤ 5 Botanist), referenced photo IDs must belong to **that plant** for plant-scoped features.
3. Rate limit (Workers Rate Limiting binding if available on the Free plan at setup; otherwise a D1 counter — e.g., 20 AI requests / 10 min) + **budget check** (D1 daily and monthly estimated spend; hard stop with a calm Hebrew message).
4. Context builder (§12).
5. Claude call: fixed cached system prompt (Hebrew output, uncertainty rules, safety rules, no-mutation rule); `max_tokens` capped per feature; structured output schema per feature; streamed response (waiting on Claude is I/O, not CPU).
6. Output validation (Zod); at most one repair attempt, else friendly error.
7. Guardrails: confidence clamped by server rules (§12); proposals validated against allowed types; high-risk proposals require `likely` or better or are downgraded to "consider consulting".
8. Persist: conversation messages (user data), `ai_proposals`, `ai_requests` metadata.

**Structured AI response shape:**
```
{
  answer_he,
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

**No silent mutations (spec §43):** AI endpoints have no write path to user data except storing the conversation and *proposal* rows. Accepting a proposal is a separate client action that submits a normal validated mutation (`source:'ai_confirmed'`). No tool-use loop can write.

**Secret handling:** `ANTHROPIC_API_KEY` is a Worker secret (encrypted; never in Git, never returned, never logged). Separate Anthropic workspaces/keys for production and preview, each with its own console spend limit.

**Spending controls (layered):**
1. Anthropic Console workspace **monthly spend limit** (hard ceiling) — production set to **US$10/month** (approved).
2. Leafling monthly (US$10) and daily budgets in D1 (warn at 80 %, stop at 100 %).
3. Per-request caps: `max_tokens`, image count, image size (≤ ~1.15 MP AI copy), context token budget.
4. Prompt caching of the stable system prompt.
5. Rate limiting.
6. Preview uses a mock Claude by default.

**Free-plan CPU note:** base64-encoding and JSON-serializing several images counts toward the 10 ms CPU limit. Phase 0 measures the CPU of a 4-image Diagnose request. Mitigations before any upgrade: client sends the already-encoded JPEG AI copy (≤ ~200 KB each) so the Worker only forwards; smaller AI copies (e.g., 1092 px); lower image caps (§21 trigger T1).

**AI logging without unnecessary personal data:** `ai_requests` stores id, timestamp, feature, model, plant_id (reference), conversation_id, token counts (input/output/cache), image count, estimated cost, latency, stop reason, status/error, **names** of context sections included and a context hash. **No prompt text, answer text or images in operational logs.** Worker logging never prints request/response bodies (logger wrapper + lint rule). The user-visible conversation is stored as user data, deletable and exportable. Anthropic's API data handling follows its commercial terms (confirmed at key creation).

- **Rejected:** Cloudflare AI Gateway. **Why:** adds a service and, with logging on, stores prompts/images; our own controls suffice. Optional later with logging disabled.
- **Rejected:** browser-side Claude calls. **Why:** exposes the key; forbidden by spec §40.
- **Rejected:** agentic tool use with write tools. **Why:** conflicts with "AI never silently changes user data".

---

## 12. AI context-building and plant-memory design

### Recommendation: server-side deterministic "plant memory digest" + intent-based sections under a token budget

**Principles enforced in code:**
- The client sends only IDs and the question. The context builder API is `buildContext(plantId, intent)` and can only query rows of that plant — "unrelated plants never included" is structural.
- Never the whole DB. Hard token budget (e.g., 3,000 tokens of structured context, excluding images).
- A **context isolation test** asserts contexts contain no IDs, names or nicknames of other plants.

**Plant memory digest** (computed from events; cached per plant and invalidated on new events):
1. Identity: display name, species (scientific + Hebrew), status, age / day count, kind + group counts.
2. Current state: location summary + light profile category, pot and substrate (if known), indoor/outdoor.
3. Watering behavior: last watering, last soil-check result, personal dry-down statistics with sample size and confidence, season bucket.
4. Fertilizing: last date, fertilizer used (name/NPK), window state.
5. Health: active cases and treatments; resolved cases as one-line summaries (12 months) unless recurrence is asked about.
6. Development: stage, root state, milestones.
7. Recent notes (last N, truncated).
8. Confirmed plant insights (user-accepted AI observations).
9. Species facts **with provenance tags**.

**Intent-based inclusion:** a rules-based classifier (keywords + entry point) selects sections — watering → 1–3 + species water facts; diagnosis → 1–5 + events from the last 30 days; pet safety → species safety facts + pet kinds (not pet names). Region and experience level only when relevant; experience level changes explanation depth only.

**Edge cases:**
- Contagion: AI returns `contagious_suspected`; the **app** lists co-located plants from local data and suggests checking them. Neighbor data is never sent.
- Lineage question: only the explicit mother/descendants of *that* plant (display names + species).
- General Botanist chat without a selected plant: no personal plant data; the user may attach one plant.

**Long-term personalized memory — weighting & patterns:**
- Recommendation = blend of species prior (+ season, pot, substrate, location) and personal evidence: `weight_personal = n / (n + k)` (`n` = qualifying observed cycles, `k` per metric, e.g., 4).
- **Pattern claims require ≥ 3 consistent observations**; fewer → at most "נראה ש…"; a single event never produces a pattern.
- Dry-down cycles computed from `watering` → subsequent `soil_check: dry`, per season; outliers flagged. When sufficient, shows last watering, typical range, number of cycles (spec §26).
- Weather may move a check but never concludes watering need (spec §26, §36).

**Confidence conventions (open decision #17 — approved):**
- Four levels, fixed Hebrew labels: **ידוע / גבוה**, **סביר / בינוני**, **אפשרי / נמוך**, **אין מספיק מידע**. No percentages.
- Text + icon shape, not color alone.
- Server clamps AI levels: no photo → max `likely` for visual diagnosis; retake requested → max `possible`; personal statistics with n < 3 → `possible`/`insufficient`; identification with close alternatives → never `known`.

**AI image handling & cost:**
- Client prepares a JPEG AI copy (long edge ≤ 1568 px, ≤ ~1.15 MP, EXIF stripped). Image tokens ≈ width × height / 750 → ~1,500 tokens ≈ US$0.003 per image on Sonnet 5.
- Existing journal photos are referenced by ID; the Worker reads their display copy from R2.
- Diagnose: cheap Haiku quality pre-check on the first image; retake only when materially needed.
- Conversation history trimmed to the last N turns + short summary.

---

## 13. Security and secret management

**Secrets (Worker secrets per environment — never in Git, never in frontend bundles):**
| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | AI proxy |
| `VAPID_PRIVATE_KEY` (public key `VAPID_PUBLIC_KEY` is non-secret configuration and may also be stored in D1) | Web Push |
Non-secret config in `wrangler.jsonc`: Access team domain, AUD tag, owner email, model IDs, budgets.
Local development uses `.dev.vars` (gitignored) with mock values. GitHub holds **no** Cloudflare token when Workers Builds deploys.

**Controls:**
- Access in front of everything + JWT verification in the Worker.
- Strict CSP (`default-src 'self'`, `img-src 'self' blob: data:`, `connect-src 'self'`, no inline scripts), `frame-ancestors 'none'`, HSTS, `Referrer-Policy: no-referrer`, minimal `Permissions-Policy`.
- Zod validation on every input; parameterized queries only.
- Photo endpoints check ownership; content-type and size limits; R2 checksum verification; original overwrite refused.
- AI and user text rendered as text (sanitizing Markdown renderer with an allowlist).
- Prompt-injection posture: AI output cannot mutate data; photos/labels are data, not instructions; proposals validated server-side.
- GitHub secret scanning; dependency update bot; committed lockfile.
- Logs contain no bodies, photo bytes or AI content.
- Runbooks: Anthropic key rotation, VAPID rotation (requires re-subscribe), Access session revocation.

**VAPID key provisioning (all environments, including Phase 0):**
- The VAPID private key is **never** stored in D1, R2, KV, logs, Git, source files, chat or frontend code — only as the encrypted Worker secret `VAPID_PRIVATE_KEY`. Only the public key is stored as configuration (`VAPID_PUBLIC_KEY` plain variable) and, if convenient, in D1.
- Generation: an Access-protected, one-time **key-generation page** served by the Worker generates a P-256 key pair **inside the owner's browser** with WebCrypto (`crypto.subtle.generateKey`). The page makes no network requests (CSP `connect-src 'none'`), never sends or stores the private key, and shows it once with a copy button. The owner pastes it straight into Cloudflare dashboard → Worker → Variables and Secrets → type **Secret** → `VAPID_PRIVATE_KEY`, pastes the public key as plain variable `VAPID_PUBLIC_KEY`, then clears the clipboard and closes the page. The page refuses to run once `VAPID_PUBLIC_KEY` is configured.
- Rotation repeats the procedure; existing push subscriptions must then re-subscribe.
- Rejected: Worker self-generating and storing the key in D1 (secret at rest in the database — owner rejected). Rejected: GitHub Actions generating it and calling `wrangler secret put` (requires a Cloudflare API token stored in GitHub).

**Privacy:** single private system; no analytics, ads or tracking (spec §50); self-hosted fonts; weather uses city-level coordinates rounded to ~0.1°; plant-name lookups send only species names; Claude receives only minimal single-plant context and EXIF-stripped images.

---

## 14. Notifications

### Current iPhone capability (WebKit documentation)
- Web Push works **only for web apps added to the Home Screen**, iOS/iPadOS **16.4+**; not in Safari tabs.
- Permission must be requested from a user gesture inside the installed app.
- **No silent push**: every push must show a notification.
- **Declarative Web Push** (iOS/iPadOS 18.4+) shows notifications described in the payload without service-worker code — more reliable; SW path kept as fallback.
- Badging API (`navigator.setAppBadge`) available to Home Screen apps.
- Removing the Home Screen app or revoking permission ends the subscription (server sees 404/410 and disables it).
- No background sync; push cannot be used to sync data silently.
- A push subscription belongs to the app's origin: moving from workers.dev to a custom domain requires re-subscribing (§18).

### Recommendation
- **Only important tasks** trigger push (spec §37): soil checks, treatment steps, seedling and propagation care tasks, and custom reminders the user marked important. Never photos, light profile or engagement.
- **Scheduling:** the single hourly **Cron Trigger** checks, per the user's timezone, notification time and quiet hours, which important tasks entered their window; sends **one daily digest** by default ("3 צמחים מחכים לבדיקת אדמה"), separate pushes only for urgent treatment steps. Deduplicated via `notification_log`. Task selection is a D1 query over precomputed `tasks`, keeping Worker CPU low.
- **Payload:** minimal text (optionally generic) and a deep link (`/today` or `/plant/:id`).
- **Tap** opens the right screen; badge shows open important tasks.
- **Fallback:** Today is always the source of truth. Settings shows push status per device and "שלחי התראת בדיקה".
- **Security:** VAPID private key exists only as the encrypted Worker secret `VAPID_PRIVATE_KEY` (never in D1 or any storage; provisioning in §13); payloads are encrypted end-to-end to the device.
- **Cost:** free.
- **Rejected:** third-party push providers. **Why:** extra accounts, tracking SDKs, data sharing.
- **Rejected:** email/SMS reminders. **Why:** out of product tone; extra services.

---

## 15. External plant and weather data

### Weather (open decision #11)
- **Recommendation:** **Open-Meteo** forecast API, called from the Worker once or twice daily for the user's region (cached in D1), used only in the background: move soil checks, cold/heat context for outdoor/balcony plants, sowing timing.
- **Reason:** free, no API key, good coverage including Israel.
- **Limitations:** free for **non-commercial** use with fair-use limits (fine for a personal app; re-evaluate if ever commercialized). No SLA → failure only means no adjustment.
- **Privacy:** rounded city coordinates only.
- **Cost:** free.
- **Rejected:** OpenWeatherMap (key required, lower quota); Apple WeatherKit REST (paid Apple Developer membership); Israel Meteorological Service open data (Israel-only API — possible later enhancement).

### General plant database (open decision #10)
There is no free, reliable, openly licensed **care** database with Hebrew names. Names and taxonomy are openly available; care and pet-toxicity data are not reliably available as open structured data.

**Recommendation: Leafling's own species catalog in D1 with per-fact provenance, enriched on demand:**
1. **Names & taxonomy:** GBIF Backbone / World Flora Online (accepted names, synonyms) and **Wikidata** (CC0; Hebrew labels/aliases). Queried from the Worker when a searched species is not yet in the catalog; stored with source IDs.
2. **Care profile:** drafted by Claude (`species-profile-draft`) as structured facts, **each stored as `ai_unverified`** and shown with a subtle "מידע כללי — לא אומת" marker until verified.
3. **Pet safety:** shown as verified only with a cited reputable source (e.g., ASPCA plant pages, veterinary/poison-control references); otherwise the UI says safety is **not verified** and never asserts safety. No airborne claims without a cited basis (spec §16).
4. **Verification:** the owner can mark facts verified with a source; a reviewed seed set for owned/wishlist species in Phase 6. Manufacturer fertilizer instructions are authoritative and stored verbatim.
5. **Identification from photos:** Claude vision with alternatives and explicit confidence (spec §15).
6. **Pl@ntNet — not in version 1.** Kept as a possible future optional second-opinion integration (it would need an API key, a secret and owner approval).

- **Provenance fields per fact:** `source_type` (`curated`, `open_db`, `ai_unverified`, `user_verified`, `manufacturer`, `professional`), `source_ref`, `license`, `retrieved_at`, `verified_at`, `confidence`.
- **Privacy:** only species names/IDs leave the system.
- **Cost:** open sources free; Claude drafts cost a few cents per new species, once.
- **Rejected:** Perenual / Trefle as primary source. **Why:** restrictive licenses/quotas, uneven quality, stability concerns, no Hebrew. iNaturalist API: good names but restrictive terms for app backends.

---

## 16. Backup, restore and disaster recovery

Goal: practical, free, and simple for version 1. Essential recovery is required before real data is entered; advanced automation is optional.

### Essential recovery (version 1, required, US$0)
| # | Mechanism | What it protects against |
|---|---|---|
| E1 | **D1 Time Travel** — automatic point-in-time restore, **7 days on the Free plan** (no setup, no cost) | Bugs, bad migrations, accidental mass changes discovered within a week |
| E2 | **Pre-migration bookmark** — every production deploy that contains a migration first records the current Time Travel bookmark in the deploy log | One-step rollback of a bad migration |
| E3 | **On-demand full data export** — Settings → "ייצוא גיבוי": the app downloads all structured data from D1 through small paginated API calls (each within Free-plan limits), assembles one JSON file on the phone and saves it to Files / iCloud Drive. Settings shows the last export date calmly (no nagging, no push) | Loss beyond 7 days, Cloudflare account problems, independent copy owned by the user |
| E3b | **On-demand original-photo export** — Settings → "ייצוא תמונות מקור": originals exported **by year**, each year split into parts. **Proposed mechanism, not yet approved for implementation — subject to the Phase 0 feasibility test (P0-7):** each part is a store-only (uncompressed) ZIP streamed by the Worker from R2, using the CRC-32 and sizes recorded at upload so the Worker does not hash photo bytes. This reduces but does **not** eliminate Worker CPU (ZIP headers, stream piping per chunk), and each R2 read may count toward the per-invocation subrequest limit (50 on Free), which may cap the number of photos per part. Part size (bytes and photo count) is set only from measured results. Each ZIP contains the byte-identical originals named `YYYY-MM-DD_<photoId>.<ext>` plus `photos-index.json` (photo → plant, capture date, SHA-256, journal/case links). Saved to Files / iCloud Drive. Settings lists which years/parts were exported and offers "רק תמונות חדשות מאז הייצוא האחרון". Manual only — no schedule, no push | Loss of photos with the Cloudflare account; with E3 forms a **complete independent backup** |
| E4 | **Tested import** — the same JSON format can be imported (paginated) into an empty D1 database; exported photo ZIPs can be re-imported, verified against SHA-256 from the index | Full logical restore of data and photos |
| E5 | **Soft delete** — deleted plants, photos, locations stay in a 30-day trash | Accidental deletion in the app |
| E6 | **R2 durability for photos** — originals are write-once, never overwritten, deleted only after the 30-day trash | Photo loss through the app |
| E7 | **Restore runbook** tested once on the preview environment with synthetic data before real data is entered | Untested procedures |

**Export format:** documented JSON (per-table arrays + manifest with schema version, row counts, SHA-256) — readable without Leafling. Photos are exported separately (E3b) as standard ZIP files of unchanged originals with an index, openable on any device. A **complete independent backup = latest data export (E3) + all photo export parts (E3b)**; Settings shows whether both are up to date.

**Feasibility gate for E3b (Phase 0, P0-7):** 175 MB and 500 MB parts are **test points only**. Measured: Worker CPU time, Worker memory, subrequest count, wall time, iPhone memory behavior, download reliability (including interrupted connections) and saving to Files / iCloud Drive. **Stop rule:** if streamed ZIP generation cannot stay safely within Free-plan limits (p95 CPU < 7 ms, no CPU-limit or memory errors, subrequests < 50 with margin) or downloads/saving are unreliable, the work stops and the owner receives a proposal before any architecture change — candidate free alternatives: smaller parts (e.g., ≤ 25–40 photos / ≤ 100 MB), per-photo downloads saved via the iOS share sheet ("Save to Files") in small batches without ZIP, or ZIP assembly on the iPhone in small batches. The requirement itself (a complete, manual, independent export of original photos to Files/iCloud Drive) is fixed; only the mechanism may change.

**Restore procedures (runbooks):**
- *Undo recent damage (≤ 7 days):* `wrangler d1 time-travel restore` to a timestamp or the pre-migration bookmark — run from Cloudflare Workers Builds/CI or the dashboard; no personal computer required.
- *Full logical restore:* create an empty D1 database, apply migrations to the export's schema version, import the JSON file from the app, verify counts/checksums, switch binding, deploy.
- *Photo restore:* import the photo ZIP parts; each original is re-uploaded unchanged to R2 and verified against its SHA-256; display/thumb copies are regenerated on the phone.
- *Client recovery:* "סנכרון מחדש מהשרת" (after pushing pending changes).
- *Bad deploy:* instant rollback to the previous Worker version.
- *Lost phone:* data is in D1/R2; revoke Access sessions.

**Targets (v1):** RPO — seconds for synced data within 7 days (Time Travel); beyond that, the date of the last user data/photo export. RTO ≤ 1 hour for data; photo restore time depends on the number of parts.

### Optional advanced backup automation (not required for version 1)
Added only if the owner wants them and they remain free and simple:
| # | Option | Cost / complexity |
|---|---|---|
| O1 | Scheduled logical backup to a private R2 bucket (weekly or nightly), produced by a scheduled GitHub Actions job running `wrangler d1 export` and uploading to R2 (data passes through the runner's memory only; needs a narrowly scoped Cloudflare API token as a GitHub secret) — or by the Worker cron if Free-plan CPU allows | Free within quotas; adds a token and a workflow |
| O3 | Photo mirror to a second R2 bucket | Storage cost beyond 10 GB free; more subrequests |
| O4 | Automated restore verification (monthly import into a scratch database) | Free but more moving parts |
| O5 | 30-day Time Travel | Requires Workers Paid (US$5/month) |

- **Rejected:** mandatory nightly duplicate copies and monthly automated restore tests in v1. **Why:** owner direction; E1–E7 (including E3b) give practical, complete recovery at no cost and with little code.
- **Rejected:** data-only export as the independent backup. **Why:** a structured-data export without photos is not a complete independent backup (owner direction).
- **Rejected:** storing backups in the Git repository or CI artifacts. **Why:** personal data in source control/CI storage.

---

## 17. GitHub and Cloudflare deployment workflow

### Recommendation: Cloudflare **Workers Builds** connected to the private GitHub repo; GitHub Actions for checks
1. Pull request / branch push → **GitHub Actions**: typecheck, lint (incl. logical-CSS and no-body-logging rules), unit tests, Worker integration tests (local `workerd` with D1/R2), migration tests, build, Playwright WebKit smoke. No secrets.
2. Non-production branches → Workers Builds deploys the separate **`leafling-preview`** Worker with preview-only D1/R2/secrets (mock AI by default), on its own workers.dev URL, protected by Access.
3. Merge to `main` → production deploy command: record Time Travel bookmark → `wrangler d1 migrations apply leafling-prod --remote` → `wrangler deploy`.
4. Rollback: Worker versions allow instant code rollback; data via Time Travel.
5. Branch protection on `main` (required checks).

- **Reason:** no personal computer in deployment; no Cloudflare API token in GitHub; native preview builds.
- **Limitations:** Workers Builds build-minute quota on Free (confirm at setup; single-developer usage is small). Migrations run before new code is live → expand/contract, backward-compatible migrations only.
- **Security:** deployment credentials stay in Cloudflare; private repo with secret scanning.
- **Cost:** free at this volume.
- **Rejected:** GitHub Actions deploy with a Cloudflare API token. **Why:** stores a powerful token in GitHub; kept as fallback.
- **Rejected:** Cloudflare Pages Git integration. **Why:** see below.

### Cloudflare Pages vs Workers
- **Recommendation:** Workers with Static Assets.
- **Reason:** one deployable for SPA + API + **Cron Triggers** (notifications, purge) + Rate Limiting + gradual deployments + observability + Vite plugin — listed by Cloudflare as Workers-only features.
- **Limitations:** Static Assets on Free: 20,000 files per version, 25 MiB per file — far above needs.
- **Rejected:** Pages (+ Functions). **Why:** would need a second Worker for cron anyway; Pages-only features (branch aliases, file-based routing, custom domains outside Cloudflare zones) are not needed.

---

## 18. Development, preview and production environments

| Environment | Where | Data | AI | Auth |
|---|---|---|---|---|
| Local dev | Vite + `@cloudflare/vite-plugin` running the Worker in `workerd` with local D1/R2. Works in any dev environment including cloud sessions. | Synthetic seed data (e.g., 300 plants, 20k events) | Mock by default | Access bypassed locally; JWT check uses a dev test key |
| Preview | `leafling-preview.<account>.workers.dev`, D1 `leafling-preview`, R2 `leafling-preview-photos` | Synthetic only — **never production data** | Mock by default; preview Anthropic workspace with tiny limit when enabled | Access (owner policy) |
| Production | `leafling.<account>.workers.dev` (Workers Free) | Real data | Production Anthropic workspace with spend limit | Access (email one-time code) + JWT |

- Production and preview never share bindings. Version-preview URLs of the production Worker use production bindings, so they are not used for schema changes; branch previews go to the separate preview Worker.
- **Address — approved: start on workers.dev.** Limitation: a PWA's install, local storage and push subscription are tied to its origin.

### Moving to a custom domain later (runbook, when the owner decides)
1. Add the domain/zone to Cloudflare, attach it to the Worker, create/extend the Access application for it.
2. In the old installed app: confirm the pending-change queue is empty ("הכול מסונכרן") and optionally export.
3. Install the app from the new domain, sign in, full sync from D1, re-enable push.
4. Remove the old Home Screen icon; after a grace period, redirect/disable the workers.dev route.
No data migration is needed because D1 and R2 are the source of truth.

---

## 19. Testing strategy

| Layer | Tooling | Focus |
|---|---|---|
| Domain unit tests | Vitest | Naming (#2/#3, never #1, no reuse), soil-check state machine (only "yes" creates watering), dry-down learning & weighting, pattern threshold (≥ 3), confidence clamping, fertilizer windows, groups (split/thin/partial success, inherited history), lineage, cascade/retention, treatment conflicts, suggestions never overdue, status never auto-changed |
| Schema/contract | Vitest + Zod | Event payload versions, mutations, AI outputs, export format |
| Worker integration | `@cloudflare/vitest-pool-workers` | Sync idempotency, atomic batches, **server-revision ordering (skewed/incorrect client clocks never change the outcome)**, **conflict records always written and restorable**, rejected mutations retained, JWT rejection, R2 checksum mismatch, overwrite refusal, budget/rate-limit stops |
| Free-plan budget tests | Worker integration + preview measurements | CPU time and D1 query count per endpoint (sync batch, pull page, AI with images, push digest, export page, purge) stay under Free limits with margin |
| Migrations | Vitest | Apply all to empty DB; upgrade from each previous snapshot; data export → import round-trip equality; photo ZIP export → import byte equality (SHA-256) |
| AI | Mocked Anthropic client | **Context isolation**, context size budget, proposals never auto-applied, malformed output, confidence clamps. Small manual evaluation set run on demand (not CI) |
| Offline/sync | Vitest + fake-indexeddb; Playwright network toggling | Offline writes survive reload/app close; queue drains; **auth-expiry flow keeps the queue**; resync never wipes pending changes |
| E2E | Playwright WebKit, iPhone viewport, `he-IL` | Critical flows per phase, RTL snapshots, exactly 5 tabs, floating + with exactly 2 actions |
| Accessibility | axe-core | Contrast, labels, tap targets, non-color-only meaning |
| Performance | Seeded large dataset | Virtualized lists; Today renders < 1 s from local copy |
| Real device checklist | Owner's iPhone per phase | Install, Access sign-in/re-sign-in, push, camera/gallery/EXIF, offline, safe areas, Dark Mode |

---

## 20. Monitoring and error handling

- **Workers Logs** with structured JSON (request id, route, status, latency, error code, CPU-limit errors) — no bodies or personal content.
- **Client errors:** sanitized (message, stack, route, version) sent to `/api/client-errors`, kept 30 days in D1. No third-party error tracker.
- **Health panel in Settings:** last sync, pending changes, pending photo uploads, unresolved conflicts / rejected changes, last data export, last photo export, push status, AI budget used this month, device storage used.
- **Cron results** recorded in D1; failures shown as an in-app banner (no push).
- **Error UX:** every network/AI action has loading, failure and retry states in calm Hebrew; no silent failures, no guilt wording.
- **Free-plan limit watch:** logs and Cloudflare dashboard metrics are reviewed against the §21 triggers.
- Rejected: Sentry/Datadog. **Why:** cost and third-party access to personal context.

---

## 21. Cost estimate and service limits

### Plan decision: start on Workers Free
Version 1 runs on **Workers Free + Zero Trust Free + R2 free tier**. The design keeps each request small so Free limits are respected:
- sync pushes/pulls in small paginated batches;
- photos streamed to/from R2 (no buffering, no Worker hashing — R2 checksum);
- thumbnails made on the phone;
- data export assembled on the phone from paginated calls;
- one consolidated hourly cron (well under the 5-cron limit), task selection done in SQL;
- no server-side scheduled full-database backup in v1.

### Free-plan limits relevant to Leafling (checked 2026-09-27)
| Limit | Workers Free | Leafling expectation |
|---|---|---|
| Worker requests | 100,000/day | < 2,000/day |
| Worker CPU per invocation | **10 ms** | Most requests ≪ 10 ms (I/O waiting is not CPU); AI-with-images and push encryption measured in Phase 0 |
| Subrequests per invocation | 50 | Small batches |
| Cron Triggers | 5 per account | 1 |
| Isolate memory | 128 MB | Streaming only |
| Request body | 100 MB | Photos only |
| Static assets | 20,000 files/version, 25 MiB/file | Hundreds of files |
| D1 database size | 500 MB (5 GB per account) | < 100 MB for years (text only; photos in R2) |
| D1 rows read / written | 5 M/day / 100 k/day | Thousands/day |
| D1 queries per invocation | 50 | Sync batches sized accordingly |
| D1 Time Travel | 7 days | Essential backup E1 |
| D1 bound params / statement | 100 / 100 KB | Batch sizing |
| R2 storage | 10 GB-month free, then US$0.015/GB-month | 5–20 GB over years |
| R2 operations | 1 M Class A / 10 M Class B per month free | Tiny |
| R2 egress | Free | — |
| Zero Trust (Access) | Free up to 50 users | 1 user |

### Upgrade triggers — Workers Paid (US$5/month) only if one of these is proven
An upgrade is justified only by a **measured** limitation that cannot be fixed by reasonable design changes (smaller batches, pagination, smaller images, moving work to the phone):
| ID | Trigger (exact) | How it is measured | Mitigations tried first |
|---|---|---|---|
| T1 | A required request type repeatedly fails with **"Worker exceeded CPU time limit"** (error 1102 / `exceededCpu`) at the 10 ms Free limit — e.g., AI request with the allowed images, push digest encryption, sync batch — in Phase 0 measurements or in production logs (more than occasional, e.g., > 1 % of that route's requests over 7 days) | Workers Logs CPU time / outcome, preview load tests | Smaller batches; smaller/fewer AI images; forward pre-encoded images; move work to the client |
| T2 | A required operation needs **> 50 D1 queries or > 50 subrequests in one invocation** and cannot be split into multiple calls | Integration tests / logs | Pagination, multi-call flows |
| T3 | **D1 database size exceeds 400 MB** (80 % of the 500 MB Free maximum) | D1 dashboard | Purge trash, trim operational logs (client errors, AI metadata) |
| T4 | **D1 rows written > 80,000/day or rows read > 4 M/day** on 3+ days in a month | D1 analytics | Query/index tuning |
| T5 | Worker requests **> 80,000/day** on 3+ days | Workers analytics | Reduce polling / image requests |
| T6 | The owner decides 7-day Time Travel is insufficient and wants **30 days** (or a server-side scheduled backup that cannot fit Free CPU) | Owner decision | Regular user exports (E3); optional O1 via GitHub Actions |

When a trigger is hit: record the evidence in `PROJECT_STATE.md`, ask the owner, then upgrade (a plan change — no code or data migration).

### Monthly cost estimate (version 1)
| Item | Estimate |
|---|---|
| Workers Free, D1, Access (Zero Trust Free) | US$0 |
| R2 photos | US$0 up to 10 GB, then ≈ US$0.015/GB (≈ US$0.15 at 20 GB) |
| Open-Meteo, GBIF/WFO/Wikidata | US$0 |
| GitHub private repo + Actions | US$0 |
| workers.dev address | US$0 |
| **Claude API** (variable) | see below |

**Claude API (Sonnet 5 at US$2/M input, US$10/M output; Haiku 4.5 at US$1/US$5):**
- Botanist question with context (~4k input incl. cached prompt, ~700 output): ≈ US$0.015.
- Diagnose with 3 images (~4.5k image tokens + ~4k context, ~1.2k output) + Haiku pre-check: ≈ US$0.03–0.04.
- Moderate use (~10 AI requests/day, a third with images): ≈ US$5–10/month. Light use: ≈ US$1–3.
- Approved hard cap: **US$10/month**, enforced by the Anthropic console limit and Leafling's budget counter.

**Expected total for version 1: US$0 infrastructure + Claude usage (≈ US$1–10/month, capped at US$10).** Possible later: Workers Paid US$5/month (only via T1–T6), custom domain ≈ US$10–15/year.

---

## 22. Phased implementation roadmap

Dependency-aware; each phase ends with a complete, tested vertical slice on the owner's iPhone. No screen is built before the persistence and shared domain behavior it depends on.

**Pre-implementation gate (before Phase 0):** `PRODUCT_SPEC.md`, `ARCHITECTURE.md` and `PROJECT_STATE.md` are committed in the repository; ARCHITECTURE.md is explicitly approved.

**Phase 0 — Platform validation spikes (throwaway, preview resources, Free plan)**
- Access with **email one-time code** in the **installed** iPhone PWA: first sign-in, session expiry, re-sign-in while changes are pending.
- Web Push from a Worker to the installed PWA (standard + Declarative Web Push).
- Photo picker: camera vs gallery, HEIC/JPEG, EXIF date availability, copy generation speed.
- IndexedDB persistence (`storage.persist()`), queue survival after closing the app.
- **Free-plan CPU measurements:** AI request with 1–4 images, push encryption, sync batch sizes, export page size (inputs to T1/T2).
- **Photo export feasibility (E3b):** streamed ZIP at 175 MB and 500 MB test points — Worker CPU, memory, subrequests; iPhone memory behavior; download reliability; saving to Files/iCloud Drive; stop rule in §16.
- **VAPID provisioning:** browser-side key generation page; private key entered only as the encrypted Worker secret.
- Light-meter feasibility (camera relative-brightness experiment).
Exit: findings appended to ARCHITECTURE.md; any failed spike escalated to the owner.

**Phase 1 — Foundation**
Commit the original icon unchanged to `assets/brand/`; generate approved icon derivatives (crop to inner tile). Repo scaffold; Worker + static assets on workers.dev; Access + JWT; D1 first migrations (profile, species, plants, events, photos, locations, tasks, sync/conflict tables, change log); R2 bucket; CI; preview + production; app shell with RTL tokens, light/warm-dark themes, exact 5-tab navigation and floating + (its two entries lead to real screens only once built — no fake data); PWA manifest + icons. **Essential recovery E1, E2, E5 active and restore runbook drafted before any real data.**

**Phase 2 — Core domain, sync and first vertical slice: "My Plants"**
Local copy + pending-change queue + sync + conflict records; minimal species catalog; naming rule; locations; add-plant flow (photo/skip, status, nickname, location, status questions, "+ פרטים נוספים"); My Plants tabs/search/filter/sort; plant card header; edit/archive/delete with trash; History tab; photo pipeline (originals, copies, private delivery, gallery, fullscreen, set main, delete); onboarding (skippable) + Settings basics; **data export (E3), original-photo export (E3b) and import (E4), restore drill on preview (E7)**. Real data entry begins only after this phase.

**Phase 3 — Today, soil-check watering, care plan and Journal**
Tasks from shared domain; soil-check flow; dry-down learning v1 with confidence; Care Plan; complete/postpone; "לא דורשים טיפול היום — N צמחים"; custom reminders; empty states; Journal (notes, photos, milestones), photo suggestions, Compare and Timelapse (display copies).

**Phase 4 — Notifications**
Opt-in push, hourly cron digest, quiet hours, badge, deep links, device status + test notification.

**Phase 5 — AI foundation + AI Botanist**
Claude proxy, secrets, budgets, rate limits, metadata logging, context builder + isolation tests, structured outputs, uncertainty rendering, proposal/confirm cards; AI Botanist from plant card and floating +, multiple images.

**Phase 6 — Find Plant, identification, species pages, Wishlist, weather**
Species search (Hebrew/common/scientific/aliases); Claude photo identification with alternatives; General Plant Page tabs backed by provenance-tagged facts; pet-safety rules; add-to-my-plants; Wishlist + "🌱 קניתי את הצמח!"; Open-Meteo background adjustments.

**Phase 7 — Diagnose and Health**
Guided photos, quality pre-check, symptoms and follow-ups, results, contagious suspicion → app-side neighbor list, health cases, treatments → Today tasks, recovery checks, conflict warnings, professional diagnosis, past cases.

**Phase 8 — Seedlings, propagation and Plant Family**
Seed batches, stages, thinning, separation with inherited history, transplant checklist, summaries; propagation records and outcomes; lineage and "🌳 משפחת הצמח".

**Phase 9 — Fertilizing, Locations & light**
Fertilizer windows, My Fertilizers (label read, manufacturer authoritative), Fertilizer Calculator; location light history/profile, "האם צמח יתאים לכאן?", Light Meter per Phase 0 findings.

**Phase 10 — Remaining tools**
Watering Assistant, Pot Size, Sowing, Propagation, Repotting Guide (optional root-ball AI), Pest Identification, "מה זה הדבר הזה?", Soil Mix Builder.

**Phase 11 — Hardening**
Large-dataset performance, Free-plan limit review (T1–T6), full restore drill, accessibility pass, security review, copy/tone review, real-device regression. Optional backup automation (O1, O3, O4) only if the owner requests it.

---

## 23. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Access sign-in does not complete cleanly inside the installed PWA | Medium / High | Phase 0 spike; one-time code; long session; queue preserves data during re-sign-in; passkey contingency (owner approval) |
| Free-plan 10 ms CPU limit hit by AI-with-images or push | Medium / Medium | Phase 0 measurement; pre-encoded small images; batch sizing; documented upgrade trigger T1 |
| iOS push unreliable or permission lost | Medium / Medium | Today authoritative; Declarative Web Push; device status + test |
| iOS evicts local storage / user deletes the Home Screen app with unsynced data | Low / High | `storage.persist()`; aggressive sync; visible pending count; D1 source of truth |
| No background sync on iOS | Certain / Low | Sync on open/foreground/online |
| Only 7 days of Time Travel on Free | Certain / Medium | Pre-migration bookmarks; user export E3; trigger T6 |
| User rarely exports → older recovery point | Medium / Medium | Last data/photo export dates visible in Settings (calm, no push); incremental "new photos only" export; optional O1 |
| Incorrect iPhone clock | Medium / Low | Server revisions / receipt order decide; client time is metadata only |
| Streamed photo ZIP exceeds Free limits or large downloads fail in the installed PWA | Medium / Medium | Phase 0 feasibility test with stop rule (§16); smaller parts; share-sheet or on-phone batch alternatives proposed to owner |
| VAPID private key exposure | Low / Medium | Worker secret only; browser-side generation; never stored in any database |
| Origin change (workers.dev → custom domain) | Planned / Low | §18 runbook; D1 is source of truth |
| AI-hallucinated care or toxicity info | Medium / High | Provenance; unverified marker; cited pet safety; explicit uncertainty; no auto-mutation |
| Claude cost overrun | Low / Medium | Console limit + app budget + rate limit + caps |
| Buggy migration | Low / High | Expand/contract, upgrade tests, pre-migration bookmark, Time Travel |
| Preview touching production data | Low / High | Separate Worker and bindings |
| D1 lacks interactive transactions | Certain / Low | Atomic `batch()`; idempotent mutations |
| Cloudflare account lockout | Very low / High | User-held exports (E3) |
| Plant data licensing | Medium / Low | Prefer CC0/CC-BY; license stored per fact/image |
| Missing photo metadata | Medium / Low | Spec fallback (today/date/unknown) |
| Light meter cannot produce real lux | High / Low | Never fake lux (§24) |
| Scope creep | Medium / Medium | Spec invariants as tests; owner-gated phases |

---

## 24. Decisions

All decisions below are **approved by the owner (2026-09-27)**. Changes require a new owner decision recorded here.

### Approved — architecture review
1. Cloudflare **Free plan** for version 1; Workers Paid only on a measured trigger (§21 T1–T6). No paid resources without owner approval.
2. **workers.dev** address initially; custom domain later (§18 runbook).
3. Source-of-truth model: D1 durable source of truth; IndexedDB offline copy + pending queue; unsynced changes survive app close and auth expiry (§10).
4. **Conflict ordering:** `baseRev` + server-assigned revision / server receipt order; device clocks never authoritative (metadata only); every overwritten value preserved and restorable (§10).
5. Practical low-cost backups: essential recovery E1–E7 in v1, **including on-demand original-photo export (E3b)**; scheduled duplicates and automated restore tests optional (§16).
6. **Pl@ntNet not in version 1** (future optional integration).
7. **Email one-time-code** authentication via Cloudflare Access.
8. Timelapse and Compare use **uncropped display-size copies** of the originals.
9. **Journal video excluded** from version 1.
10. **Icon:** derived iPhone/PWA icons crop to the inner cream tile of the supplied icon (no redesign); the original is preserved unchanged.
11. `PRODUCT_SPEC.md` committed to the repository.
12. **Frontend stack** (open decision #1): React + Vite + TypeScript SPA, Tailwind logical utilities, Radix, Dexie, Workbox.
13. **Code architecture** (#2): single Worker with static assets + Hono API + one cron; shared pure domain module; local-first client.
14. **Cloudflare services** (#3): Workers (not Pages), D1, R2, Access — on Free.
15. **Data schema** (#5): event log + current state (§7–8); naming ordinals — first plant unnumbered, then #2/#3, never reused.
16. **Sync** (#6): full structured-data sync; field-level server-ordered resolution with recorded, restorable conflicts.
17. **Backup specifics** (#7): E1–E7 as defined; failures shown in-app only.
18. **Notifications** (#8): daily digest by default, separate push only for urgent treatment steps; user-chosen time and quiet hours.
19. **Light Meter** (#9): no numeric lux from the camera; guided questionnaire → light category, manual lux entry, optional clearly-approximate camera indicator; final form after Phase 0.
20. **Plant data & provenance** (#10): own D1 catalog; GBIF/WFO/Wikidata names; AI-drafted care marked unverified; pet safety verified only with a cited source.
21. **Weather** (#11): Open-Meteo (non-commercial terms).
22. **Archive/Delete** (#12): archive reversible; 30-day trash then purge; lineage tombstones.
23. **Manual drag sorting** (#14): not in v1.
24. **Claude strategy** (#15): **Sonnet 5 and Haiku 4.5 only**, image caps, **US$10/month budget cap** (Anthropic console limit + in-app budget). **Opus not enabled in version 1** without explicit future approval.
25. **Confidence conventions** (#17): four Hebrew text levels, no percentages, server-side clamping.
26. **Export/year summary** (#18) and **statistics screen** (#19): out of scope; only backup-grade exports (E3, E3b) are built.
27. **VAPID private key** stored only as the encrypted Worker secret `VAPID_PRIVATE_KEY`, never in D1 or any storage, in every environment including Phase 0; generated in the owner's browser by an Access-protected page (§13).

### Open items to be settled during implementation (not architecture changes)
- **Photo export mechanism (E3b):** final mechanism and part size decided only after the Phase 0 feasibility test; if the streamed ZIP fails the stop rule, a free alternative is proposed to the owner for approval.
- Phase 0 findings may refine: AI image caps, sync batch sizes, Light Meter form.

### PWA / iPhone icon requirements (for implementation)
Original preserved unchanged as `assets/brand/leafling-icon-original.jpg` (supplied 1254×1254 JPEG). Approved derivation: crop to the inner cream tile (removing the outer background, tile edge and drop shadow), then scale with enough margin that the plant and the "Leafling" wordmark are not clipped by the iOS rounded mask. Derivatives are PNG with an **opaque** cream background (iOS renders transparency as black):
| File | Size | Use |
|---|---|---|
| `apple-touch-icon.png` | 180×180 | iPhone Home Screen (`<link rel="apple-touch-icon">`) |
| `icon-167.png`, `icon-152.png` | 167×167, 152×152 | iPad Home Screen (optional) |
| `icon-192.png` | 192×192 | Manifest `purpose: "any"` |
| `icon-512.png` | 512×512 | Manifest `purpose: "any"` |
| `icon-maskable-512.png` | 512×512 | Manifest `purpose: "maskable"`, key content inside the central 80 % safe zone |
| `favicon-32.png` | 32×32 | Browser tab |
| `apple-touch-startup-image` set (optional) | Current iPhone screen sizes | Launch screen on the cream background |
Checks: preview at 180 px (60 pt) and Spotlight size (40 pt); the wordmark must stay legible at 180 px and nothing may touch the mask corners. Manifest: `name: "Leafling"`, `short_name: "Leafling"`, `display: "standalone"`, `lang: "he"`, `dir: "rtl"`, `start_url: "/today"`, `scope: "/"`, `theme_color` / `background_color` from the cream/green tokens.

---

## Implementation notes (2026-10-02)
Recorded deviations/details, all within the approved decisions:
- Sync uses one generic record store (`app_records`: entity + id + JSON data + per-field server revisions) instead of one table per entity; ordering is by server revision / receipt order, conflicts go to `app_conflicts` and are restorable (§10).
- Service worker is a small build-generated script (per-build cache id, old caches deleted) instead of Workbox; same behaviour as §10.
- Until production resources are approved, the app is hosted by the preview Worker (`spikes/phase0/wrangler.jsonc` builds the repo-root app into `dist/`); the Phase 0 harness moved to `/phase0/`. D1 changes are additive (`migrations/0001_app_records.sql`).
- Illustrations are crops of the owner-supplied design references; species photos are labelled species images.

## Multi-user isolation (2026-10-02, owner request)
Leafling now serves **three independent users**, each with a completely private environment. This is **not** a shared collection. It supersedes the "single user / one authorized address" parts of §1 and §6; everything else (Access, Free plan, one Worker, one D1, one R2 bucket, local-first sync) is unchanged. Full model, threat list, tests and recovery: **`docs/security/MULTI_USER.md`**.
- **Identity:** Cloudflare Access (one-time PIN) decides who may sign in. The Worker verifies the Access JWT (RS256 signature against the team certs, `aud`, `iss`, `exp`, `nbf`, `type=app`) and keys each person by the verified **`sub`** (not the email) → internal `app_users.id` (UUID). The browser never supplies an owner, user id or email that the server trusts.
- **Ownership in D1:** every personal row carries `user_id` in owner-scoped tables (`user_records`, `user_changes`, `user_mutations`, `user_conflicts`, `user_ai_usage`) whose keys start with `user_id`; every query binds the verified user id. Revisions, mutation ids and conflicts are per user. Species knowledge stays global (bundled catalog).
- **R2:** `users/{userId}/photos/{photoId}/{variant}`, built server-side from a validated UUID + fixed variant. Photos uploaded before multi-user (`app/photos/…`) are readable only by the claimed original owner. Responses are `private, no-cache` so a shared device's HTTP cache can't serve one user's photo to another.
- **Migration:** additive and atomic (`migrations/0002_user_ownership.sql`, applied by the Worker). v1 rows are copied under a placeholder owner visible to nobody; the v1 tables remain as an in-database backup. The data is handed once, atomically, to the verified identity whose email equals `OWNER_EMAIL` (the only identity the v1 app ever accepted) — never to whoever signs in first.
- **Device:** one IndexedDB database per user (`leafling-u-{userId}`: records, outbox, blobs, sync cursor). Every API call carries `X-Leafling-User` (the local database's owner); a mismatch with the signed-in identity is refused (409) and the app restarts as the new user, so one user's queued changes can never be uploaded under another. The pre-multi-user local database is imported only for the original owner.
- **AI:** context is built server-side only from the caller's records; budget is one shared monthly cap, rate limit per user.

## Product corrections (2026-10-02, owner request after iPhone testing)
- **Light Meter (supersedes §15's three methods):** iPhone browsers expose no ambient-light sensor or camera exposure controls, so the only real signal is the EXIF exposure (time, f-number, ISO) of a photo taken in the plant's spot. `src/shared/light.ts` turns it into one of four categories (אור חלש / בינוני / חזק / שמש ישירה) with E ≈ 250·N²/(t·S); never shown as lux, always stored and sent to AI as an estimate (`estimate: true`, `method`). No questionnaire, manual lux or relative meter in the UI; older readings still display. A reading links to a plant and/or location; the location's light profile is the median of its readings.
- **Light Meter, live camera (2026-10-02, supersedes the photo/EXIF Light Meter above):** the owner rejected the native photo flow. The meter is a live rear-camera preview inside Leafling (`getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })` → muted, `playsinline` `<video>`; HTTPS + `Permissions-Policy: camera=(self)`). "מדדי אור" waits ≥1 s for auto-exposure to settle, samples 12 frames over ≈1.4 s into a 64×48 in-memory canvas, keeps only three numbers per frame (mean luma, 95th percentile, clipped share) and then stops the stream. No frame is stored, uploaded, or added to photos, journal, timelapse or R2. **What browsers expose:** iPhone Safari/PWA gives auto-exposed, tone-mapped frames only (no ImageCapture, no exposure time/ISO/aperture, no exposure lock); Chromium's exposure properties are meaningful only in manual mode and device-dependent. So pixel brightness is not illuminance. The camera decides one thing by itself: frames still dark at the camera's sensitivity limit → "אור חלש" (`method: "camera_live_dark"`, estimate). Otherwise the result says honestly that the camera cannot tell, and the user names the light she sees with the hand-shadow test as a guide (`"camera_live_user"`, her estimate). Clipped bright areas are only a hint, never "direct sun". Brightness jumping between frames → "measure again". Camera lifecycle: started on screen open, released on leave/unmount, page hidden/pagehide, track `ended` and after measuring; permission denied / no camera / busy / unsupported each get a Hebrew explanation, never a fallback to photo capture. Saved as ONE `light` record linked to the chosen plant and the measured location (the entry location, else the plant's own location); the location profile stays the median; the AI receives these as estimates (`src/worker/ai.ts`), never as lux. Plant identification keeps its photo attachments (separate feature). Only verified in headless Chromium so far, not on a real iPhone.
- **AI Botanist chat (2026-10-02, owner request; supersedes the one-question "report" Botanist):** a messaging-style conversation per plant (or a general one). `POST /api/v1/chat` streams the answer as Server-Sent Events over the authenticated fetch (Anthropic `messages.stream` → Worker → browser, no server-side buffering); `POST /api/v1/chat/stop` stops it; `GET /api/v1/chat/attachments/{msg}/{n}` serves a message's images from private R2. Conversations and messages are ordinary per-user records (`chat`, `message`) written by the server, so history syncs like everything else (IndexedDB v2 tables `chats`, `messages`) and works offline for reading. Idempotency per message id (`user_chat_runs`): a repeat is replayed, a parallel duplicate gets 409, a failed/stopped one may be retried and overwrites its own answer (`{msgId}-a`) — never a second answer. Stop → the text so far is stored as `status: "partial"`; a dropped connection does not stop the answer (writes never block generation; it is stored complete). Model: Sonnet 5 (approved), streaming, thinking off and effort low for chat (fast first token, short answers), max 1024 tokens; identify/diagnose keep the structured JSON output. Context (`src/worker/ai-context.ts`): one D1 batch (1 round trip instead of 6), question-aware sections (watering → waterings, soil checks, pot/substrate, observed days between waterings; propagation → root checks and propagation fields; health → diagnoses, treatments, recent changes), last 8 messages verbatim + a short list of earlier questions; images only when attached to the current message or when the question is explicitly about a photo (then the plant's latest display copy). Measured on a 60-event plant: context 55–63 % smaller. Timings (metadata only) are stored in `user_ai_usage` (schema v3, additive) and reported by `verify:live`.
- **Identification → My Plants (2026-10-02):** the ORIGINAL files of an identification are handed to "add to my plants" in memory only; on save they go through the normal photo pipeline (byte-identical original → IndexedDB → R2 `users/{uid}/photos/…`, display/thumb copies), the first one as main photo, identical files once. Leaving without saving stores nothing.
- **Removed standalone tools (2026-10-02):** pest identification, "what is this?" and the substrate-mix builder. Diagnose identifies pests; AI Botanist answers pest and substrate questions.
- **General plant catalog (2026-10-02):** data packs in `public/catalog/` (index + `plants-core-v1.json`, 286 entries: aroids, prayer plants, ficus, dracaena/sansevieria, hoya, peperomia, begonia, orchids, ferns, palms, succulents/cacti, herbs, vegetables, fruit, flowers, bulbs; species and cultivars with Hebrew/English/scientific names and synonyms). Loaded lazily at runtime, validated entry by entry (`src/shared/catalog.ts`), cached by the service worker for offline; adding species = adding entries/packs, no code change (authoring script: `scripts/catalog/build-core-pack.py`). Honest provenance: editorial draft from general horticultural knowledge, not yet verified; unknown fields stay absent; pet toxicity only where the ASPCA list covers the plant, otherwise "unknown". No images in the pack (no unlicensed scraping): a botanical placeholder per plant group; licensed images can be added per entry (url, license, author, source). The 14 curated species remain the richest pages and are never duplicated. AI identification is matched to curated → catalog (exact, synonym/binomial, genus) and, when Leafling has no page, the AI result stays usable ("add with this name"), labelled as unverified.
- **Pets:** `Profile.pets` holds individual animals (`id`, `kind`, `name`), several per kind; toxicity is judged by kind (`src/shared/pets.ts`).
- **AI image attachments:** client sends EXIF-free downsized JPEG copies (≤1568 px, ≤4); originals untouched.

---
*End of architecture (revision 3.1, approved 2026-09-27). Work proceeds only phase by phase with owner confirmation at each gate.*
