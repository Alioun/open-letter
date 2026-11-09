# Run the hardware tests

Use these tests to measure the current production image under Docker CPU and memory limits. The [hardware guide](../docs/hardware.md) links the recorded results.

The stack has its own Compose project, generated secrets, and volumes. It does not use the deployed database or `.env`. Mailpit accepts mail only for `@load.test` addresses, requires TLS and authentication, and has no relay. The application trusts only the generated test certificate in addition to its normal certificate authorities.

## Measure the current workload

Install Bun 1.4.4, Docker, and OpenSSL. The runner reads Linux cgroup v2 counters inside the app container. From the repository root, run:

```bash
./loadtest/gen-env.sh
bun loadtest/run-current.js
bun loadtest/summarize-current.js loadtest/results/<date>-current
```

The runner builds the production image, seeds 100,000 signers, and alternates five runs of each quota. Each run restores the same seeded database and starts a fresh app container. It checks the applied CPU, memory, and swap limits before sending traffic. The runner warms admin aggregates before measuring steady traffic and records startup separately. Cleanup removes only the project's own containers and volumes, including on a failed check.

The default workload lasts 60 seconds per run. It combines:

- 1,000 equivalent polling tabs. Each tab polls `/api/stats` and `/api/signers` every ten seconds. Ten percent of ticks fetch the public document, its linked JavaScript and CSS, and public data.
- One signature submission and one signer search per second.
- Five authenticated admin reads every five seconds, covering statistics, campaigns, email diagnostics, public totals, and the current publication.
- Built-in statistics collection and a ten-recipient campaign sent during the workload.

These are HTTP clients. They do not execute the browser application or measure rendering, open connections, or people reading the letter. The example letter has regional fields and Zoom disabled. Its optional endpoints are skipped.

A run passes only when:

- Every response check passes, HTTP failures stay below 1%, and k6 drops no scheduled iterations.
- Visitor p95 stays below 500 ms. Signature, search, and admin p95 stay below 1,000 ms.
- Every accepted signature exists in the encrypted database.
- Every successful eligible document request appears in analytics.
- The campaign completes all ten deliveries. Mailpit's accepted-message count matches the signature and campaign counts, and the delivery records agree.
- No email job remains pending or dead, and the app has no out-of-memory termination or restart.

Signature HTTP latency ends when the app stores the record and queues its email. The runner continues checking mail after traffic stops, for up to four minutes. That additional time appears as queue-drain time. Mailpit acceptance verifies local SMTP delivery. It does not measure an external provider, spam filtering, or inbox arrival.

The app opens at <http://127.0.0.1:3900> and Mailpit at <http://127.0.0.1:3901> during a run. Both ports bind only to loopback.

## Change the workload

Pass settings as environment variables:

| Variable                | Default                     | Meaning                                                                                                                           |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `DATASET`               | `100000`                    | Seeded signer count.                                                                                                              |
| `TIERS`                 | `0.5:512m 1:1g`             | App CPU and memory quotas. Swap is disabled.                                                                                      |
| `REPEATS`               | `5`                         | Runs per quota, alternating between quotas.                                                                                       |
| `HOLD`                  | `60`                        | Workload duration in seconds.                                                                                                     |
| `TABS`                  | `1000`                      | Equivalent polling tabs. Use a multiple of ten.                                                                                   |
| `SIGNUP_RATE`           | `1`                         | Signature submissions per second.                                                                                                 |
| `OUT`                   | `results/<date>-current`    | Output directory relative to `loadtest`. Keep it under `results`.                                                                 |
| `DATABASE_JOURNAL_MODE` | `WAL`                       | SQLite journal mode. Production Compose also defaults to WAL.                                                                     |
| `LOADTEST_IMAGE`        | `openletter-loadtest:local` | Production image to build or run.                                                                                                 |
| `SKIP_BUILD`            | Unset                       | Set to `1` to reuse an image built from the intended source and lockfile.                                                         |
| `SEED_PATH`             | Unset                       | Existing encrypted seed under `loadtest/results`, relative to `loadtest`. Requires the same generated database key and `DATASET`. |
| `LOADTEST_PORT`         | `3900`                      | Loopback port for the app.                                                                                                        |
| `MAILPIT_PORT`          | `3901`                      | Loopback port for Mailpit.                                                                                                        |

For a short configuration check:

```bash
REPEATS=1 DATASET=1000 HOLD=10 TABS=100 TIERS='1:1g' \
  OUT=results/preflight bun loadtest/run-current.js
```

To repeat the [final November 2026 memory comparison](results/2026-11-09-verified-boundary/SUMMARY.md):

```bash
REPEATS=5 DATASET=100000 HOLD=60 TABS=100 TIERS='1:256m 1:512m' \
  OUT=results/verified-boundary bun loadtest/run-current.js
bun loadtest/summarize-current.js loadtest/results/verified-boundary
```

This comparison uses one CPU at both memory limits and alternates five runs of each. It follows the correctness and delivery fixes. The earlier 1,000-tab workload lost analytics events on this host before those fixes. The final comparison uses 100 tabs and retains the signature rate, campaign, admin reads, latency thresholds, and completion checks. The [hardware guide](../docs/hardware.md) explains the storage limit and the distinction between a working deployment and one that passes every latency target.

For an unreported profiling run:

```bash
PROFILE=1 REPEATS=1 HOLD=30 TIERS='1:1g' \
  OUT=results/profile bun loadtest/run-current.js
```

Profiling uses Bun's CPU profiler and writes its output beside the raw results. Keep profiled runs out of latency comparisons. The summary labels them as diagnostic runs. The [final-source profile](results/2026-11-09-verified-profile/NOTES.md) records a separate 30-second run and its limits.

The generated certificate expires after 30 days. To replace an expired certificate or an older setup without SMTP credentials, run `./loadtest/gen-env.sh --force`. This also rotates the test database key, so create a new seed afterward.

## Read the results

Each output directory contains:

- `claim.txt`, describing the workload and required evidence before measurement.
- `environment.json`, recording host CPUs, RAM, kernel, package versions, image ID, workload, and journal mode.
- `runs.json`, retaining pass or fail, actual quotas, startup time, queue-drain time, persisted counts, mail counts, cgroup peak memory charge, and container state.
- `raw/`, containing k6 summaries and logs, app and generator resource samples, application logs, and individual work checks.
- `report.json` and `SUMMARY.md`, generated by `summarize-current.js`, with medians and ranges for each quota.

Docker's sampled memory metric is the container working set, not process RSS. The cgroup peak also includes cache and captures startup peaks between samples. CPU percentages use one core as 100%. The app quota excludes the host OS, Mailpit, and k6. Check generator use and host load before interpreting a failed run as an app limit. A successful quota is a tested configuration, not a universal minimum or a capacity ceiling.

## Run the older staircase workloads

`run-matrix.sh` retains the historical public-read and signature-burst tests. It creates a separate Compose project for each invocation and records k6 exit codes. These tests check request latency. They do not perform the current runner's database, campaign, and completed-delivery checks.

```bash
DATASETS='1000 10000 100000' TIERS='0.5:512m 1:1g' \
  SCENARIOS='visitors signup mixed' ./loadtest/run-matrix.sh
bun loadtest/summarize.js loadtest/results/<date>
```

`TABS`, `RATES`, `HOLD`, `RAMP`, `LOAD_SHARE`, `SIGNUP_RATE`, and `SEARCH_RATE` change those scripts. The historical summaries define their original workloads and limits.
