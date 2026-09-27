import { b64urlDecode, b64urlEncode } from "./util.ts";

// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
// implemented with WebCrypto only. The VAPID private key is passed in from the encrypted
// Worker secret and never persisted anywhere.

export interface PushSubscriptionData { endpoint: string; p256dh: string; auth: string }

const te = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** RFC 8291 aes128gcm encryption of a push message payload. */
export async function encryptPayload(
  payload: Uint8Array,
  uaPublicRaw: Uint8Array,
  authSecret: Uint8Array,
  opts: { salt?: Uint8Array; asKeyPair?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const asKeys = opts.asKeyPair ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey) as ArrayBuffer);
  const uaPublic = await crypto.subtle.importKey("raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublic } as unknown as SubtleCryptoDeriveKeyAlgorithm, asKeys.privateKey, 256));

  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(payload, new Uint8Array([2])); // single record, last-record delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext));

  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublicRaw.length;
  header.set(asPublicRaw, 21);
  return concat(header, ciphertext);
}

/** Imports the VAPID private key (JWK JSON from the Worker secret) and checks it matches the public key. */
export async function importVapid(privateJwkJson: string, publicKeyB64u: string): Promise<CryptoKey> {
  let jwk: JsonWebKey;
  try { jwk = JSON.parse(privateJwkJson); } catch { throw new Error("vapid_private_key_not_json_jwk"); }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) throw new Error("vapid_private_key_invalid");
  const pub = b64urlDecode(publicKeyB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("vapid_public_key_invalid");
  if (b64urlEncode(pub.slice(1, 33)) !== jwk.x || b64urlEncode(pub.slice(33, 65)) !== jwk.y) throw new Error("vapid_keys_do_not_match");
  return crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y, ext: false }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function vapidAuthorization(endpoint: string, subject: string, privateKey: CryptoKey, publicKeyB64u: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, te.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${publicKeyB64u}`;
}

const ALLOWED_PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function isAllowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && ALLOWED_PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

export async function sendPush(sub: PushSubscriptionData, payload: object, vapid: { key: CryptoKey; publicKey: string; subject: string }, urgency = "high"): Promise<number> {
  const body = await encryptPayload(te.encode(JSON.stringify(payload)), b64urlDecode(sub.p256dh), b64urlDecode(sub.auth));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid.subject, vapid.key, vapid.publicKey),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: urgency,
    },
    body,
  });
  return res.status;
}
