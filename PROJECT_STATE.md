# PROJECT_STATE.md

## Product name
**Leafling** (approved working product name)

## Product summary
Leafling is a personal, single-user, iPhone-first, Hebrew RTL Progressive Web App for managing and growing plants: personal plant collection with long-term per-plant memory, visual journal and technical history, soil-check-based watering, fertilizing, seedlings and propagation (with groups and lineage), locations and light, diagnosis and treatment tracking, a general plant database, a Wishlist, ten core grow tools, and an AI Botanist powered by the Claude API through a secure server-side layer. General species knowledge is the starting point; the plant's own history gains weight over time. AI never changes data without explicit user confirmation.

## Current phase
Architecture review

## Source-of-truth files
- `PRODUCT_SPEC.md` — product requirements (source of truth; wins on any conflict). Supplied by the owner; not yet committed to this repository.
- `ARCHITECTURE.md` — technical architecture proposal (pending approval).
- `PROJECT_STATE.md` — this status file.
- Approved Leafling app icon (supplied product asset; do not redesign or replace): square 1254×1254 JPEG supplied by the owner in the architecture-phase conversation — variegated pothos in a smiling speckled cream pot with the "Leafling" wordmark on a cream rounded tile. Not yet in the repository (this phase is limited to two files); to be committed unchanged as `assets/brand/leafling-icon-original.jpg` at the start of implementation. Optimized derivatives only during implementation; required PWA/iPhone formats, sizes and clipping checks are in `ARCHITECTURE.md` §24.

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
- Original photos are never modified; no AI crop/align/enhance; technical thumbnails allowed; timelapse from originals without alignment.
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

## Files created during this phase
- `ARCHITECTURE.md`
- `PROJECT_STATE.md`

## Architecture status
Pending approval

## Implementation status
Not started

## Cloudflare resources
Not created

## API secrets
Not configured

## Pending owner decisions
(Details and recommendations in `ARCHITECTURE.md` §24.)
1. Frontend stack: React + Vite + TypeScript SPA, Tailwind (logical utilities), Radix, Dexie, Workbox.
2. Code architecture: single Cloudflare Worker (static assets + API + cron), shared domain module, local-first client with outbox.
3. Cloudflare services: Workers (not Pages), D1, R2, Access; Workers Paid (US$5/month) for production.
4. Authentication: Cloudflare Access, owner-email-only; identity method One-time PIN vs Google login.
5. Data schema: event log + current state; naming ordinal rules.
6. Offline/sync strategy: full structured-data sync, outbox, field-level last-writer-wins with preserved history.
7. Backup/restore: Time Travel + nightly logical backups + photo mirror + on-demand off-Cloudflare export; failure alerts in-app only.
8. Notifications: Home Screen Web Push, daily digest, quiet hours.
9. Light Meter approach: no fake lux; questionnaire + manual lux + optional approximate camera indicator.
10. Plant data source and provenance policy; optional Pl@ntNet second opinion.
11. Weather provider: Open-Meteo.
12. Archive/Delete cascade and 30-day trash retention.
13. Journal video: not in v1.
14. Manual drag sorting: not in v1.
15. Claude models, image caps and monthly AI budget cap (recommended US$10).
16. Image derivatives; Timelapse/Compare using unaltered display-size derivatives of originals.
17. Confidence display conventions.
18. Export/year summary and statistics screen remain out of scope.
19. Custom domain vs workers.dev for production.
20. Icon derivation: crop to the inner cream tile of the supplied icon (no redesign) to avoid a "tile within a tile" on iOS.

## Next recommended step
Owner reviews `ARCHITECTURE.md` and answers the pending decisions. After explicit approval, begin Phase 0 (platform validation spikes on a real iPhone: Access login in the installed PWA, Web Push, photo metadata, local storage persistence, light-meter feasibility) before any application implementation.
