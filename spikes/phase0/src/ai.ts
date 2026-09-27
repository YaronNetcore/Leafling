import Anthropic from "@anthropic-ai/sdk";
import type { Ctx } from "./env.ts";
import { HttpError, json, logEvent, readJson } from "./util.ts";

// P0-10. Only Sonnet 5 and Haiku 4.5 are allowed (Opus is NOT enabled in version 1).
// The API key comes only from the encrypted Worker secret ANTHROPIC_API_KEY.
// Operational logging is metadata only: no prompt text, answer text or images.

const MODELS: Record<string, { id: string; inPerM: number; outPerM: number }> = {
  haiku: { id: "claude-haiku-4-5", inPerM: 1, outPerM: 5 },
  sonnet: { id: "claude-sonnet-5", inPerM: 2, outPerM: 10 },
};
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1_500_000;

interface AiRequest { model?: string; prompt?: string; images?: { mediaType?: string; data?: string }[] }

export async function aiTest(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJson<AiRequest>(req, 8 * 1024 * 1024);
  const model = MODELS[body.model ?? ""];
  if (!model) throw new HttpError(400, "model_not_allowed");
  const prompt = (body.prompt ?? "").trim();
  if (!prompt || prompt.length > 2000) throw new HttpError(400, "bad_prompt");
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new HttpError(400, "too_many_images");
  for (const im of images) {
    if (im.mediaType !== "image/jpeg" || typeof im.data !== "string" || im.data.length > MAX_IMAGE_B64) throw new HttpError(400, "bad_image");
  }
  if (!ctx.env.ANTHROPIC_API_KEY) throw new HttpError(503, "anthropic_key_not_configured");

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const spent = await ctx.env.DB.prepare(`SELECT COALESCE(SUM(est_cost_usd), 0) AS s FROM ai_usage WHERE at >= ?`).bind(monthStart).first<{ s: number }>();
  const budget = Number(ctx.env.AI_BUDGET_USD) || 0;
  if ((spent?.s ?? 0) >= budget) throw new HttpError(429, "ai_budget_reached");

  const client = new Anthropic({ apiKey: ctx.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const t0 = Date.now();
  let status = "ok";
  try {
    const res = await client.messages.create({
      model: model.id,
      max_tokens: 1024,
      system: "You are a plant-care assistant for a Phase 0 connectivity test. Answer briefly in Hebrew.",
      messages: [{
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: im.data! } })),
          { type: "text" as const, text: prompt },
        ],
      }],
    });
    const latency = Date.now() - t0;
    if (res.stop_reason === "refusal") status = "refusal";
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const inTok = res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    const cost = (inTok * model.inPerM + res.usage.output_tokens * model.outPerM) / 1_000_000;
    await ctx.env.DB.prepare(
      `INSERT INTO ai_usage (at, model, input_tokens, output_tokens, image_count, est_cost_usd, latency_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(new Date().toISOString(), model.id, inTok, res.usage.output_tokens, images.length, cost, latency, status).run();
    logEvent("ai.test", { model: model.id, images: images.length, inTok, outTok: res.usage.output_tokens, costUsd: Number(cost.toFixed(5)), ms: latency, status });
    return json({ model: model.id, status, text, usage: { input: inTok, output: res.usage.output_tokens }, estCostUsd: cost, latencyMs: latency, monthSpentUsd: (spent?.s ?? 0) + cost, budgetUsd: budget });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const code = e instanceof Anthropic.APIError ? `anthropic_${e.status ?? "error"}` : "anthropic_request_failed";
    logEvent("ai.test", { model: model.id, images: images.length, ms: Date.now() - t0, status: code });
    throw new HttpError(502, code);
  }
}
