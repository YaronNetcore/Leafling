# AI performance — measurements (2026-10-02)

What is measured where. **Real Claude latency is only in section 1** (production metadata, no content).
Sections 2–3 are local measurements with a MOCKED model; they show Leafling's own overhead, not Claude's speed.

## 1. Production baseline before this update (real Claude, from `user_ai_usage`, metadata only)
| Feature (old, non-streaming) | Calls | Output tokens | Time until ANY text was visible (= total) |
|---|---|---|---|
| AI Botanist "ask" (report) | 1 | 894 | 17.0 s |
| Identification (1 photo) | 5 | 1,153–1,381 | 20.4–28.6 s |

Main latency source: the model generating long structured JSON (≈ 1,000+ output tokens) before anything was shown.
Changes made from this: chat answers are **streamed** (text appears at the first token), thinking off + effort
low + short-answer instructions for chat (≤ 1024 tokens), and identify/diagnose (still structured, validated)
are asked for brief fields. The new path records `first_token_ms` per call; the first signed-in chat after
deploy will give the real "after" numbers via `npm run verify:live` — **not measured yet** (Access requires a
signed-in browser; this environment has none).

## 2. Local pipeline with a mocked streaming model (0.8 s to first token, ~2 s total), DevTools "Slow 4G" (150 ms RTT, 1.6/0.75 Mbps)
Headless Chromium at iPhone size, production build, real Worker (Miniflare) + local D1/R2. Times in ms.
| Case | Images | Image prep | First byte | First visible text | Total | Context DB | Persist user msg | Prompt chars |
|---|---|---|---|---|---|---|---|---|
| A simple text question | 0 | 0 | 168 | 845 | 2015 | 3 | 8 | 1044 |
| B follow-up | 0 | 0 | 161 | 842 | 2016 | 3 | 11 | 665 |
| C message with a new 12 MP photo | 1 | 631 | 1436 | 2154 | 3323 | 6 | 17 | 910 |
| E history-heavy question | 0 | 0 | 169 | 853 | 2030 | 2 | 10 | 1134 |

Reading: Leafling's own overhead before the model starts is ≈ 40–60 ms on top of network latency; first visible text ≈
model first-token time + ~45 ms. A new 12 MP photo adds ≈ 0.6 s downsizing (desktop CPU; an iPhone may differ)
and ≈ 0.8 s upload on Slow 4G (≈ 320 KB). Case D (identification) is unchanged in architecture (structured, not
streamed) — see section 1 for its real cost.

## 3. Context size before vs after (same 60-event plant, local D1)
| Question type | Old context (chars) | New context (chars) | Smaller by | Sequential DB round trips |
|---|---|---|---|---|
| watering | 4255 | 1915 | 55% | 6 → 1 |
| propagation | 4255 | 1737 | 59% | 6 → 1 |
| health | 4255 | 1860 | 56% | 6 → 1 |
| general | 4255 | 1591 | 63% | 6 → 1 |

Old: every question got the plant + up to 40 events of any type + all fields, in 6 sequential queries.
New: one D1 batch; only the sections the question needs; history bounded to 8 messages + a short list of earlier questions.
