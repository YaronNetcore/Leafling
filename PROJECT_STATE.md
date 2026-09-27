# PROJECT_STATE.md

## Product name
**Leafling** (approved working product name)

## Product summary
Leafling is a personal, single-user, iPhone-first, Hebrew RTL Progressive Web App for managing and growing plants: personal plant collection with long-term per-plant memory, visual journal and technical history, soil-check-based watering, fertilizing, seedlings and propagation (with groups and lineage), locations and light, diagnosis and treatment tracking, a general plant database, a Wishlist, ten core grow tools, and an AI Botanist powered by the Claude API through a secure server-side layer. General species knowledge is the starting point; the plant's own history gains weight over time. AI never changes data without explicit user confirmation.

## Current phase
Phase 0 — Platform validation (preparation). Architecture review: **completed** (2026-09-27).

## Source-of-truth files
- `PRODUCT_SPEC.md` — product requirements; the source of truth, wins on any conflict. Committed to the repository unchanged, as supplied by the owner.
- `ARCHITECTURE.md` — technical architecture, revision 3 — **approved** 2026-09-27.
- `docs/phase0/PHASE0_TEST_PLAN.md` — Phase 0 test plan.
- `PROJECT_STATE.md` — this status file.
- Approved Leafling app icon (supplied product asset; must not be redesigned or replaced): square 1254×1254 JPEG supplied by the owner in the architecture-phase conversation — variegated pothos in a smiling speckled cream pot with the "Leafling" wordmark on a cream rounded tile. Not yet in the repository; to be committed unchanged as `assets/brand/leafling-icon-original.jpg` at the start of Phase 1. Optimized derivatives are created only during implementation, using the approved crop to the inner cream tile; formats, sizes and clipping checks are in `ARCHITECTURE.md` §24.

## Approved decisions already present in PRODUCT_SPEC.md
- Web app / PWA, iPhone-first, installable to the Home Screen; not native iOS; no Mac, Xcode, App Store, private Ubuntu server or always-on personal computer.
- Code in a private GitHub repository.
- Cloudflare (Pages/Workers, D1, R2, Access) is the direction to validate, not a final choice.
- One authorized user; no app-specific email/password registration.
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
- Claude: Sonnet 5 and Haiku 4.5 only, US$10/month budget cap; Opus not enabled in version 1 without explicit future approval.
- All remaining recommendations in `ARCHITECTURE.md` §24 (frontend stack, code architecture, services, schema, sync, backup specifics, notifications, Light Meter, plant data provenance, Open-Meteo, archive/delete, no manual drag sorting in v1, confidence conventions, export/statistics out of scope).

## Files created during this phase
- `ARCHITECTURE.md`
- `PROJECT_STATE.md`
- `PRODUCT_SPEC.md` (committed unchanged from the owner-supplied file; not authored in this phase)
- `docs/phase0/PHASE0_TEST_PLAN.md` (Phase 0 preparation)

## Architecture status
Approved (revision 3, 2026-09-27). Architecture-review phase completed.

## Implementation status
Phase 0 started (preparation only): test plan written. No spike code, no application code, no dependencies yet. Waiting for owner Stage A account actions and confirmation. Phase 1 not started.

## Cloudflare resources
Not created. Planned for Phase 0 (created by the owner in the dashboard, Free plan only): Worker `leafling-preview`, D1 `leafling-preview`, R2 bucket `leafling-preview-photos`, Access protection on the preview workers.dev URL.

## API secrets
Not configured. Planned for Phase 0: `ANTHROPIC_API_KEY` (preview workspace, US$5 limit) entered by the owner directly as an encrypted Cloudflare Worker secret. Never in Git, source files, chat or frontend code.

## Pending owner decisions
None for the architecture. Open implementation items (ARCHITECTURE.md §24):
- Production provisioning method for the Web Push VAPID key pair (decide before Phase 4).
- Phase 0 findings may refine photo-export part size, AI image caps, sync batch sizes and the Light Meter form.

Pending owner actions: Phase 0 Stage A account setup in Cloudflare and Anthropic (see chat instructions / `docs/phase0/PHASE0_TEST_PLAN.md`), then confirmation.

## Next recommended step
Owner completes Phase 0 Stage A account actions and confirms, providing the non-secret identifiers (workers.dev subdomain, Zero Trust team name, D1 database ID). Then: write the throwaway spike in `spikes/phase0/`, owner connects the repository in Workers Builds and enters the preview Anthropic key as a Worker secret (Stage B), and run the Phase 0 tests on the iPhone.
