# cf_ai_standup benchmarks

Three Node scripts that hit the **deployed** Cloudflare Worker at
`https://cf-ai-standup.skim8705.workers.dev` and measure end-to-end latency.

Built-ins only (Node 18+ `fetch`); no external deps.

## Run

```bash
node benchmarks/bench_ttft.js         # ~6-8 min (30 runs × 3 message lengths)
node benchmarks/bench_weekly.js       # ~6-8 min (15 runs × 7 seed standups + weekly)
node benchmarks/bench_do_latency.js   # ~30 sec  (100 GET /api/history reads)
```

Each script:
- uses a fresh `bench_<timestamp>` userId per run so it never collides with real data
- writes a JSON report to `benchmarks/results/`
- cleans up its created entries via `DELETE /api/standup/:userId/:index`

See `RESULTS.md` for the headline numbers from the last run.

Do **not** point these at `wrangler dev` — Workers AI is proxied to remote
infrastructure in dev mode and the numbers don't reflect production.
