# PROJECT_STATE.md

## Product name
**Leafling** (approved working product name)

## Product summary
Leafling is a personal, iPhone-first, Hebrew RTL Progressive Web App for managing and growing plants: personal plant collection with long-term per-plant memory, visual journal and technical history, soil-check-based watering, fertilizing, seedlings and propagation (with groups and lineage), locations and light, diagnosis and treatment tracking, a general plant database, a Wishlist, ten core grow tools, and an AI Botanist powered by the Claude API through a secure server-side layer. General species knowledge is the starting point; the plant's own history gains weight over time. AI never changes data without explicit user confirmation.
Since 2026-10-02 it serves a few independent users (the original owner + two more), each with a completely private environment — not a shared collection (`docs/security/MULTI_USER.md`).

## Current phase
Application build (frontend redesign + core app on the approved stack), running on the preview Worker. Phase 0 platform tests on the iPhone are still outstanding. Architecture review: completed (2026-09-27).

## Source-of-truth files
- `PRODUCT_SPEC.md` — product requirements; the source of truth, wins on any conflict. Committed to the repository unchanged, as supplied by the owner.
- `ARCHITECTURE.md` — technical architecture, revision 3.1 — **approved** 2026-09-27.
- `docs/phase0/PHASE0_TEST_PLAN.md` — Phase 0 test plan.
- `PROJECT_STATE.md` — this status file.
- Approved Leafling app icon (supplied product asset; must not be redesigned or replaced): square 1254×1254 JPEG supplied by the owner in the architecture-phase conversation — variegated pothos in a smiling speckled cream pot with the "Leafling" wordmark on a cream rounded tile. Not yet in the repository; to be committed unchanged as `assets/brand/leafling-icon-original.jpg` at the start of Phase 1. Optimized derivatives are created only during implementation, using the approved crop to the inner cream tile; formats, sizes and clipping checks are in `ARCHITECTURE.md` §24.

## Approved decisions already present in PRODUCT_SPEC.md
- Web app / PWA, iPhone-first, installable to the Home Screen; not native iOS; no Mac, Xcode, App Store, private Ubuntu server or always-on personal computer.
- Code in a private GitHub repository.
- Cloudflare (Pages/Workers, D1, R2, Access) is the direction to validate, not a final choice.
- One authorized user; no app-specific email/password registration. *(Owner change 2026-10-02: three independent, fully isolated users; still no app passwords — Cloudflare Access only.)*
- Reliable cloud storage with backup and restore; local cache for partial work on weak connections; AI requires internet.
- Entire UI in Hebrew, true RTL; scientific names LTR inside RTL; metric units.
- Visual language: natural, soft, warm, lightly illustrated; warm (not black) Dark Mode.
- Exactly 5 bottom tabs: היום, מצא צמח, הצמחים שלי, המיקומים שלי, כלים. Diagnose is not a tab.
- Floating + contains exactly: זיהוי צמח, AI Botanist.
- Exactly 4 personal statuses: בהשרשה, שתיל, צמח, חולה. Wishlist is separate, not a status.
- Naming: first plant has no number; then #2, #3; never #1. Nickname changes display name only.
- Soil-check watering model; no fixed watering schedule; only a confirmed "watered" creates a watering event.
- Original photos are never modified; no AI crop/align/enhance; technical thumbnails allowed; timelapse without alignment.
- Pot and substrate are optional.
- No universal root-length rule.
- Seedling/cutting groups supported; splits preserve history; no pointless dead cards.
- Explicit plant lineage.
- Treatment completion and status changes are never automatic.
- Suggestions are never overdue; tasks and suggestions are distinct.
- Notifications only for important tasks.
- Claude API via server-side layer only; API key never in the frontend.
- Minimal relevant AI context; never the whole database or unrelated plants.
- AI proposals require explicit user confirmation; AI states uncertainty (known/likely/possible/insufficient).
- Out of scope: social, feed, news, courses, ads, Plant of the Day, QR, harvest log, aggressive gamification, Photos tab, standalone Weather tool, AI image editing.
- Data export / year summary is a future nice-to-have; a general statistics screen is out of scope.

