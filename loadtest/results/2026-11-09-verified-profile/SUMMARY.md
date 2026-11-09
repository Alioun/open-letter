# Profiling run

Diagnostic only. CPU profiling was enabled. Exclude these timings from hardware comparisons.

Measured 2026-11-09T15:07:57.517Z. 100,000 seeded signers, 100 equivalent polling tabs, and 1 signature submission per second. Each run holds the workload for 30 seconds. Values show median [minimum, maximum] across all available measurements, including failed runs. Startup failures have no latency measurement.

| App quota | Passed | Visitor p95, ms | Signup p95, ms | Admin p95, ms | Peak container memory, MiB | Startup, s | Queue drain after load, s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1:512m | 1/1 | 2.9 [2.9, 2.9] | 119.4 [119.4, 119.4] | 665.9 [665.9, 665.9] | 152.1 [152.1, 152.1] | 8.0 [8.0, 8.0] | 10.6 [10.6, 10.6] |

| App quota | Requests / HTTP failures | Dropped iterations | Persisted signatures | Mail accepted | Page views / expected | Peak generator CPU, percent of one core |
| --- | --- | --- | --- | --- | --- | --- |
| 1:512m | 1125 / 0 | 0 | 31 | 41 | 31 / 31 | 7.3 [7.3, 7.3] |

| App quota | Mean app CPU, percent of one core | CPU throttled during load, ms | Peak cgroup memory charge, MiB |
| --- | --- | --- | --- |
| 1:512m | 14.2 [14.2, 14.2] | 0.0 [0.0, 0.0] | 265.2 [265.2, 265.2] |

An equivalent tab polls twice every ten seconds. Ten percent of ticks fetch the document, its linked bundles and public data. Each run adds signatures, one search per second, five admin reads every five seconds, built-in statistics, and a ten-recipient campaign. HTTP signup timing ends at the durable enqueue. Queue drain timing continues until all expected mail is accepted by the local TLS server.

Passing requires k6 thresholds and checks, no dropped iterations, matching signer/mail/page-view counts, ten completed campaign deliveries, no pending or dead email jobs, and no app OOM or restarts. Container memory is Docker's sampled working set, not process RSS. The cgroup peak records the highest total memory charge, including cache and startup, without sampling. The generator and Mailpit run outside the app quota.
