# Hardware requirements

**The smallest VPS you can buy will do.** Measured on the production image under
container CPU/RAM limits, with the load-test harness in [`loadtest/`](../loadtest/):

| | verdict |
| --- | --- |
| **Recommended** | **1 vCPU / 1 GB**, e.g. Hetzner CX22. Comfortable headroom, room for the hourly backup and a campaign send to overlap with traffic. |
| **You can get away with** | **0.5 vCPU / 512 MB**: the smallest shared VPS. It served 100,000 signers and 8,000 simultaneously open tabs with a p95 of 1 ms, at half its CPU quota. |
| **Don't bother paying for** | **more cores.** They buy nothing: all database work runs on one shared SQLCipher connection, so a second core only idles. Spend on single-thread speed and disk instead. |
| **Watch instead** | **disk**, which is the one resource that actually grows (see below). |

## What was measured

Each step holds a fixed number of open tabs. Every visible tab polls
`/api/stats` + `/api/signers` every 10 s (so 8,000 tabs ≈ 2,800 req/s), 10 % of
ticks are a full page load, and the "mixed" runs add 2 sign-ups/s and 1 signer
search/s on top.

| signers | tier | max open tabs | p95 there | sign-ups/s | peak RSS |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 0.5 vCPU / 512 MB | ≥ 8,000 | 1 ms | ≥ 50 | 96 MB |
| 10,000 | 0.5 vCPU / 512 MB | ≥ 8,000 | 1 ms | ≥ 50 | 97 MB |
| 100,000 | 0.5 vCPU / 512 MB | ≥ 8,000 | 1 ms | ≥ 50 | 113 MB |

"≥" because nothing fell over: at 8,000 tabs the load generator (k6, sharing the
same machine) runs out of CPU before the server does, so that column is a floor,
not a ceiling. Sign-ups were capped at 50/s by the test, not by the server,
which also means a single IP's `POST /api/sign` limit of 30 per 15 minutes is a
far tighter constraint than any hardware limit here.

The 1 vCPU and 2 vCPU tiers were run too (1,000 and 10,000 signers) and are the
same or better; where they look worse at the top step it is the load generator
losing CPU to the bigger container, not the server. Given 0.5 vCPU already
clears every case, the larger tiers were not run against 100,000 signers.

## Disk

Disk is the resource that scales with success, mostly because of backups:
48 hourly snapshots are kept, and encrypted data does not compress.

| signers | database | one backup | 48 backups | total |
| --- | --- | --- | --- | --- |
| 1,000 | ~0.6 MB | ~0.5 MB | ~25 MB | negligible |
| 10,000 | ~5 MB | ~5 MB | ~230 MB | < 1 GB |
| 100,000 | ~56 MB | ~50 MB | ~2.4 GB | **~3 GB** |

Roughly **0.55 KB per signer** in the database, and about 48× that again in
retained backups. Budget 5 GB for a letter you expect to go big, or lower
`BACKUP_KEEP`. The default 20–40 GB on any entry VPS is plenty.

## Bandwidth

A first-time visitor downloads ~760 KB (HTML + JS + CSS bundle); returning
visitors and the 10-second polls cost a few KB each. `Bun.serve` does not
compress, so **enable gzip/brotli at the reverse proxy**; it cuts that first
load by roughly 4×. 10,000 first-time visitors ≈ 7.6 GB uncompressed, ≈ 2 GB
compressed; still inside any VPS traffic allowance.

## Why it is this cheap

Every database call goes through one shared SQLCipher connection, so the server
is effectively single-threaded at the database layer: one core does the work no
matter how many you buy. What matters instead is that no request does more work
than it has to:

- **Covering indexes** (`db/schema.sql`): every public read filters on
  `verified = 1 AND show_publicly = 1` and then needs one more column. Without
  that column in the index, SQLite fetched all ~95k matching rows from the table
  for it: the signer-list count took 632 ms and each GROUP BY endpoint ~710 ms.
  Covering them brought those to 8 ms and 5–36 ms.
- **A read cache with single-flight** (`server/cache.js`): at 1,000 open tabs
  the same aggregates were being computed ~200 times a second; now concurrent
  readers share one query. Writes drop the cache, so a confirmation is visible
  to the next read; sign-ups, which only write unverified rows, deliberately do
  not.
- **Search does the common case in SQL**: a substring match is a scan in C
  rather than 100k rows pulled into JS and scored there; the typo-tolerant
  fallback only runs when nothing matches at all.
- **Transactional email is a durable job** (Honker `emails` queue) instead of an
  inline provider round-trip inside `POST /api/sign`.

Before these, the same 100,000-signer database could not serve **50** open tabs
on any tier tested, up to 4 vCPU.

## Caveats

Runs were on Apple Silicon under Docker, which is faster per core than a typical
shared x86 vCPU, and a container CPU quota is smoother than a noisy neighbour.
Treat the numbers as an optimistic bound; the margin is large enough that the
conclusion holds anyway. To re-measure after changes, see
[`loadtest/README.md`](../loadtest/README.md).