Owner decisions recorded during architecture review (all approved; full list in `ARCHITECTURE.md` §24):
- Cloudflare Free plan for version 1; Workers Paid only after a measured, documented trigger (§21 T1–T6).
- workers.dev address initially; custom domain later.
- D1 is the durable synchronized source of truth; IndexedDB is the offline copy and pending-change queue; unsynced changes survive app close and authentication expiry.
- Sync conflicts ordered by `baseRev` + server-assigned revision / server receipt order; device clocks are metadata only; every overwritten value preserved and restorable.
- Practical low-cost backups: essential recovery in v1 including on-demand structured-data export **and** on-demand original-photo export (yearly/batched ZIPs to Files/iCloud Drive); scheduled duplicates and automated restore tests optional.
- Pl@ntNet not in version 1 (future optional integration).
- Email one-time-code authentication for the initial Cloudflare Access test.
- Timelapse and Compare use uncropped display-size copies.
- Journal video excluded from version 1.
- Derived iPhone icons use the approved crop; the original icon is preserved unchanged.
- `PRODUCT_SPEC.md` committed to the repository before implementation.
- VAPID private key only as the encrypted Worker secret `VAPID_PRIVATE_KEY` — never in D1 or any storage, including Phase 0; generated in the owner's browser.
- Photo ZIP export (175 MB / 500 MB) is a Phase 0 feasibility test with a stop rule, not an approved implementation.
- Claude: Sonnet 5 and Haiku 4.5 only, US$10/month budget cap; Opus not enabled in version 1 without explicit future approval.
- All remaining recommendations in `ARCHITECTURE.md` §24 (frontend stack, code architecture, services, schema, sync, backup specifics, notifications, Light Meter, plant data provenance, Open-Meteo, archive/delete, no manual drag sorting in v1, confidence conventions, export/statistics out of scope).

## Files created during this phase
- `ARCHITECTURE.md`
- `PROJECT_STATE.md`
- `PRODUCT_SPEC.md` (committed unchanged from the owner-supplied file; not authored in this phase)
- `docs/phase0/PHASE0_TEST_PLAN.md` (Phase 0 preparation)
- `spikes/phase0/` — Phase 0 harness (now served at `/phase0/`) and the preview Worker config that also hosts the app
- App (2026-10-02): `src/app` (React PWA), `src/worker` (API `/api/v1/*`), `src/shared` (domain + species catalog), `tests/`, `migrations/0001_app_records.sql`, `public/` (assets, icons), `assets/brand/` (approved icon original + 1024 tile), `docs/design/` (design system + rendered screens)

## Architecture status
Approved (revision 3.1, 2026-09-27; includes the VAPID and photo-export security/feasibility corrections). Architecture-review phase completed.

## Implementation status
Completed and verified locally (2026-10-02):
- Design system (cream/forest-green tokens, warm dark mode, Rubik, cards/chips/sheets, soft-masked botanical decoration), approved-icon derivatives, PWA manifest + per-build service worker that clears old caches.
- Screens: Welcome; 6-step onboarding (location, pets, interests, growing places, experience, help); exact 5-tab nav + floating + (identify, AI Botanist); Today (tasks vs suggestions, soil-check flow, calm empty states); My Plants (status tabs, wishlist, sort, grid/list, favorites, archive/trash); plant card (hero, care plan, plant memory, quick actions, journal with milestones/compare/timelapse, history filters, health cases, species info); add-plant flow per spec; rooting/germination checks; Find Plant + species pages (care/propagation/safety/problems, provenance labels); My Locations (light profile from readings, "will it fit here?"); all 10 tools (8 functional locally, pest ID / "what is this" via AI); AI Botanist, identify, diagnose (server-side, single-plant context, confidence display, no silent mutations); Settings (profile, theme, sync status, data export, conflict restore, 30-day trash).
- Backend: Access-JWT check (fail closed), idempotent server-ordered sync with preserved/restorable conflicts, write-once R2 photos with R2-verified SHA-256, Claude proxy (Sonnet 5 only in app, budget + rate limit, metadata-only logs). D1 changes are additive new `app_*` tables only.
- Verification: app + worker typecheck; 16 app unit tests + 5 harness tests pass; production build OK; local combined Worker smoke test; screens rendered in Chromium at 393×852 (light/dark), no console errors.

Multi-user isolation (2026-10-02, verified locally):
- Identity = verified Access JWT `sub` → internal user (`app_users`); browser can't choose an owner. App API no longer owner-only (Access policy decides who signs in); Phase 0 harness stays owner-only.
- D1: owner-scoped `user_*` tables, every query bound to the verified user; additive atomic migration copies v1 data under an invisible placeholder and hands it once to the verified `OWNER_EMAIL` identity; v1 tables kept untouched as backup (`migrations/0002_user_ownership.sql`).
- R2: `users/{userId}/photos/…`; v1 photos readable only by the original owner; photos `private, no-cache`.
- Device: per-user IndexedDB, `X-Leafling-User` latch (no cross-user upload of queued changes), legacy local DB imported only for the owner, sign-out / delete-local-copy in Settings.
- Tests: 18 server isolation tests (real Worker in workerd, real RS256 JWTs, legacy fixture) + 8 browser tests (same device, offline queue, legacy phone DB) — all pass; details in `docs/security/MULTI_USER.md`.
- Also fixed: first service-worker install no longer reloads the page; a new device waits for the first pull before showing onboarding.

