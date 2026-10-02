export interface AppEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  AI_BUDGET_USD: string;
  /** Email of the ORIGINAL single owner. Only used to hand pre-multi-user data to that verified identity once (users.ts) and by the owner-only Phase 0 harness. Not an allowlist — Cloudflare Access decides who may sign in. */
  OWNER_EMAIL?: string;
  ACCESS_AUD?: string;
  ANTHROPIC_API_KEY?: string;
  DEV_AUTH_BYPASS?: string;
}
