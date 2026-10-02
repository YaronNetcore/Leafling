// Test harness: runs the REAL deployed Worker entry (spikes/phase0/src/combined.ts → src/worker/*) in
// Miniflare (workerd) with local D1 + R2. Identities are real RS256 Access-style JWTs signed by a
// throwaway key pair generated per run; the Worker fetches the matching JWKS through a mocked
// outbound service, exactly as it fetches https://<team>/cdn-cgi/access/certs in production.
// No real credentials or tokens are used or printed.
import * as esbuild from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

export const TEAM = "test-team.cloudflareaccess.com";
export const AUD = "test-aud-0000000000000000000000000000000000000000000000000000";
export const OWNER_EMAIL = "owner@example.test";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const b64u = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");

export interface Signer { kid: string; key: CryptoKey; jwk: JsonWebKey }
export async function newSigner(kid: string): Promise<Signer> {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  return { kid, key: kp.privateKey, jwk: await crypto.subtle.exportKey("jwk", kp.publicKey) };
}

export async function signJwt(s: Signer, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: s.kid, typ: "JWT", ...header }));
  const p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", s.key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

export interface Person { sub: string; email: string }
export function claimsFor(p: Person, over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [AUD], email: p.email, sub: p.sub, iss: `https://${TEAM}`, iat: now, nbf: now - 5, exp: now + 3600, type: "app", identity_nonce: "n", country: "IL", ...over };
}

export interface AnthropicCall { body: Record<string, unknown> }

let bundled: string | null = null;
async function bundle(): Promise<string> {
  if (bundled) return bundled;
  const out = await esbuild.build({
    entryPoints: [`${ROOT}spikes/phase0/src/combined.ts`], bundle: true, format: "esm", platform: "browser",
    conditions: ["workerd", "worker", "browser"], target: "es2022", write: false, logLevel: "silent",
    external: ["cloudflare:*", "node:*"],
  });
  bundled = out.outputFiles[0].text as string;
  return bundled;
}

export type TestD1 = Awaited<ReturnType<Miniflare["getD1Database"]>>;
export type TestR2 = Awaited<ReturnType<Miniflare["getR2Bucket"]>>;

export interface Harness {
  mf: Miniflare;
  signer: Signer;
  anthropic: AnthropicCall[];
  certFetches: number;
  fetch(path: string, init?: RequestInit & { token?: string | null; user?: string | null }): Promise<Response>;
}

export async function startWorker(opts: { anthropicKey?: boolean; beforeFirstRequest?: (db: TestD1, r2: TestR2) => Promise<void> } = {}): Promise<Harness> {
  const signer = await newSigner("kid-test-1");
  const anthropic: AnthropicCall[] = [];
  const h = { certFetches: 0 } as Harness;
  const mf = new Miniflare({
    modules: true,
    script: await bundle(),
    compatibilityDate: "2026-08-01", // newest date the stable workerd test binary supports (prod: 2026-09-01)
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    r2Buckets: ["PHOTOS"],
    bindings: {
      ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL, AI_BUDGET_USD: "2", SPIKE_PHASE: "0",
      ...(opts.anthropicKey ? { ANTHROPIC_API_KEY: "test-not-a-real-key" } : {}),
    },
    async outboundService(req: Request) {
      const u = new URL(req.url);
      if (u.hostname === TEAM && u.pathname === "/cdn-cgi/access/certs") {
        h.certFetches++;
        return new Response(JSON.stringify({ keys: [{ ...signer.jwk, kid: signer.kid, alg: "RS256", use: "sig" }] }), { headers: { "content-type": "application/json" } });
      }
      if (u.hostname === "api.anthropic.com") {
        anthropic.push({ body: await req.json() });
        const result = { answer: "ok", observed: [], interpretation: [], missing: [], confidence: "possible", candidates: [{ name_he: "פוטוס", scientific: "Epipremnum aureum", confidence: "likely", why: "test" }], urgency: "none", contagious_suspected: false, retake_request: null };
        return new Response(JSON.stringify({
          id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(result) }], usage: { input_tokens: 100, output_tokens: 20 },
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("blocked in tests", { status: 599 });
    },
  });
  if (opts.beforeFirstRequest) await opts.beforeFirstRequest(await mf.getD1Database("DB"), await mf.getR2Bucket("PHOTOS"));
  Object.assign(h, {
    mf, signer, anthropic,
    async fetch(path: string, init: RequestInit & { token?: string | null; user?: string | null } = {}) {
      const headers = new Headers(init.headers);
      if (init.token) headers.set("cf-access-jwt-assertion", init.token);
      if (init.user) headers.set("x-leafling-user", init.user);
      const { token: _t, user: _u, ...rest } = init;
      return mf.dispatchFetch(`https://leafling.test${path}`, { ...rest, headers: Object.fromEntries(headers) } as never) as unknown as Promise<Response>;
    },
  });
  return h;
}

/** A signed-in identity with convenience calls. `userId` is learned from /me (server-assigned). */
export class Client {
  userId = "";
  constructor(public h: Harness, public person: Person, public token = "") {}
  static async signIn(h: Harness, person: Person): Promise<Client> {
    const c = new Client(h, person, await signJwt(h.signer, claimsFor(person)));
    const me = await c.json<{ userId: string; isLegacyOwner: boolean; email: string }>("/api/v1/me");
    c.userId = me.userId;
    return c;
  }
  req(path: string, init: RequestInit & { user?: string | null } = {}) {
    return this.h.fetch(path, { user: this.userId || null, ...init, token: this.token });
  }
  async json<T>(path: string, init: RequestInit & { user?: string | null } = {}): Promise<T> {
    const r = await this.req(path, init);
    if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  }
  push(mutations: Record<string, unknown>[]) {
    return this.req("/api/v1/sync/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mutations }) });
  }
  async pullAll(): Promise<{ entity: string; id: string; data: Record<string, unknown>; rev: number }[]> {
    const out: { entity: string; id: string; data: Record<string, unknown>; rev: number }[] = [];
    let since = 0;
    for (;;) {
      const r = await this.json<{ records: typeof out; more: boolean; until: number }>(`/api/v1/sync/pull?since=${since}`);
      out.push(...r.records);
      since = r.until;
      if (!r.more) return out;
    }
  }
}

let n = 0;
export const mut = (entity: string, recordId: string, patch: Record<string, unknown>, baseRev = 0, deviceId = "dev-test") =>
  ({ mutationId: `m-${Date.now().toString(36)}-${(n++).toString(36)}`, entity, recordId, patch, baseRev, clientTime: new Date().toISOString(), deviceId });
