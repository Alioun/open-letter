# Current workload results

No tested quota met every benchmark target in every run.

Measured 2026-11-09T11:16:03.691Z. 100,000 seeded signers, 100 equivalent polling tabs, and 1 signature submission per second. Each run holds the workload for 60 seconds. Values show median [minimum, maximum] across all available measurements, including failed runs. Startup failures have no latency measurement.

| App quota | Passed | Visitor p95, ms | Signup p95, ms | Admin p95, ms | Peak container memory, MiB | Startup, s | Queue drain after load, s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.5:512m | 1/5 | 27.6 [3.4, 84.3] | 726.9 [660.0, 754.1] | 1308.6 [990.1, 1341.9] | 156.6 [150.9, 165.5] | 8.6 [6.5, 8.7] | 35.6 [31.4, 36.6] |
| 1:512m | 2/5 | 2.7 [2.1, 3.8] | 627.3 [560.1, 688.1] | 1000.6 [647.2, 1194.2] | 140.1 [135.1, 144.6] | 6.7 [4.9, 7.7] | 33.8 [30.9, 36.0] |

| App quota | Requests / HTTP failures | Dropped iterations | Persisted signatures | Mail accepted | Page views / expected | Peak generator CPU, percent of one core |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5:512m | 9809 / 0 | 0 | 304 | 354 | 304 / 304 | 7.1 [6.8, 8.4] |
| 1:512m | 9726 / 0 | 0 | 305 | 355 | 304 / 304 | 7.4 [6.7, 8.1] |

| App quota | Mean app CPU, percent of one core | CPU throttled during load, ms | Peak cgroup memory charge, MiB |
| --- | --- | --- | --- |
| 0.5:512m | 13.0 [12.6, 13.5] | 2574.8 [2215.2, 2692.1] | 259.3 [250.3, 261.2] |
| 1:512m | 12.7 [12.1, 13.7] | 0.0 [0.0, 4.2] | 262.6 [260.0, 268.2] |

An equivalent tab polls twice every ten seconds. Ten percent of ticks fetch the document, its linked bundles and public data. Each run adds signatures, one search per second, five admin reads every five seconds, built-in statistics, and a ten-recipient campaign. HTTP signup timing ends at the durable enqueue. Queue drain timing continues until all expected mail is accepted by the local TLS server.

Passing requires k6 thresholds and checks, no dropped iterations, matching signer/mail/page-view counts, ten completed campaign deliveries, no pending or dead email jobs, and no app OOM or restarts. Container memory is Docker's sampled working set, not process RSS. The cgroup peak records the highest total memory charge, including cache and startup, without sampling. The generator and Mailpit run outside the app quota.

- current-n100000-cpu0.5-mem512m-r1: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu1-mem512m-r1: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu0.5-mem512m-r2: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu1-mem512m-r3: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu0.5-mem512m-r4: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu0.5-mem512m-r5: http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu1-mem512m-r5: http_req_duration{scenario:admin}: p(95)<1000
