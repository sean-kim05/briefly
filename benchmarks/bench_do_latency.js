// Durable Object read latency benchmark.
//
// Isolates the persistence layer: seed one user with 7 standups, then issue
// 100 serial GET /api/history/:userId calls and measure each. No LLM in this
// path — just Worker → Durable Object storage → JSON.
//
// Useful as a baseline: "what's the per-request floor when no model is in
// the loop?" Compare against TTFT/weekly numbers to see how much of those
// latencies are model vs platform.

import { newUserId, stats, logProgress, streamStandup, deleteAllEntries, writeJson, API } from './_common.js';

const READS = 100;
const SEED_COUNT = 7;
const OUT = new URL('./results/do_latency.json', import.meta.url).pathname;

const SEED = 'short standup, fixed a bug and shipped a feature, no blockers';

async function main() {
  const startedAt = new Date().toISOString();
  const userId = newUserId('do');
  logProgress(`seeding ${SEED_COUNT} standups for ${userId} ...`);
  for (let i = 0; i < SEED_COUNT; i++) {
    const r = await streamStandup(userId, SEED);
    if (!r.ok) throw new Error(`seed ${i} failed status=${r.status}`);
  }
  logProgress('seed done; one warm-up read ...');
  await fetch(API.history(userId));

  logProgress(`running ${READS} serial GET /api/history reads ...`);
  const samples = [];
  let errors = 0;
  let lastSize = null;
  for (let i = 1; i <= READS; i++) {
    const t0 = performance.now();
    const res = await fetch(API.history(userId));
    if (!res.ok) {
      errors++;
      logProgress(`  read ${i} ERROR status=${res.status}`);
      continue;
    }
    const body = await res.text();
    const t = performance.now() - t0;
    samples.push(t);
    if (lastSize === null) lastSize = body.length;
    if (i === 1 || i % 20 === 0 || i === READS) {
      logProgress(`  read ${i}/${READS} — ${t.toFixed(0)}ms (body=${body.length}B)`);
    }
  }

  logProgress('cleaning up ...');
  const cleanup = await deleteAllEntries(userId);
  logProgress(`deleted ${cleanup.deleted} entries`);

  const finishedAt = new Date().toISOString();
  const summary = {
    host: 'https://cf-ai-standup.skim8705.workers.dev',
    startedAt,
    finishedAt,
    reads: READS,
    seed_entries: SEED_COUNT,
    response_body_bytes: lastSize,
    successful: samples.length,
    errors,
    stats: stats(samples),
    cleanup_deleted: cleanup.deleted,
  };

  console.log();
  console.log(`Durable Object GET /api/history latency (n=${samples.length}/${READS}):`);
  console.log(`  mean: ${summary.stats.mean_ms.toFixed(1)} ms`);
  console.log(`  p50 : ${summary.stats.p50_ms.toFixed(1)} ms`);
  console.log(`  p95 : ${summary.stats.p95_ms.toFixed(1)} ms`);
  console.log(`  p99 : ${summary.stats.p99_ms.toFixed(1)} ms`);
  console.log(`  min : ${summary.stats.min_ms.toFixed(1)} ms`);
  console.log(`  max : ${summary.stats.max_ms.toFixed(1)} ms`);
  console.log();

  await writeJson(OUT, summary);
  logProgress(`saved ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