Product fixes from real iPhone testing (2026-10-02, verified in desktop Chromium with iPhone viewport emulation — not on a real iPhone):
- Identification photos: shared `PhotoPicker` (camera and library work independently, ≤4 images, decoded preview per image, individual removal, Hebrew errors, never silent). Root cause of the missing previews: the old picker read the live `FileList` lazily after the input was reset. AI receives EXIF/GPS-free downsized JPEG copies; originals untouched.
- AI: code path is correct (`/api/v1/ai` → Worker → `claude-sonnet-5`); "AI not configured" means the Worker secret `ANTHROPIC_API_KEY` is absent on `leafling-preview` (one Worker serves everything; there is no separate production Worker).
- Light Meter: one flow (aim → "מדדי אור" → category → "שייכי לצמח" → save). Estimate from the photo's EXIF exposure (iPhone browsers have no light sensor API); only four categories, always labelled as an estimate, no lux, no scores. Photo without exposure data → honest message + user-chosen category saved as the user's estimate. Saved once, linked to the plant and its location (location profile = median); shown on the plant page; sent to the AI as an estimate.
- Pets: any number per kind (`PetEntry.id`), shared editor in onboarding + Settings; old one-per-kind profiles read without rewriting; safety warning names every affected pet by kind ("לא בטוח למיקאסה ולבייליס"); AI gets pet kinds + counts only.
- Tests: 50 unit/integration (incl. 23 server isolation) + 24 browser tests, all passing.

Light Meter as a live in-app camera (2026-10-02, owner feedback: the native photo flow was rejected):
- כלים → מד אור shows a live rear-camera preview inside Leafling (getUserMedia → muted inline video), "מדדי אור" samples ≈1.4 s of frames in memory and releases the camera; no photo is taken, stored or uploaded (not in photos, journal, timelapse or R2).
- Honest result: iPhone Safari exposes no exposure/ISO on a live stream and frames are auto-exposed, so the camera itself only concludes "אור חלש" when it stays dark at its sensitivity limit; otherwise it says it can't tell and the user names the light (hand-shadow test), saved as her estimate. No lux, no automatic "direct sun".
- "שייכי לצמח" → only the user's own plants; saved once to the plant and the measured location (location profile = median); AI gets it as an estimate.
- Camera released on leave, app hidden, interruption and after measuring; Hebrew messages for denied / no camera / busy / unsupported.
- Tests: 64 unit/integration (incl. 25 server isolation) + 33 browser (14 for the Light Meter) — all pass. Headless Chromium with iPhone viewport only; NOT yet on a real iPhone.

Product update (2026-10-02, owner requirements 1–28) — implemented, tested, deployed:
- Tools: pest ID, "what is this?" and the substrate-mix builder removed (Diagnose / AI Botanist cover them).
- Identification → My Plants: the original identification photos become the new plant's photos (first = main) via the normal pipeline; nothing stored if not saved.
- AI Botanist = real chat: per-plant history (server-written `chat`/`message` records, synced), streaming answers (SSE through the Worker), stop, retry, no duplicate answers, compact question-aware context (1 D1 round trip, 55–63 % smaller), shorter answers.
- Schema v3 (additive): `user_chat_runs`, two indexes, timing columns. Applied on the first signed-in request after deploy.
- Catalog: 14 curated + 286 catalog entries (data packs, validated, honest provenance, placeholders instead of unlicensed photos); search in Hebrew/English/scientific/synonyms; AI identifications outside the catalog stay usable.
- Measurements: `docs/perf/AI_PERFORMANCE_2026-10.md` (real production baseline: old Botanist 17 s / identify 20–29 s until any text; local streaming pipeline overhead ≈ 50 ms).
- Tests: 96 unit/integration/isolation + 51 browser tests, all passing (Chromium at iPhone size, mocked model).

