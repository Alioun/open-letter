# Dependency upgrade and measurement notes

All direct production dependencies, development dependencies, and existing overrides were checked against the npm `latest` tag on 9 November 2026. Prereleases were excluded. [The recorded registry responses](dependency-releases.json) include packages that already used the latest stable version.

## Changed versions

| Package                    | Previous | Updated        |
| -------------------------- | -------- | -------------- |
| React and React DOM        | 18.3.1   | 19.3.1         |
| Juice                      | 11.1.1   | 12.2.1         |
| Nodemailer                 | 9.1.1    | 10.4.0         |
| Postgres                   | 3.4.9    | 4.1.0          |
| Analytik                   | 1.19.0   | 1.22.0         |
| JOSE                       | 6.2.12   | 6.2.16         |
| react-day-picker           | 10.0.1   | 10.0.2         |
| Puppeteer                  | 25.11.0  | 25.16.0        |
| Undici override            | 6.28.0   | 8.12.4         |
| prosemirror-model override | 1.25.12  | 1.25.13        |
| fflate used by Satori      | 0.7.3    | 0.8.3 override |

The fflate override removes the remaining reported vulnerability. Bun and the production and development base images use 1.4.4. Docker dependency installation uses the frozen lockfile. The server replaces the startup shell with `exec`, so container shutdown reaches Bun.

## Verification

The final application source passed 258 tests across 31 files, with 2,086 assertions and no failures. The disposable production publishing check passed publication changes, revisions, rejected CSS, metadata, immutable assets, isolated previews, restart recovery, and the absence of visitor-time content and template queries.

A separate migration from disposable PostgreSQL 18 into encrypted SQLite passed with Postgres 4. It preserved row counts, IDs, references, timestamps, booleans, and recipient arrays. Satori rendered with the fflate override. The [npm advisory check](security-audit.json) covered all 301 resolved package versions across 273 package names and reported no known vulnerabilities. A frozen-lockfile install succeeded.

The local `raw/verification-*.log` files retain the test, publishing, and migration output. They are ignored by Git. `environment.json` records the production image ID and dependency manifest used for the measurements.

## Database changes found by the workload

Concurrent Honker claims and writes exposed unfinished SQLite cursors. Serializing each driver handle and consuming single-row query results through `SQLITE_DONE` removed the reproduced claim failures.

A second reproduction showed one connection committing between another connection's read and write in a transaction. That invalidated the reader's WAL snapshot. The SQLCipher adapter now holds one operation queue per normalized database path across complete transaction callbacks. Connections in the same process share that queue. The reproduction now commits both rows, and a regression test covers it. Compose uses WAL, matching the adapter default.

These changes prevent the observed cursor and snapshot failures. They do not remove SQLite's single-writer constraint or coordinate separate server processes. Production supports one app process per database file.

## Workloads and limits

The [256 MiB comparison](../2026-11-09-current/SUMMARY.md) used 1,000 equivalent polling tabs. Each CPU setting had five runs. Both had startup out-of-memory failures; surviving runs missed latency or completed-work checks. These results do not support a 256 MiB app limit.

A separate [SQL timing run](../2026-11-09-sql-trace/runs.json) at one CPU and 1 GiB also lost analytics events at 1,000 equivalent tabs. Its timings include instrumentation and are excluded from the repeated comparison. Some native commits exceeded 100 ms. A [diagnostic storage probe](../2026-11-09-sql-trace/storage-probe.json) measured about 42 ms for a 4 KiB write followed by `fdatasync` on a fresh Docker volume. This is storage latency, not application throughput. The host uses WSL2 and ext4 on a virtual disk.

The repeated 512 MiB comparison therefore measures a separate workload of 100 equivalent polling tabs. It retains one signature and one search per second, five admin reads every five seconds, built-in analytics, and a ten-recipient campaign. Each run holds traffic for 60 seconds, then verifies queue completion. The latency thresholds and correctness checks are unchanged. Every successful document request must appear in analytics. The application keeps its existing durability settings.

Five runs per CPU setting alternate on the same host, restoring the same 100,000-signer snapshot before each run. Builds, tests, and profilers do not run during this comparison. Other project containers remain running and are outside the app quota. Per-run host load, app and generator samples, cgroup CPU counters, memory limits, and peak memory charge are retained.

This is a fixed offered workload. It establishes neither maximum throughput nor a long-term soak result. HTTP clients do not execute the browser application. Signatures are submitted but not confirmed. Email acceptance is checked against authenticated TLS Mailpit, not an external provider or inbox. Backup overlap, image uploads, and simultaneous publication are outside the measured workload.

## Final result

All ten 512 MiB runs completed the work checks with no HTTP failures or dropped iterations. They persisted 609 signatures, recorded all 608 expected page views, and accepted 709 emails, including 100 campaign deliveries. All queues drained, delivery records matched, and no app OOM or restart occurred.

One of five half-CPU runs and two of five one-CPU runs met every benchmark threshold. The other seven missed only the admin p95 target. The median admin p95 was 1,308.6 ms at half a CPU and 1,000.6 ms at one CPU. No tested quota met every target consistently.

The highest cgroup memory charge was 268.2 MiB, including startup, cache, and verification helpers. The largest sampled Docker working set was 165.5 MiB. These are container measurements, not whole-VPS requirements or process RSS. Start with one vCPU and 1 GB of system RAM, reserve at least 512 MiB for the app, and verify latency on the intended SSD.
