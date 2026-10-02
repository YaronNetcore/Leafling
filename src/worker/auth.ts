import type { AppEnv as Env } from "./env.ts";
import { HttpError, b64urlDecode } from "./http.ts";

// Verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion). Fails closed if
// ACCESS_AUD or OWNER_EMAIL are not configured.

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let certCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function getKeys(teamDomain: string, forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && certCache && Date.now() - certCache.fetchedAt < 3600_000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, "access_certs_unavailable");
  const body = (await res.json()) as { keys: Jwk[] };
  certCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

export async function authenticate(req: Request, env: Env, url: URL): Promise<string> {
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (isLocal && env.DEV_AUTH_BYPASS === "true") return "dev@localhost";

  if (!env.ACCESS_AUD || !env.OWNER_EMAIL) throw new HttpError(503, "auth_not_configured");
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) throw new HttpError(401, "missing_access_token");

  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "malformed_token");
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; email?: string; exp?: number; nbf?: number; iss?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    throw new HttpError(401, "malformed_token");
  }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError(401, "bad_token_alg");

  let keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getKeys(env.ACCESS_TEAM_DOMAIN, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, "unknown_signing_key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new HttpError(401, "bad_signature");

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new HttpError(401, "bad_audience");
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new HttpError(401, "bad_issuer");
  if (!payload.exp || payload.exp < now) throw new HttpError(401, "token_expired");
  if (payload.nbf && payload.nbf > now + 60) throw new HttpError(401, "token_not_yet_valid");
  if (!payload.email || payload.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) {
    throw new HttpError(403, "not_owner");
  }
  return payload.email;
}