Not done / known issues:
- Live AI works in production (owner's identify ×5 and ask ×1 on 2026-10-02, all ok). The new streaming chat has not been used live yet — the dev environment cannot pass Cloudflare Access; the first signed-in chat gives real first-token timings in `npm run verify:live`.
- Catalog content is an unverified editorial draft (no primary-source check yet); no licensed plant photos added yet.
- Not readable with the current read-only credential: R2 object listing (R2 Read) and Workers Logs (Workers Observability Read). Failed AI calls are therefore also recorded as metadata rows in `user_ai_usage` (since `e99472c`).
- Live Light Meter and photo picker not yet confirmed on a real iPhone (Safari camera permission prompt, inline preview, green camera indicator turning off). Android/desktop exposure metadata is deliberately not used (only meaningful in manual mode, device-dependent).
- App data lives on the PREVIEW D1/R2 (no production resources yet — creating them needs owner approval).
- Not built yet: push notifications, weather, original-photo ZIP export (feasibility pending), seedling split/thin and lineage UI, fertilizer library, external plant-name lookup, offline photo-upload retry UI. Illustrations/photos are crops of the supplied references (placeholders until final art). JS bundle ~172 KB gz (route splitting later).
- Phase 0 iPhone tests (P0-1…P0-11) not yet run.

## Deployment status (2026-10-02)
- Every push to `claude/gifted-gates-l6yzsf` is built and deployed by Workers Builds (`leafling-preview`, root `spikes/phase0`, `npx wrangler deploy`). Commit → build → version mapping comes from the commit's GitHub check run.
- `89c5785` (multi-user) → version `cc014dc5`; `3aeeba7` (verification tooling) → `96857cf5`; `e4f45e0` (product fixes) → `a9ed1c83-7ed1-4171-87a3-fcb575092521`, build success 13:07 UTC. The docs-only commit after it gets its own build; see its check run.
- 13:33 UTC: owner added the secret `ANTHROPIC_API_KEY` in the dashboard (version `41bb1b6b`, same script hash as `5971b03c`).
- `e99472c` (failed-AI metadata + extended verify:live) → version `dcfb0288`, ACTIVE at 100% since 13:40 UTC; secret, `ACCESS_AUD`, `OWNER_EMAIL`, D1 `DB` and R2 `PHOTOS` bindings intact (`keep_vars`).
- Verification from the dev environment works: the cloud environment has a read-only Cloudflare credential ("Cloudflare Leafling ReadOnly") injected by the proxy for api.cloudflare.com; `npm run verify:live -- <commit>` needs no variable. 2026-10-02 run: all checks pass — migration v2, 4/4 original records for the owner, nothing unclaimed, no orphan rows in any per-user table, 2 users (owner + one more), no AI calls yet.
- `94eac14` (live-camera Light Meter) → version `b344c47c`, ACTIVE at 100% since 14:02 UTC; secret and bindings intact; all verify:live checks pass. Still no AI call recorded in production (no signed-in test yet).
- The live app shows its commit in Settings (footer) and at `/version.json`.

## Cloudflare resources
Free plan only; billing alerts configured; no API tokens created by the owner. Created by the owner in Stage A (2026-09-27):
- workers.dev subdomain: `nisimy.workers.dev`
- Zero Trust team: `nisimy` (One-time PIN enabled)
- D1: `leafling-preview` (ID `be736b5f-a420-4797-8145-f710c02db8b1`)
- R2: `leafling-preview-photos` (public access disabled)
Worker `leafling-preview` + Access application: Access confirmed active (unauthenticated requests redirect to `nisimy.cloudflareaccess.com`, checked 2026-10-02). It now serves the app at `/` and the Phase 0 harness at `/phase0/`. No production resources.

## API secrets
`ANTHROPIC_API_KEY` is set as an encrypted secret on `leafling-preview` (2026-10-02, verified as a `secret_text` binding; value never read). Model `claude-sonnet-5`, app budget US$2/month (`AI_BUDGET_USD`), 20 calls per user per 10 minutes. `VAPID_PRIVATE_KEY` not yet set. Anthropic workspace `Leafling Preview` exists (US$5 prepaid, US$5 monthly limit, alerts at US$1/US$4, auto-reload off); no API key created yet.
Planned in Stage B, entered by the owner only as encrypted Cloudflare Worker secrets on `leafling-preview`: `ANTHROPIC_API_KEY` and `VAPID_PRIVATE_KEY` (generated in the owner's browser via `/keygen`; never stored in D1 or anywhere else). Plain variables: `OWNER_EMAIL`, `ACCESS_AUD`, `VAPID_PUBLIC_KEY`. Nothing secret in Git, source files, chat or frontend code.

## Pending owner decisions
- The two additional emails were added to the Access policy by the owner (2026-10-02).
- Approve creating production resources (Worker `leafling`, D1, R2) before entering real long-term data, or explicitly accept the preview resources as the interim home.
- Replace reference-derived illustrations with final art (and the requested pink-variegated Alocasia icon concept) — the approved pothos icon remains in use until a new icon file is supplied.
- Photo export mechanism (after Phase 0 P0-7).

## Next recommended step
1. Owner runs one live AI test while signed in (one identification with a photo, one AI Botanist question on a plant, one diagnosis) → `npm run verify:live` confirms the calls (status `ok`, image counts, own-plant context).
2. Optional: add R2 Read and Workers Observability Read to the read-only Cloudflare credential (photo-preservation check, error logs).
3. Real-iPhone check of the live Light Meter (permission prompt, live preview, measure, assign to a plant; camera indicator off after leaving) and the photo picker; Phase 0 iPhone tests.
