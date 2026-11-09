# Current workload results

No tested quota met every benchmark target in every run.

Measured 2026-11-09T14:25:52.245Z. 100,000 seeded signers, 100 equivalent polling tabs, and 1 signature submission per second. Each run holds the workload for 60 seconds. Values show median [minimum, maximum] across all available measurements, including failed runs. Startup failures have no latency measurement.

| App quota | Passed | Visitor p95, ms | Signup p95, ms | Admin p95, ms | Peak container memory, MiB | Startup, s | Queue drain after load, s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1:512m | 4/5 | 3.5 [2.5, 7.3] | 424.5 [238.8, 779.6] | 912.1 [560.2, 2303.3] | 150.3 [144.6, 156.7] | 7.6 [5.7, 18.0] | 6.6 [4.3, 16.2] |
| 1:1g | 4/5 | 2.4 [2.2, 2.8] | 220.8 [169.1, 407.3] | 676.9 [465.9, 1284.6] | 154.9 [149.5, 222.9] | 8.7 [6.8, 15.4] | 3.7 [1.5, 6.6] |

| App quota | Requests / HTTP failures | Dropped iterations | Persisted signatures | Mail accepted | Page views / expected | Peak generator CPU, percent of one core |
| --- | --- | --- | --- | --- | --- | --- |
| 1:512m | 9798 / 0 | 0 | 304 | 354 | 304 / 304 | 8.2 [7.1, 8.9] |
| 1:1g | 9755 / 0 | 0 | 303 | 353 | 304 / 304 | 8.0 [6.0, 12.9] |

| App quota | Mean app CPU, percent of one core | CPU throttled during load, ms | Peak cgroup memory charge, MiB |
| --- | --- | --- | --- |
| 1:512m | 12.9 [12.5, 14.3] | 0.0 [0.0, 0.0] | 257.6 [256.6, 261.7] |
| 1:1g | 13.4 [12.1, 14.4] | 0.0 [0.0, 0.0] | 260.2 [256.9, 263.9] |

An equivalent tab polls twice every ten seconds. Ten percent of ticks fetch the document, its linked bundles and public data. Each run adds signatures, one search per second, five admin reads every five seconds, built-in statistics, and a ten-recipient campaign. HTTP signup timing ends at the durable enqueue. Queue drain timing continues until all expected mail is accepted by the local TLS server.

Passing requires k6 thresholds and checks, no dropped iterations, matching signer/mail/page-view counts, ten completed campaign deliveries, no pending or dead email jobs, and no app OOM or restarts. Container memory is Docker's sampled working set, not process RSS. The cgroup peak records the highest total memory charge, including cache and startup, without sampling. The generator and Mailpit run outside the app quota.

- current-n100000-cpu1-mem512m-r1: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu1-mem1g-r2: http_req_duration{scenario:admin}: p(95)<1000
