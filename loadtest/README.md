# Load test harness

Measures what hardware this app needs. It runs the **production image** under
container CPU/RAM limits that match common VPS sizes, against a seeded database,
and drives it with k6. Results feed the "Hardware requirements" section of the
main [README](../README.md).

Nothing external is touched: email goes to a Mailpit sink, the Nominatim
(Bundesland) worker has nothing to resolve because the seeder pre-fills `state`,
and the stack uses its own Docker volumes and throwaway secrets — never your real
`.env` or data.

## Requirements

Docker only. k6 and Mailpit run as containers.

## Quick start

```bash
./loadtest/gen-env.sh                     # throwaway secrets -> loadtest/.env.loadtest (gitignored)
./loadtest/run-matrix.sh                  # full matrix, ~2.5 h
bun loadtest/summarize.js loadtest/results/<date>   # markdown tables
```

Single run instead of the matrix:

```bash
cd loadtest
docker compose run --rm --no-deps -T app sh -c "bun db/setup.js && bun loadtest/seed-bulk.js 10000"
APP_CPUS=1 APP_MEM=1g docker compose up -d app mailpit
docker compose --profile k6 run --rm k6 run /scripts/visitors.js
```

The app is on <http://127.0.0.1:3900>, the Mailpit inbox on <http://127.0.0.1:3901>.

## What is simulated

| Script | Models |
| --- | --- |
| `k6/visitors.js` | Open tabs. Every visible tab polls `/api/stats` + `/api/signers` every 10 s, so one tab = 0.1 requests-pairs/s; the scenario drives that arrival rate and labels each step with the equivalent tab count (50 → 4000). 10 % of ticks are a fresh page load instead (HTML + JS/CSS bundle + session token + stats, signers, zoom count, KV and occupation lists). `MIX=1` adds sign-ups and signer searches on top. |
| `k6/signup.js` | Sign-up bursts: `POST /api/sign` at 1 → 50/s. Each one does a DB upsert, an unsubscribe-token update, a template render (with a full-table newsletter stats query), CSS inlining and an SMTP send. |
| `seed-bulk.js` | N signers, ~95 % verified, ~70 % newsletter, 85 % with a Kreisverband, `state` pre-filled. |

Each virtual client sends its own `X-Real-IP` (the app runs with
`TRUST_PROXY=true`, as behind Dokploy's proxy), so the per-IP rate limits in
`server/ratelimit.js` behave as they would for many separate people rather than
throttling the whole test to one IP.

## Knobs

| Env | Default | Meaning |
| --- | --- | --- |
| `DATASETS` | `1000 10000 100000` | signer counts to test |
| `TIERS` | `0.5:512m 1:1g 2:2g 4:4g` | `cpus:memory` per run |
| `SCENARIOS` | `visitors signup` | add `mixed` for the viral case |
| `TABS` / `HOLD` / `RAMP` | `50,…,4000` / `60` / `10` | visitor steps (seconds) |
| `RATES` | `1,5,10,25,50` | sign-ups per second |
| `DATABASE_JOURNAL_MODE` | `DELETE` | set `WAL` to compare |
| `APP_CPUS` / `APP_MEM` | `1` / `1g` | limits for a manual run |

A run stops early once p95 latency passes 3 s or the error rate passes 20 % —
the tier has found its ceiling and later steps only make it worse.

## Reading the output

`results/<date>/raw/` holds, per run: the k6 summary JSON (with per-step
sub-metrics), the k6 log, a 2-second CPU/RSS sample CSV, the app log, and a
`.meta` file recording whether the container was OOM-killed or restarted.
`summarize.js` turns those into the tables used in the main README.

## Caveat

Runs on Apple Silicon are faster per core than a typical shared x86 VPS vCPU, and
`cpus=1` in Docker is a smoother CPU quota than a noisy-neighbour shared vCPU.
Treat the measured numbers as an optimistic bound and keep headroom.
