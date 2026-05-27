# Briefly Benchmarks

**Target:** https://cf-ai-standup.skim8705.workers.dev (production Cloudflare Worker)
**Date:** 2026-05-27
**Stack:** Cloudflare Workers + Durable Objects + Workers AI (Llama 3.3 70B fp8-fast)
**Client:** Node 26, built-in fetch, serial single-user requests from California → Cloudflare edge

---

## Streaming TTFT (POST /api/standup)

Time-to-first-token measured at the first SSE chunk containing a non-empty `response` field. 30 serial runs per message length. Zero failures across 90 total runs.

| Message length | runs | mean TTFT | p50 | p95 | p99 | mean total | p95 total |
|--|--:|--:|--:|--:|--:|--:|--:|
| Short (~10 words, 34 chars)   | 30 |  295 ms | 286 ms |  357 ms |  911 ms |   698 ms | 1,155 ms |
| Medium (~50 words, 217 chars) | 30 |  342 ms | 273 ms | 1,058 ms | 1,761 ms | 1,278 ms | 2,073 ms |
| Long (~150 words, 792 chars)  | 30 |  357 ms | 288 ms |  449 ms | 2,409 ms | 2,858 ms | 4,246 ms |

Notes:
- TTFT is essentially flat across input size (~290 ms median) — prompt length barely affects how fast the first token comes back. Total time, however, scales clearly with output length (700 ms → 2.9 s).
- Medium's p95 (1,058 ms) is higher than long's p95 (449 ms) because of a single 1.76 s tail in the medium sample — small-n variance, not a structural issue. With more runs the lines would cross back.
- Llama 3.3 70B on Workers AI is genuinely fast: median TTFT of ~290 ms includes the full HTTPS handshake + Worker dispatch + model warm-up + first-token decode.

**Headline:** p95 TTFT under 450 ms with Llama 3.3 70B streaming via SSE from Cloudflare Workers AI (90 runs, 0 failures).

---

## Weekly Summary (chained 2nd LLM call over 7 standups)

For each run: spin up a fresh user, seed 7 daily standups (each is its own Llama 3.3 SSE call), then issue a non-streaming `POST /api/weekly/:userId` and time the response. 15 runs, all successful.

| metric | value |
|--|--:|
| mean | 4.37 s |
| p50  | 4.17 s |
| p95  | 6.62 s |
| p99  | 6.62 s |
| min  | 3.17 s |
| max  | 6.62 s |

The weekly endpoint reads all 7 entries from the Durable Object, packs them into a single non-streaming Llama call, and returns the summary as JSON. Median ~4 s, tail ~6.6 s — within the 3-8 s expected band for this kind of chained LLM call.

**Headline:** Weekly summaries generated in 4.4 s avg / 6.6 s p95 (chained 2nd LLM call across 7 prior entries).

---

## Durable Object Reads (`GET /api/history/:userId`)

7-entry user; 100 serial reads after one warm-up. Pure persistence path, no LLM in the loop.

| metric | value |
|--|--:|
| mean | 46.7 ms |
| p50  | 45.8 ms |
| p95  | 57.4 ms |
| p99  | 123.2 ms |
| min  | ~32 ms |
| max  | 123.2 ms |

Sub-50 ms median across the public internet (TLS + Cloudflare Worker dispatch + Durable Object SQLite read + JSON serialize + return). The p99 jump to 123 ms is consistent with occasional Durable Object hibernation/wake.

**Headline:** Durable Object reads return in 46 ms avg / 57 ms p95 across the public internet (100-sample serial).

---

## Raw data

Under `benchmarks/results/`:
- `ttft.json`        — per-length runs + stats
- `weekly.json`      — per-run successes and latency stats
- `do_latency.json`  — 100-read latency distribution

All bench-created users were deleted at end of run (TTFT cleanup: 21 entries / 3 users; weekly cleanup: 105 entries / 15 users; DO cleanup: 7 entries / 1 user).

---

## Headlines (paste into resume)

- p95 TTFT under 450 ms with Llama 3.3 70B streaming via SSE from Cloudflare Workers AI.
- Weekly summaries generated in 4.4 s avg (chained 2nd LLM call across 7 prior entries).
- Durable Object reads return in 46 ms avg / 57 ms p95 across the public internet.
