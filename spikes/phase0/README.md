# Leafling — Phase 0 spike (throwaway)

> Since 2026-10-02 this Worker config also hosts the Leafling app: the custom build compiles the repo-root app into `../../dist` (served at `/`), and this harness is served at `/phase0/`. App API: `/api/v1/*` (repo-root `src/worker`); harness API: `/api/*`.

Platform-validation code for `docs/phase0/PHASE0_TEST_PLAN.md`. **Not application code.** It is deleted at the end of Phase 0 and nothing here is promoted into the app.

- Worker: `leafling-preview` → `https://leafling-preview.nisimy.workers.dev` (Cloudflare Free plan, preview only)
- Bindings (from `wrangler.jsonc`): D1 `DB` → `leafling-preview`, R2 `PHOTOS` → `leafling-preview-photos`
- Deployment: Cloudflare Workers Builds from branch `claude/gifted-gates-l6yzsf`, root directory `spikes/phase0`, deploy command `npx wrangler deploy`
- Access: the whole workers.dev hostname is protected by Cloudflare Access (email one-time PIN). The harness (`src/auth.ts`) verifies the Access JWT (`Cf-Access-Jwt-Assertion`: signature, `aud`, `iss`, `exp`, owner email) and **fails closed** if `ACCESS_AUD` or `OWNER_EMAIL` are missing — the harness stays owner-only. The app API (`/api/v1/*`) is multi-user since 2026-10-02: see `docs/security/MULTI_USER.md`.

## Configuration (never in Git)
| Name | Kind | Set where |
|---|---|---|
| `OWNER_EMAIL` | Text variable | Worker → Settings → Variables and Secrets |
| `ACCESS_AUD` | Text variable | same |
| `VAPID_PUBLIC_KEY` | Text variable | same (from `/keygen`) |
| `VAPID_PRIVATE_KEY` | **Secret** | same (from `/keygen`; never stored in D1 or anywhere else) |
| `ANTHROPIC_API_KEY` | **Secret** | same (from the Anthropic `Leafling Preview` workspace) |

`keep_vars: true` in `wrangler.jsonc` keeps dashboard variables across deploys; secrets are never touched by deploys.

## What is in here
| Path | Purpose |
|---|---|
| `src/auth.ts` | Access JWT verification (fail closed) |
| `src/sync.ts` | P0-2/P0-3: idempotent push, server-revision ordering, conflict records + restore |
| `src/photos.ts` | P0-5/P0-6: streamed original upload with R2-verified SHA-256, write-once |
| `src/zip.ts` | P0-7 **feasibility test**: streamed store-only ZIP export (not an approved implementation) |
| `src/webpush.ts`, `src/push.ts` | P0-8: Web Push (VAPID + aes128gcm) with WebCrypto; private key only from the Worker secret |
| `src/keygen.ts` | `/keygen`: VAPID key pair generated in the owner's browser; no network requests; disabled once `VAPID_PUBLIC_KEY` is set |
| `src/ai.ts` | P0-10: allowlist Sonnet 5 + Haiku 4.5 only; US$2 spike budget; metadata-only logging |
| `src/schema.ts` | Spike tables (created lazily) |
| `public/` | iPhone test page (Hebrew RTL, no build step), service worker, manifest, placeholder icons |
| `test/` | Unit tests incl. RFC 8291 Appendix A test vector |

## Local checks (no Cloudflare account needed)
```
npm ci
npm run typecheck
npm test
npm run dev   # local simulators only; auth bypass works only on localhost
```

## Known spike limitations
- Sync uses read-then-batch (not a single atomic compare-and-set). Acceptable for a single-user spike; the application will use conditional writes.
- Each synced mutation costs ~3–4 D1 statements, so batches of 25/50 may exceed the Free plan's 50 queries per invocation — this is exactly what P0-9 measures.
- ZIP export may repeat the same uploaded photo as separate entries (`repeatToMB`) to reach the 175/500 MB test points.
- Icons are plain placeholders; the approved Leafling icon is used from Phase 1.

## Teardown (end of Phase 0)
Delete spike data with `POST /api/test/cleanup` (`{"confirm":"DELETE-SPIKE-DATA"}`), then remove this folder in a commit. The preview Worker, D1 database and R2 bucket remain for Phase 1.
