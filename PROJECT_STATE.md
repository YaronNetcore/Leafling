# PROJECT_STATE.md

## Product name
**Leafling** (approved working product name)

## Product summary
Leafling is a personal, single-user, iPhone-first, Hebrew RTL Progressive Web App for managing and growing plants: personal plant collection with long-term per-plant memory, visual journal and technical history, soil-check-based watering, fertilizing, seedlings and propagation (with groups and lineage), locations and light, diagnosis and treatment tracking, a general plant database, a Wishlist, ten core grow tools, and an AI Botanist powered by the Claude API through a secure server-side layer. General species knowledge is the starting point; the plant's own history gains weight over time. AI never changes data without explicit user confirmation.

## Current phase
Architecture review

## Source-of-truth files
- `PRODUCT_SPEC.md` — product requirements; the source of truth, wins on any conflict. Committed to the repository unchanged, as supplied by the owner.
- `ARCHITECTURE.md` — technical architecture proposal, revision 2 (pending approval).
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

Owner decisions recorded during architecture review (details in `ARCHITECTURE.md` §24):
- Cloudflare Free plan for version 1; Workers Paid only after a measured, documented trigger (§21 T1–T6).
- workers.dev address initially; custom domain later.
- D1 is the durable synchronized source of truth; IndexedDB is the offline copy and pending-change queue; unsynced changes survive app close and authentication expiry; conflict history is never silently discarded.
- Practical low-cost backups: essential recovery in v1; nightly duplicates and automated restore tests optional.
- Pl@ntNet not in version 1 (future optional integration).
- Email one-time-code authentication for the initial Cloudflare Access test.
- Timelapse and Compare use uncropped display-size copies.
- Journal video excluded from version 1.
- Derived iPhone icons use the approved crop; the original icon is preserved unchanged.
- `PRODUCT_SPEC.md` committed to the repository before implementation.

## Files created during this phase
- `ARCHITECTURE.md`
- `PROJECT_STATE.md`
- `PRODUCT_SPEC.md` (committed unchanged from the owner-supplied file; not authored in this phase)

## Architecture status
Pending approval (revision 2)

## Implementation status
Not started

## Cloudflare resources
Not created

## API secrets
Not configured

## Pending owner decisions
(Details and recommendations in `ARCHITECTURE.md` §24.)
1. Frontend stack: React + Vite + TypeScript SPA, Tailwind (logical utilities), Radix, Dexie, Workbox.
2. Code architecture: single Cloudflare Worker (static assets + API + one cron), shared domain module, local-first client.
3. Cloudflare services: Workers (not Pages), D1, R2, Access — on the Free plan.
4. Data schema: event log + current state; naming ordinal rules.
5. Sync details: field-level last-writer-wins with every overwritten value kept and restorable.
6. Backup specifics: essential recovery E1–E7 (Time Travel 7 days, pre-migration bookmarks, on-phone data export and import, 30-day trash, restore drill).
7. Notifications: daily digest by default, quiet hours.
8. Light Meter approach: no fake lux; questionnaire + manual lux + optional approximate camera indicator.
9. Plant data source and provenance policy.
10. Weather provider: Open-Meteo.
11. Archive/Delete cascade and 30-day trash retention.
12. Manual drag sorting: not in v1.
13. Claude models, image caps and monthly AI budget cap (recommended US$10).
14. Confidence display conventions.
15. Export/year summary and statistics screen remain out of scope.

## Next recommended step
Owner reviews `ARCHITECTURE.md` (revision 2), answers the pending decisions, and explicitly approves it. Then begin Phase 0 (platform validation spikes on a real iPhone and Free-plan CPU measurements) before any application implementation.
