# Hardware requirements

Use **1 vCPU, 1 GB of RAM, and 20 GB of SSD storage** as a starting configuration for a small deployment. This leaves space for Linux, the reverse proxy, container images, and backups. It is a sizing recommendation, not a guaranteed traffic limit.

The final November 2026 tests show that a 256 MiB app limit is unreliable. The 512 MiB quota met every target in all five runs. A 512 MiB app container still needs memory outside its quota for Linux and the reverse proxy. The tests do not measure a whole-VPS minimum.

## Current measurements

The [repeated results](../loadtest/results/2026-11-09-verified-boundary/SUMMARY.md) use the current production image and upgraded dependencies. The [measurement notes](../loadtest/results/2026-11-09-verified-boundary/NOTES.md) explain the checks, earlier failures, and database changes found during testing.

The workload has 100,000 seeded signers and combines:

- 100 equivalent polling tabs. A tab polls the public totals and signer list every ten seconds. Ten percent of ticks load the document and its linked JavaScript and CSS.
- One signature submission and one signer search per second.
- Five authenticated admin reads every five seconds.
- Built-in analytics collection and a ten-recipient email campaign.

Each memory limit has five alternating runs with one CPU and no swap. Each run restores the same database, starts a fresh container, warms admin aggregates, and holds traffic for 60 seconds. Startup and mail-queue drain are recorded separately.

The fixture uses the example letter with optional regional fields and meeting registration disabled. The server still builds the bundled admin editors at startup.

The latency targets are public p95 below 500 ms and signature, search, and admin p95 below one second. Checks also require no dropped iterations, every accepted signature persisted, every document request counted in analytics, all expected emails accepted, an empty queue, no dead mail jobs, and no app OOM or restart. The results retain failed runs.

Each setting has five runs. Latencies show the median and range for runs that reached traffic, in milliseconds. Only one 256 MiB run reached traffic; all five 512 MiB runs did.

| App quota | Runs meeting every target | Public p95     | Signature p95        | Admin p95            |
| --------- | ------------------------- | -------------- | -------------------- | -------------------- |
| 1:256m    | 1/5                       | 2.5 [2.5, 2.5] | 131.6 [131.6, 131.6] | 635.1 [635.1, 635.1] |
| 1:512m    | 5/5                       | 1.9 [1.8, 2.5] | 137.4 [118.3, 160.2] | 499.8 [400.2, 584.1] |

The measured runs served 11,696 requests with 0 HTTP failures and 0 dropped iterations. They persisted 366 signatures, recorded 365/365 expected page views, and accepted 426 emails locally. Failed startup runs remain in the pass counts.

The highest cgroup memory charge was 266.4 MiB. The highest sampled Docker working set was 161.3 MiB. Queue drain after traffic lasted 2.3 to 4.0 seconds.

### Memory

The final one-CPU comparison recorded 4 startup OOM failures at 256 MiB. Surviving repetitions do not establish reliable startup at that limit.

The server builds the public and admin bundles at startup. Steady memory use alone therefore understates the required limit. The runs record both Docker's sampled working set and the cgroup's unsampled peak memory charge, including cache and startup. The cgroup charge also includes in-container verification helpers. Neither metric is process RSS.

A 512 MiB app container is not a 512 MB VPS. The app quota excludes Linux, the reverse proxy, and other containers. The load generator and local mail server also run outside the app quota.

### Storage and latency

The benchmark host is x86-64 WSL2 with a Ryzen 5 5600X, 12 logical CPUs, and about 15.6 GiB of RAM. Docker stores data on ext4 on a virtual disk. Other project containers remain running. The recorded host load and generator samples help identify interference. The parent completed the final test suites before starting these timed runs.

A separate diagnostic probe measured about 42 ms for a small write followed by `fdatasync`. SQL timing showed some commits taking over 100 ms. The separate [final-source profile](../loadtest/results/2026-11-09-verified-profile/NOTES.md) identifies SQLCipher statements among its largest named native samples. Low sustained CPU and durable-write timings support database and storage waiting as latency constraints. These diagnostics do not identify the sole cause of every slow request. The benchmark keeps the application's durability settings.

Before the final review fixes, a 1,000-tab workload lost analytics events and missed latency targets. A separate instrumented run at one CPU and 1 GiB also lost analytics events. Its timings are excluded from the repeated comparison. Those runs do not support a 1,000-tab capacity claim on this host.

Use SSD storage with low durable-write latency, and rerun the [hardware tests](../loadtest/README.md) on the intended server. These fixed workloads do not find a throughput ceiling. A shared VPS can have different CPU contention and storage latency.

### Delivery and test coverage

Signature latency ends after the database write and durable enqueue. It does not include inbox arrival. The runner waits for queued messages after traffic ends and checks SMTP acceptance, delivery records, and campaign completion. Configured email pacing also affects drain time.

Mailpit requires TLS and authentication and accepts only local `@load.test` messages. External providers, spam filtering, and inbox delivery are outside the test. Signatures are submitted but not confirmed. The HTTP clients do not execute browser JavaScript or measure rendering. Backup overlap, uploads, simultaneous publication, and long-term analytics growth need separate testing.

## Disk space

The current encrypted 100,000-signer fixture is about 54 MiB before additional campaign and analytics history. Forty-eight database-sized backup snapshots would use roughly 2.5 GiB. Encrypted snapshots compress poorly.

Allow at least 5 GB for application data at that size, then account for uploads, analytics, delivery records, and growth. The suggested 20 GB system disk also allows for Linux and container images. Monitor free space and backup duration. `BACKUP_KEEP` changes backup retention; match the public privacy disclosure when changing it.

## Bandwidth

First visits transfer HTML, JavaScript, CSS, fonts, and images. Returning visits and polls transfer less. The September bundle-size estimates predate the current editors and publications and no longer describe the app.

`Bun.serve` does not compress these responses. Enable gzip or Brotli at the reverse proxy and measure transferred bytes for the deployed letter. The load test fetches linked JavaScript and CSS, but does not reproduce a browser's full image and font loading or cache behavior.

## Historical tests

The [September baseline](../loadtest/results/2026-09-16-baseline/SUMMARY.md) and [optimized results](../loadtest/results/2026-09-16-optimized/SUMMARY.md) used an older application on Apple Silicon. Their workload and database behavior differ from the current mixed test. Do not compare their tab counts directly with the November results.

Those runs motivated covering indexes, shared cache reads, search filtering before fuzzy matching, and durable email enqueue. Current publications and analytics add database connections. The SQLCipher adapter now queues operations and complete transactions across connections to the same database file within the app process. Run one app process per database file.
