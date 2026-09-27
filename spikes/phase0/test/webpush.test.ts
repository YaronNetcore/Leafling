import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptPayload, importVapid, vapidAuthorization, isAllowedEndpoint } from "../src/webpush.ts";
import { b64urlDecode, b64urlEncode } from "../src/util.ts";
import { crc32 } from "../src/zip.ts";

const te = new TextEncoder();

async function importEcdhPrivate(dB64u: string, pubB64u: string): Promise<CryptoKeyPair> {
  const pub = b64urlDecode(pubB64u);
  const jwk = { kty: "EC", crv: "P-256", d: dB64u, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []);
  return { privateKey, publicKey };
}

test("RFC 8291 Appendix A test vector", async () => {
  const as = await importEcdhPrivate("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const body = await encryptPayload(
    te.encode("When I grow up, I want to be a watermelon"),
    b64urlDecode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
    b64urlDecode("BTBZMqHH6r4Tts7J_aSIgg"),
    { salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"), asKeyPair: as },
  );
  assert.equal(
    b64urlEncode(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("round-trip: user agent can decrypt", async () => {
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const uaPub = new Uint8Array((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const msg = te.encode(JSON.stringify({ web_push: 8030, notification: { title: "בדיקה", navigate: "/" } }));
  const body = await encryptPayload(msg, uaPub, auth);

  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as EcdhKeyDeriveParams, ua.privateKey, 256));
  const hk = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const ikm = await hk(auth, secret, new Uint8Array([...te.encode("WebPush: info\0"), ...uaPub, ...asPub]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  assert.equal(pt[pt.length - 1], 2);
  assert.deepEqual(pt.slice(0, -1), msg);
});

test("VAPID: key match check and verifiable ES256 JWT", async () => {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = b64urlEncode((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const priv = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
  const key = await importVapid(priv, pub);
  const auth = await vapidAuthorization("https://web.push.apple.com/abc", "mailto:owner@example.com", key, pub);
  const m = auth.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)!;
  assert.ok(m);
  assert.equal(m[4], pub);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
  assert.equal(claims.aud, "https://web.push.apple.com");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, b64urlDecode(m[3]), te.encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);

  const other = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const otherPub = b64urlEncode((await crypto.subtle.exportKey("raw", other.publicKey)) as ArrayBuffer);
  await assert.rejects(importVapid(priv, otherPub), /vapid_keys_do_not_match/);
});

test("push endpoint allowlist", () => {
  assert.ok(isAllowedEndpoint("https://web.push.apple.com/QK"));
  assert.ok(!isAllowedEndpoint("https://evil.example.com/push"));
  assert.ok(!isAllowedEndpoint("http://web.push.apple.com/x"));
});

test("crc32 matches known value", () => {
  assert.equal(crc32(te.encode("123456789")), 0xcbf43926);
});
