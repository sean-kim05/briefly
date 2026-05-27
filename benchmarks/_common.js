// Shared helpers for the cf_ai_standup benchmark scripts.
// Built-in fetch only; no external deps.

const HOST = 'https://cf-ai-standup.skim8705.workers.dev';

export const API = {
  host: HOST,
  standup: () => `${HOST}/api/standup`,
  history: (userId) => `${HOST}/api/history/${encodeURIComponent(userId)}`,
  weekly: (userId) => `${HOST}/api/weekly/${encodeURIComponent(userId)}`,
  deleteEntry: (userId, idx) => `${HOST}/api/standup/${encodeURIComponent(userId)}/${idx}`,
};

export function newUserId(label = 'bench') {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function stats(samplesMs) {
  if (!samplesMs.length) return { count: 0 };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    mean_ms: +(sum / sorted.length).toFixed(2),
    p50_ms: +pct(50).toFixed(2),
    p95_ms: +pct(95).toFixed(2),
    p99_ms: +pct(99).toFixed(2),
    min_ms: +sorted[0].toFixed(2),
    max_ms: +sorted[sorted.length - 1].toFixed(2),
  };
}

export function logProgress(msg) {
  const t = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[${t}] ${msg}\n`);
}

// POST /api/standup and consume the SSE stream.
// Returns { ttftMs, totalMs, fullResponse, ok } — ttftMs is time-to-first
// non-empty `response` token; totalMs is full body received.
export async function streamStandup(userId, message, format = 'standard') {
  const t0 = performance.now();
  const res = await fetch(API.standup(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, message, format }),
  });
  if (!res.ok || !res.body) {
    return { ok: false, status: res.status, ttftMs: null, totalMs: performance.now() - t0 };
  }

  let ttftMs = null;
  let fullResponse = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data: ')) continue;
      if (line.includes('[DONE]')) continue;
      let payload;
      try { payload = JSON.parse(line.slice(6)); } catch { continue; }
      if (payload && typeof payload.response === 'string' && payload.response.length > 0) {
        if (ttftMs === null) ttftMs = performance.now() - t0;
        fullResponse += payload.response;
      }
    }
  }
  const totalMs = performance.now() - t0;
  return { ok: true, ttftMs, totalMs, fullResponse };
}

export async function deleteAllEntries(userId) {
  try {
    const res = await fetch(API.history(userId));
    if (!res.ok) return { ok: false, deleted: 0 };
    const hist = await res.json();
    const n = Array.isArray(hist) ? hist.length : 0;
    // Delete from highest index downward so earlier indices stay stable.
    for (let i = n - 1; i >= 0; i--) {
      await fetch(API.deleteEntry(userId, i), { method: 'DELETE' });
    }
    return { ok: true, deleted: n };
  } catch (e) {
    return { ok: false, deleted: 0, error: String(e) };
  }
}

export async function writeJson(path, data) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

export const MESSAGES = {
  short: 'fixed login bug, working on deploy',
  medium: 'Wrapped up the auth refactor and reviewed Maya\'s PR for the search redesign. ' +
          'Today I\'m diving into the websocket reconnection logic and pairing with Ben after lunch ' +
          'on the new metrics dashboard. No blockers right now.',
  long:   'Yesterday was mostly cleanup: I shipped the auth refactor we discussed last week, paired ' +
          'with Maya on the search redesign PR and got it merged after we sorted out the index ' +
          'ranking issue, then spent the afternoon chasing a memory leak in the worker pool that ' +
          'turned out to be an unbounded cache. Closed three older tickets in the process. Today I ' +
          'want to finish the websocket reconnection logic that\'s been half-done for a week, write ' +
          'tests for the new metrics dashboard before Ben finishes the UI, and start scoping the ' +
          'rate-limiting work for the public API since support keeps pinging us about abuse. ' +
          'Blockers: still waiting on the security review for the auth changes before we can ' +
          'enable them in prod, and the staging database is acting weird so any integration ' +
          'tests are flaky right now.',
};
