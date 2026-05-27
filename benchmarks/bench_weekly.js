// Weekly summary benchmark: chained 2nd LLM call over 7 standups.
//
// Each run uses a fresh userId so the worker can't reuse any cached state.
// We first seed 7 daily standups (each is its own SSE call), then time the
// non-streaming POST /api/weekly/:userId which:
//   1. Reads the 7 entries from the Durable Object
//   2. Constructs a long prompt and calls Llama 3.3 (non-stream)
//   3. Returns the summary as JSON
//
// Total per run ≈ 7×(standup ~2-3s) + weekly_summary ≈ 20-30s.

import { newUserId, stats, logProgress, streamStandup, deleteAllEntries, writeJson, API } from './_common.js';

const RUNS = 15;
const STANDUPS_PER_USER = 7;
const OUT = new URL('./results/weekly.json', import.meta.url).pathname;

const SEED_MESSAGES = [
  'Finished the auth refactor PR. Today reviewing payments integration tests. No blockers.',
  'Reviewed payments tests, merged. Working on session timeout fix today. Waiting on legal review for cookies banner.',
  'Shipped session timeout fix. Pairing on the search redesign with Maya. No blockers.',
  'Got search redesign close to done. Today writing integration tests for the new search. Staging DB flaky.',
  'Search redesign merged. Today scoping rate-limit work for public API. Need security sign-off for prod.',
  'Drafted rate-limit RFC. Today implementing token bucket. No blockers right now.',
  'Token bucket implemented and unit tested. Today wiring it into the API gateway. Need ops review.',
];

async function seedUser(userId) {
  for (let i = 0; i < STANDUPS_PER_USER; i++) {
    const r = await streamStandup(userId, SEED_MESSAGES[i]);
    if (!r.ok) throw new Error(`seed ${i} failed status=${r.status}`);
  }
}

async function timeWeekly(userId) {
  const t0 = performance.now();
  const res = await fetch(API.weekly(userId), { method: 'POST' });
  const body = await res.text();
  const t = performance.now() - t0;
  if (!res.ok) return { ok: false, ms: t, status: res.status, body: body.slice(0, 200) };
  return { ok: true, ms: t, bodyLen: body.length };
}

async function main() {
  const startedAt = new Date().toISOString();
  const samples = [];
  const errors = [];
  const createdUsers = [];

  for (let i = 1; i <= RUNS; i++) {
    const userId = newUserId('weekly');
    createdUsers.push(userId);
    logProgress(`run ${i}/${RUNS} — seeding ${STANDUPS_PER_USER} standups for ${userId} ...`);
    try {
      await seedUser(userId);
    } catch (e) {
      logProgress(`  seed failed: ${e.message}`);
      errors.push({ run: i, phase: 'seed', error: String(e) });
      continue;
    }
    logProgress(`  calling /api/weekly ...`);
    const r = await timeWeekly(userId);
    if (!r.ok) {
      logProgress(`  weekly failed status=${r.status}`);
      errors.push({ run: i, phase: 'weekly', status: r.status, body: r.body });
      continue;
    }
    samples.push(r.ms);
    if (i === 1 || i % 5 === 0 || i === RUNS) {
      logProgress(`  run ${i}/${RUNS} — weekly ${(r.ms/1000).toFixed(2)}s (body=${r.bodyLen}B)`);
    }
  }

  logProgress('cleaning up created users ...');
  let totalDeleted = 0;
  for (const uid of createdUsers) {
    const c = await deleteAllEntries(uid);
    totalDeleted += c.deleted;
  }
  logProgress(`deleted ${totalDeleted} entries across ${createdUsers.length} users`);

  const finishedAt = new Date().toISOString();
  const summary = {
    host: 'https://cf-ai-standup.skim8705.workers.dev',
    startedAt,
    finishedAt,
    runs: RUNS,
    standups_per_user: STANDUPS_PER_USER,
    successful: samples.length,
    errors,
    stats: stats(samples),
    cleanup_total_deleted: totalDeleted,
  };

  console.log();
  console.log(`Weekly summary latency (n=${samples.length}/${RUNS}):`);
  console.log(`  mean: ${(summary.stats.mean_ms / 1000).toFixed(2)} s`);
  console.log(`  p50 : ${(summary.stats.p50_ms / 1000).toFixed(2)} s`);
  console.log(`  p95 : ${(summary.stats.p95_ms / 1000).toFixed(2)} s`);
  console.log(`  p99 : ${(summary.stats.p99_ms / 1000).toFixed(2)} s`);
  console.log(`  min : ${(summary.stats.min_ms / 1000).toFixed(2)} s`);
  console.log(`  max : ${(summary.stats.max_ms / 1000).toFixed(2)} s`);
  console.log();

  await writeJson(OUT, summary);
  logProgress(`saved ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
