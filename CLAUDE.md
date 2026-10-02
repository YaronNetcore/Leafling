# Leafling — working rules for Claude

## Delivery is end-to-end (owner requirement, permanent)
A development task is complete only after ALL of these, in order:
1. Implement.
2. Run the relevant tests: `npm run typecheck`, `npm test`, `npm run test:e2e` (builds first); harness changes also `cd spikes/phase0 && npm test`.
3. Commit (clear message).
4. Push to the designated branch (`claude/gifted-gates-l6yzsf` unless told otherwise). A push triggers Cloudflare Workers Builds (`leafling-preview`, root `spikes/phase0`).
5. Verify the build: the commit's GitHub check run "Workers Builds: leafling-preview" must be `success`; its summary names the Worker **Version ID**.
6. Confirm that version is the ACTIVE deployment and was built from the pushed commit (`npm run verify:live -- <commit>`; the live app also shows the short commit in Settings and serves `/version.json`).
7. Apply only safe, additive migrations (D1 migrations run automatically on the first signed-in API request; see `docs/security/MULTI_USER.md` §4). Never drop, truncate, reset or overwrite user data.
8. Verify the live app (`npm run verify:live` — read-only; never prints personal data).
9. Report completion only after the live verification passed. If something needs access or approval, name the exact blocker; never claim completion.

`verify:live` needs `CLOUDFLARE_API_TOKEN` (read-only: Workers Scripts Read, D1 Read, optionally R2 Read) as an environment secret. Never ask for tokens in chat and never print them.

## Security invariants
Multi-user isolation rules are in `docs/security/MULTI_USER.md` §1 — every new endpoint, table or local store must follow them and get an isolation test. Do not add users to the Access policy; the owner does that.
