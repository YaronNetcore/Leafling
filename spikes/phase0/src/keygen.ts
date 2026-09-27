import type { Ctx } from "./env.ts";

// One-time VAPID key-generation page. The key pair is generated IN THE OWNER'S BROWSER
// with WebCrypto. This page makes no network requests (CSP connect-src 'none'), and the
// Worker never receives, stores or logs the private key. Disabled once VAPID_PUBLIC_KEY is set.

const CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
const headers = (type: string) => ({
  "content-type": type,
  "cache-control": "no-store",
  "content-security-policy": CSP,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

export function keygenPage(ctx: Ctx): Response {
  if (ctx.env.VAPID_PUBLIC_KEY) {
    return new Response(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VAPID</title><body style="font-family:system-ui;padding:16px"><h1>מפתחות ההתראות כבר מוגדרים</h1><p>הדף הזה מושבת כי VAPID_PUBLIC_KEY כבר קיים. להחלפת מפתחות: מחקי את VAPID_PUBLIC_KEY ואת VAPID_PRIVATE_KEY בהגדרות ה-Worker ופתחי שוב את הדף.</p></body></html>`, { headers: headers("text/html; charset=utf-8") });
  }
  return new Response(`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leafling · יצירת מפתחות התראות</title></head>
<body style="font-family:system-ui;padding:16px;max-width:720px;margin:auto;background:#FBF7EE;color:#2d3a26">
<h1>יצירת מפתחות התראות (VAPID)</h1>
<p>המפתחות נוצרים <b>בדפדפן שלך בלבד</b>. הדף לא שולח שום דבר לרשת ולא שומר דבר.</p>
<ol>
<li>לחצי "צור מפתחות".</li>
<li>העתיקי את <b>המפתח הפרטי</b> והדביקי אותו ב-Cloudflare כ-<b>Secret</b> בשם <code dir="ltr">VAPID_PRIVATE_KEY</code>.</li>
<li>העתיקי את <b>המפתח הציבורי</b> והדביקי אותו כ-<b>Text</b> בשם <code dir="ltr">VAPID_PUBLIC_KEY</code>.</li>
<li>לחצי "נקה" וסגרי את הדף. אל תשמרי את המפתח הפרטי בשום מקום אחר ואל תשלחי אותו בצ'אט.</li>
</ol>
<button id="gen" style="font-size:18px;padding:10px 16px">צור מפתחות</button>
<div id="out" hidden>
<h2>מפתח פרטי — Secret: <code dir="ltr">VAPID_PRIVATE_KEY</code></h2>
<textarea id="priv" readonly dir="ltr" rows="5" style="width:100%;font-family:monospace"></textarea>
<button id="copyPriv">העתק מפתח פרטי</button>
<h2>מפתח ציבורי — Text: <code dir="ltr">VAPID_PUBLIC_KEY</code></h2>
<textarea id="pub" readonly dir="ltr" rows="3" style="width:100%;font-family:monospace"></textarea>
<button id="copyPub">העתק מפתח ציבורי</button>
<p><button id="clear">נקה (מוחק מהדף ומנסה לנקות את הלוח)</button></p>
</div>
<script src="/keygen.js"></script>
</body></html>`, { headers: headers("text/html; charset=utf-8") });
}

export function keygenScript(ctx: Ctx): Response {
  if (ctx.env.VAPID_PUBLIC_KEY) return new Response("", { status: 404, headers: headers("text/javascript") });
  const js = `"use strict";
const b64u = (buf) => { const u = new Uint8Array(buf); let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
const $ = (id) => document.getElementById(id);
$("gen").addEventListener("click", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
  $("priv").value = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
  $("pub").value = b64u(pub);
  $("out").hidden = false; $("gen").disabled = true;
});
const copy = async (id, btn) => { try { await navigator.clipboard.writeText($(id).value); btn.textContent = "הועתק ✓"; } catch { $(id).select(); } };
$("copyPriv").addEventListener("click", (e) => copy("priv", e.target));
$("copyPub").addEventListener("click", (e) => copy("pub", e.target));
$("clear").addEventListener("click", async () => { $("priv").value = ""; $("pub").value = ""; try { await navigator.clipboard.writeText(" "); } catch {} $("out").hidden = true; });
`;
  return new Response(js, { headers: headers("text/javascript; charset=utf-8") });
}
