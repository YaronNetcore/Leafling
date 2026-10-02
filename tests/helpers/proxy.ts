// Local stand-in for Cloudflare Access in browser tests: serves dist/ and forwards /api/* to the Worker
// with a freshly signed Access JWT for whoever the "tu" cookie names (what Access injects in production).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimsFor, signJwt, type Harness, type Person } from "./worker.ts";

export const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

export async function startAccessProxy(h: Harness, people: Record<string, Person>): Promise<{ base: string; close: () => void }> {
  if (!existsSync(join(DIST, "index.html"))) throw new Error("dist/ missing — run `npm run build` (npm run test:e2e does this)");
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const who = /(?:^|;\s*)tu=([A-Za-z0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    if (url.pathname === "/cdn-cgi/access/logout") { res.writeHead(200, { "set-cookie": "tu=; Max-Age=0; Path=/", "content-type": "text/plain" }); res.end("logged out"); return; }
    if (url.pathname.startsWith("/api/")) {
      if (!who || !people[who]) { res.writeHead(302, { location: "/cdn-cgi/access/login" }); res.end(); return; }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !k.startsWith("cf-") && k !== "host" && k !== "cookie") headers[k] = v;
      headers["cf-access-jwt-assertion"] = await signJwt(h.signer, claimsFor(people[who]));
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const r = await h.mf.dispatchFetch(`https://leafling.test${url.pathname}${url.search}`, {
        method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
      } as never);
      const out: Record<string, string> = {};
      r.headers.forEach((v: string, k: string) => { out[k] = v; });
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  return { base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close() };
}
