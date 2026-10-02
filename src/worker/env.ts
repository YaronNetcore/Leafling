export interface AppEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  AI_BUDGET_USD: string;
  OWNER_EMAIL?: string;
  ACCESS_AUD?: string;
  ANTHROPIC_API_KEY?: string;
  DEV_AUTH_BYPASS?: string;
}
