export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function readJson<T>(req: Request, maxBytes: number): Promise<T> {
  if (Number(req.headers.get("content-length") ?? "0") > maxBytes) throw new HttpError(413, "body_too_large");
  try { return (await req.json()) as T; } catch { throw new HttpError(400, "invalid_json"); }
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Content-free structured log line. Never pass bodies, keys, photos or AI text. */
export const logEvent = (route: string, f: Record<string, string | number | boolean | null>) =>
  console.log(JSON.stringify({ app: "leafling", route, ...f }));
