# Current workload results

No tested quota met every benchmark target in every run.

Measured 2026-11-09T10:59:28.075Z. 100,000 seeded signers, 1000 equivalent polling tabs, and 1 signature submission per second. Each run holds the workload for 60 seconds. Values show median [minimum, maximum] across all available measurements, including failed runs. Startup failures have no latency measurement.

| App quota | Passed | Visitor p95, ms | Signup p95, ms | Admin p95, ms | Peak container memory, MiB | Startup, s | Queue drain after load, s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.5:256m | 0/5 | 30.7 [20.1, 36.6] | 880.2 [874.8, 902.0] | 9798.9 [9756.2, 10183.0] | 229.4 [148.2, 252.4] | 9.4 [9.4, 9.7] | 25.5 [23.5, 30.5] |
| 1:256m | 0/5 | 1.3 [1.3, 1.4] | 8376.3 [681.0, 16071.6] | 8630.2 [8339.0, 8921.4] | 87.7 [70.1, 144.9] | 7.7 [7.6, 7.8] | 27.6 [21.5, 33.7] |

| App quota | Requests / HTTP failures | Dropped iterations | Persisted signatures | Mail accepted | Page views / expected | Peak generator CPU, percent of one core |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5:256m | 58204 / 17 | 5 | 181 | 211 | 1214 / 1802 | 33.3 [30.7, 35.2] |
| 1:256m | 37934 / 11 | 19 | 114 | 134 | 722 / 1201 | 36.5 [29.9, 43.0] |

| App quota | Mean app CPU, percent of one core | CPU throttled during load, ms | Peak cgroup memory charge, MiB |
| --- | --- | --- | --- |
| 0.5:256m | 19.7 [17.1, 20.7] | 5637.7 [5241.9, 5778.7] | Not measured |
| 1:256m | 19.8 [19.5, 20.2] | 309.1 [46.7, 571.5] | Not measured |

An equivalent tab polls twice every ten seconds. Ten percent of ticks fetch the document, its linked bundles and public data. Each run adds signatures, one search per second, five admin reads every five seconds, built-in statistics, and a ten-recipient campaign. HTTP signup timing ends at the durable enqueue. Queue drain timing continues until all expected mail is accepted by the local TLS server.

Passing requires k6 thresholds and checks, no dropped iterations, matching signer/mail/page-view counts, ten completed campaign deliveries, no pending or dead email jobs, and no app OOM or restarts. Container memory is Docker's sampled working set, not process RSS. The cgroup peak records the highest total memory charge, including cache and startup, without sampling. The generator and Mailpit run outside the app quota.

- current-n100000-cpu0.5-mem256m-r1: Startup stopped: OOM=true, exit=137
- current-n100000-cpu1-mem256m-r1: http_req_duration{scenario:admin}: p(95)<1000, dropped_iterations: count==0, checks: rate==1, http_req_duration{scenario:signatures}: p(95)<1000, http_req_duration{scenario:searches}: p(95)<1000
- current-n100000-cpu0.5-mem256m-r2: Startup stopped: OOM=true, exit=137
- current-n100000-cpu1-mem256m-r2: http_req_duration{scenario:admin}: p(95)<1000, checks: rate==1, dropped_iterations: count==0
- current-n100000-cpu0.5-mem256m-r3: checks: rate==1, http_req_duration{scenario:admin}: p(95)<1000, dropped_iterations: count==0
- current-n100000-cpu1-mem256m-r3: Startup stopped: OOM=true, exit=137
- current-n100000-cpu0.5-mem256m-r4: checks: rate==1, dropped_iterations: count==0, http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu1-mem256m-r4: Startup stopped: OOM=true, exit=137
- current-n100000-cpu0.5-mem256m-r5: checks: rate==1, dropped_iterations: count==0, http_req_duration{scenario:admin}: p(95)<1000
- current-n100000-cpu1-mem256m-r5: Startup stopped: OOM=true, exit=137
