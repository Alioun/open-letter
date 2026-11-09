# Current workload results

Every run passed at 1:512m. These are tested quotas, not a universal minimum.

Measured 2026-11-09T15:10:52.912Z. 100,000 seeded signers, 100 equivalent polling tabs, and 1 signature submission per second. Each run holds the workload for 60 seconds. Values show median [minimum, maximum] across all available measurements, including failed runs. Startup failures have no latency measurement.

| App quota | Passed | Visitor p95, ms | Signup p95, ms | Admin p95, ms | Peak container memory, MiB | Startup, s | Queue drain after load, s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1:256m | 1/5 | 2.5 [2.5, 2.5] | 131.6 [131.6, 131.6] | 635.1 [635.1, 635.1] | 128.7 [105.9, 140.9] | 8.6 [8.6, 8.6] | 2.5 [2.5, 2.5] |
| 1:512m | 5/5 | 1.9 [1.8, 2.5] | 137.4 [118.3, 160.2] | 499.8 [400.2, 584.1] | 148.5 [139.4, 161.3] | 8.5 [4.6, 8.6] | 2.8 [2.3, 4.0] |

| App quota | Requests / HTTP failures | Dropped iterations | Persisted signatures | Mail accepted | Page views / expected | Peak generator CPU, percent of one core |
| --- | --- | --- | --- | --- | --- | --- |
| 1:256m | 1956 / 0 | 0 | 61 | 71 | 61 / 61 | 7.3 [7.3, 7.3] |
| 1:512m | 9740 / 0 | 0 | 305 | 355 | 304 / 304 | 7.6 [6.7, 8.4] |

| App quota | Mean app CPU, percent of one core | CPU throttled during load, ms | Peak cgroup memory charge, MiB |
| --- | --- | --- | --- |
| 1:256m | 15.5 [15.5, 15.5] | 0.0 [0.0, 0.0] | 255.1 [255.1, 255.1] |
| 1:512m | 13.4 [12.9, 14.3] | 0.0 [0.0, 9.2] | 259.9 [257.0, 266.4] |

An equivalent tab polls twice every ten seconds. Ten percent of ticks fetch the document, its linked bundles and public data. Each run adds signatures, one search per second, five admin reads every five seconds, built-in statistics, and a ten-recipient campaign. HTTP signup timing ends at the durable enqueue. Queue drain timing continues until all expected mail is accepted by the local TLS server.

Passing requires k6 thresholds and checks, no dropped iterations, matching signer/mail/page-view counts, ten completed campaign deliveries, no pending or dead email jobs, and no app OOM or restarts. Container memory is Docker's sampled working set, not process RSS. The cgroup peak records the highest total memory charge, including cache and startup, without sampling. The generator and Mailpit run outside the app quota.

- current-n100000-cpu1-mem256m-r1: Startup stopped: OOM=true, exit=137
- current-n100000-cpu1-mem256m-r3: Startup stopped: OOM=true, exit=137
- current-n100000-cpu1-mem256m-r4: Startup stopped: OOM=true, exit=137
- current-n100000-cpu1-mem256m-r5: Startup stopped: OOM=true, exit=137
