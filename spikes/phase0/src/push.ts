import type { Ctx } from "./env.ts";
import { HttpError, json, logEvent, readJson } from "./util.ts";
import { importVapid, isAllowedEndpoint, sendPush } from "./webpush.ts";

// P0-8. The VAPID private key is read only from the encrypted Worker secret
// VAPID_PRIVATE_KEY. It is never written to D1, R2, logs or responses.

export function publicKey(ctx: Ctx): Response {
  return json({ publicKey: ctx.env.VAPID_PUBLIC_KEY ?? null, privateKeyConfigured: Boolean(ctx.env.VAPID_PRIVATE_KEY) });
}

export async function subscribe(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<{ subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; deviceLabel?: string }>(req, 16 * 1024);
  const s = body.subscription;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) throw new HttpError(400, "bad_subscription");
  if (!isAllowedEndpoint(s.endpoint)) throw new HttpError(400, "endpoint_not_allowed");
  await ctx.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, device_label, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, device_label=excluded.device_label, failure_count=0`,
  ).bind(s.endpoint, s.keys.p256dh, s.keys.auth, (body.deviceLabel ?? "").slice(0, 60), new Date().toISOString()).run();
  logEvent("push.subscribe", { host: new URL(s.endpoint).hostname });
  return json({ subscribed: true });
}

export async function testPush(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<{ mode?: "declarative" | "classic"; delaySec?: number; badge?: number }>(req, 4 * 1024);
  if (!ctx.env.VAPID_PRIVATE_KEY || !ctx.env.VAPID_PUBLIC_KEY) throw new HttpError(503, "vapid_not_configured");
  if (!ctx.env.OWNER_EMAIL) throw new HttpError(503, "owner_email_not_configured");
  const key = await importVapid(ctx.env.VAPID_PRIVATE_KEY, ctx.env.VAPID_PUBLIC_KEY).catch((e: Error) => {
    throw new HttpError(503, e.message);
  });
  const subs = (await ctx.env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions`).all<{ endpoint: string; p256dh: string; auth: string }>()).results;
  if (!subs.length) throw new HttpError(404, "no_subscriptions");

  const mode = body.mode === "classic" ? "classic" : "declarative";
  const delaySec = Math.min(Math.max(Number(body.delaySec ?? 0) | 0, 0), 25);
  const badge = Math.min(Math.max(Number(body.badge ?? 1) | 0, 0), 99);
  const sentAt = new Date().toISOString();
  const title = "Leafling · בדיקה";
  const text = `התראת בדיקה (${mode}) · ${sentAt.slice(11, 19)} UTC`;
  const navigate = `/phase0/?from=push&t=${encodeURIComponent(sentAt)}`;
  const payload = mode === "declarative"
    ? { web_push: 8030, notification: { title, body: text, navigate, lang: "he", dir: "rtl" }, app_badge: badge }
    : { title, body: text, url: navigate, badge };
  const vapid = { key, publicKey: ctx.env.VAPID_PUBLIC_KEY, subject: `mailto:${ctx.env.OWNER_EMAIL}` };

  const run = async () => {
    if (delaySec) await new Promise((r) => setTimeout(r, delaySec * 1000));
    for (const s of subs) {
      const t0 = Date.now();
      let status = 0;
      try { status = await sendPush(s, payload, vapid); } catch { status = -1; }
      if (status === 404 || status === 410) {
        await ctx.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(s.endpoint).run();
      } else {
        await ctx.env.DB.prepare(`UPDATE push_subscriptions SET last_status = ?, failure_count = CASE WHEN ? BETWEEN 200 AND 299 THEN 0 ELSE failure_count + 1 END WHERE endpoint = ?`)
          .bind(status, status, s.endpoint).run();
      }
      logEvent("push.send", { mode, status, ms: Date.now() - t0, delaySec });
    }
  };
  if (delaySec) {
    ctx.exec.waitUntil(run());
    return json({ scheduled: true, mode, delaySec, subscriptions: subs.length, sentAt });
  }
  await run();
  const statuses = (await ctx.env.DB.prepare(`SELECT last_status FROM push_subscriptions`).all<{ last_status: number }>()).results.map((r) => r.last_status);
  return json({ sent: true, mode, statuses, sentAt });
}
