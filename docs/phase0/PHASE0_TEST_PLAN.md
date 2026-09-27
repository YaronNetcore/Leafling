# Leafling — Phase 0 Test Plan (Platform Validation)

Status: **Preparation. Waiting for owner account actions (Stage A) before any Cloudflare resource is used.**
Authority: `ARCHITECTURE.md` (approved, revision 3) §22 Phase 0. Product source of truth: `PRODUCT_SPEC.md`.

## Purpose
Prove, on the owner's real iPhone and on the Cloudflare **Free** plan, the platform assumptions the architecture depends on — before Phase 1 foundation work. Phase 0 builds no product screens.

## Scope rules
- Throwaway spike code only, isolated in `spikes/phase0/` (created after owner confirmation). It is never promoted into the application; it is removed at the end of Phase 0.
- Runs only on **preview** resources: Worker `leafling-preview`, D1 `leafling-preview`, R2 `leafling-preview-photos`. No production resources exist yet.
- **Cloudflare Free plan only.** No paid resources, no plan upgrades.
- **Synthetic data only**, except test photos the owner chooses to take for P0-5/P0-7; those are deleted from R2 at the end of Phase 0.
- **Secrets:** never in Git, source files, chat or frontend code. The only Phase 0 secret the owner enters is the preview Anthropic key, typed directly into Cloudflare's encrypted Worker secret field. No Cloudflare API tokens are created.
- **Web Push keys (spike only):** the spike Worker generates its own VAPID key pair inside Cloudflare on first use and stores it in the preview D1 database. It never leaves Cloudflare. This shortcut is Phase 0-only; the production method is decided before Phase 4 (ARCHITECTURE.md §24, open items).
- Anthropic usage: preview workspace, Haiku 4.5 for most runs, a few Sonnet 5 runs; hard workspace limit US$5; expected spend < US$1. Opus is never called; the spike enforces the two-model allowlist.
- Deployment: Cloudflare **Workers Builds** from this GitHub repository (branch `claude/gifted-gates-l6yzsf`, root `spikes/phase0`). Nothing is deployed from a personal computer.

## Tests

| ID | Area | What is tested | Pass criteria |
|---|---|---|---|
| P0-1 | Access in installed PWA | Install `leafling-preview.<subdomain>.workers.dev` to the Home Screen; first launch; email one-time-code sign-in inside the standalone app; return to the app | Sign-in completes and returns to the standalone app (not stuck in Safari); API calls succeed afterwards |
| P0-2 | Session expiry + pending queue | Queue 20 changes (some in airplane mode); force-close; reopen; revoke the Access session in Zero Trust; make more changes; re-sign-in | All queued changes survive app close and expiry; app shows "צריך להתחבר מחדש" instead of failing; after sign-in every change reaches D1 exactly once (idempotent) |
| P0-3 | Server ordering of conflicts | Two clients (iPhone PWA + a desktop browser) edit the same field from the same `baseRev`; repeat with the iPhone's clock set wrong | Result follows server receipt order regardless of device clocks; overwritten value recorded in a conflict row and restorable |
| P0-4 | Local storage persistence | `navigator.storage.persist()` result and `storage.estimate()` in the installed app | Result recorded; queue survives phone restart |
| P0-5 | Photo picker | Camera vs photo library; file type (HEIC/JPEG); presence of EXIF capture date and GPS; file size; phone-side timing of display (~1600 px) and thumb (~400 px) copies, SHA-256 and CRC-32 | Capture date available or spec fallback confirmed; copy generation < ~1.5 s per photo on the owner's iPhone |
| P0-6 | Photo upload to R2 | Streamed upload of originals through the Worker with R2 SHA-256 checksum; deliberate mismatch | Stored object byte-identical (hash match); mismatch rejected; Worker CPU within budget |
| P0-7 | Original-photo export (E3b) | Stream a store-only ZIP of ~50 photos (~175 MB) and of ~500 MB from the installed PWA; save to Files / iCloud Drive; open in Files; fallback: share-sheet "Save to Files" in batches | ZIP saved and opens; every file's SHA-256 matches; Worker CPU within budget; part size chosen from results |
| P0-8 | Web Push | iOS version; permission prompt from a tap inside the installed app; standard Web Push via service worker and a Declarative Web Push payload; app closed/locked delivery; tap opens deep link; app badge | Notification delivered with app closed; deep link works; delivery latency recorded |
| P0-9 | Free-plan CPU budget | CPU time per route from Workers Logs: sync push (10/25/50 mutations), pull page, photo upload, ZIP export stream, push send, AI request with 0–4 images | p95 CPU < 7 ms per route (30 % margin under 10 ms). Any route that fails after mitigations is recorded against upgrade trigger T1/T2 — no upgrade without owner approval |
| P0-10 | AI proxy basics | Worker → Anthropic with the Worker secret; model allowlist (an Opus request is rejected); budget counter; operational log contains no prompt/answer/image content | All true; total spend < US$1 |
| P0-11 | Light Meter feasibility | Camera relative-brightness reading in 3 known spots (dark corner, bright indirect, direct sun) vs. a reference (external lux meter/app if available) | Decide final Light Meter form; no numeric lux is presented from the camera |

## Measurements to record
iOS version and iPhone model; per-test result (pass / fail / notes); CPU p50/p95 per route; photo sizes and formats; ZIP download behavior; push latency; storage persistence result; Anthropic cost.

## Exit
Findings are appended to `ARCHITECTURE.md` (Phase 0 findings section) and `PROJECT_STATE.md`; any failed assumption is escalated to the owner with options. Spike code and spike data are then removed (preview Worker kept for Phase 1). Phase 1 starts only after owner confirmation.

## Results
(to be filled in during Phase 0)

| ID | Result | Notes |
|---|---|---|
| P0-1 | — | |
| P0-2 | — | |
| P0-3 | — | |
| P0-4 | — | |
| P0-5 | — | |
| P0-6 | — | |
| P0-7 | — | |
| P0-8 | — | |
| P0-9 | — | |
| P0-10 | — | |
| P0-11 | — | |
