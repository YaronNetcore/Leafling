export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  PHOTOS: R2Bucket;
  // Plain configuration (wrangler.jsonc)
  ACCESS_TEAM_DOMAIN: string;
  AI_BUDGET_USD: string;
  SPIKE_PHASE: string;
  // Plain dashboard variables (not secret)
  OWNER_EMAIL?: string;
  ACCESS_AUD?: string;
  VAPID_PUBLIC_KEY?: string;
  // Encrypted Worker secrets (dashboard only; never in Git, D1, logs or responses)
  ANTHROPIC_API_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  // Local development only; ignored unless the request host is localhost
  DEV_AUTH_BYPASS?: string;
}

export interface Ctx {
  env: Env;
  exec: ExecutionContext;
  url: URL;
  email: string;
}
