// Streaming TTFT benchmark for POST /api/standup.
//
// Measures: time-to-first-token from the SSE stream produced by Workers AI
// (Llama 3.3 70B fp8-fast) wrapped behind the Cloudflare Worker.
//
// Why TTFT: for a streaming chat-ish endpoint, TTFT is the latency the user
// actually feels — total stream time scales with output length and is mostly
// model-limited.
//
// Sweeps three message lengths (10 / ~50 / ~150 words). 30 runs each, serial
// (parallel hits trigger Workers AI rate limiting and skew the result).

import { newUserId, stats, logProgress, streamStandup, deleteAllEntries, writeJson, MESSAGES } from './_common.js';

const RUNS_PER_LENGTH = 30;
const OUT = new URL('./results/ttft.json', import.meta.url).pathname;

async function runForLength(label, message) {
  const userId = newUserId(`ttft_${label}`);
  const ttfts = [];
  const totals = [];
  let errors = 0;
  logProgress(`=== ${label} (${message.length} chars) → userId=${userId} ===`);

  for (let i = 1; i <= RUNS_PER_LENGTH; i++) {
    const r = await streamStandup(userId, message);
    if (!r.ok || r.ttftMs === null) {
      errors++;
      logProgress(`  run ${i}/${RUNS_PER_LENGTH} ERROR status=${r.status ?? '?'}`);
      continue;
    }
    ttfts.push(r.ttftMs);
    totals.push(r.totalMs);
    if (i === 1 || i % 5 === 0 || i === RUNS_PER_LENGTH) {
      logProgress(`  run ${i}/${RUNS_PER_LENGTH} — TTFT ${r.ttftMs.toFixed(0)}ms  total ${r.totalMs.toFixed(0)}ms`);
    }
  }

  logProgress(`  cleaning up ${label} userId ...`);
  const cleanup = await deleteAllEntries(userId);
  logProgress(`  deleted ${cleanup.deleted} entries`);

  return {
    label,
    message_chars: message.length,
    runs: RUNS_PER_LENGTH,
    errors,
    userId,
    cleanup_deleted: cleanup.deleted,
    ttft: stats(ttfts),
    total: stats(totals),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const [label, msg] of Object.entries(MESSAGES)) {
    try {
      results.push(await runForLength(label, msg));
    } catch (e) {
      logProgress(`length=${label} failed: ${e.message}`);
      results.push({ label, error: String(e) });
    }
  }

  const finishedAt = new Date().toISOString();

  console.log();
  console.log('length     | runs |  mean TTFT |   p50  |   p95  |   p99  | mean total |  p95 total');
  console.log('-----------|------|------------|--------|--------|--------|------------|------------');
  for (const r of results) {
    if (r.error) {
      console.log(`${r.label.padEnd(10)} | ERROR: ${r.error}`);
      continue;
    }
    console.log(
      `${r.label.padEnd(10)} | ${String(r.runs - r.errors).padStart(4)} | ` +
      `${r.ttft.mean_ms.toFixed(0).padStart(8)}ms | ${r.ttft.p50_ms.toFixed(0).padStart(4)}ms | ` +
      `${r.ttft.p95_ms.toFixed(0).padStart(4)}ms | ${r.ttft.p99_ms.toFixed(0).padStart(4)}ms | ` +
      `${r.total.mean_ms.toFixed(0).padStart(8)}ms | ${r.total.p95_ms.toFixed(0).padStart(8)}ms`
    );
  }
  console.log();

  await writeJson(OUT, { host: 'https://cf-ai-standup.skim8705.workers.dev', startedAt, finishedAt, runs_per_length: RUNS_PER_LENGTH, results });
  logProgress(`saved ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
