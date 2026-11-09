# Final hardware verification

The 512 MiB quota met every target in all five runs. A 256 MiB limit is unreliable because 4 runs terminated for lack of memory. Keep every failed run in the comparison. These are application-container limits on the measured host, not minimum whole-VPS specifications.

## Source and command

The image is `openletter-loadtest:verified-20261109`, "sha256:1ad595c48a92dad472b82e4b8ea8c35f9011b7e75b87e936f8af35e10042c6f9". It uses Bun 1.4.4 and the upgraded production dependencies. A separate hash check matched 127 selected runtime source files and the lockfile to the finished workspace. It follows the legacy-email, publication-feature, meeting-identity and retired-template corrections.

```bash
LOADTEST_IMAGE=openletter-loadtest:verified-20261109 \
LOADTEST_PORT=3910 MAILPIT_PORT=3911 SKIP_BUILD=1 \
TIERS='1:256m 1:512m' TABS=100 DATASET=100000 HOLD=60 REPEATS=5 \
OUT=results/2026-11-09-verified-boundary bun loadtest/run-current.js
bun loadtest/summarize-current.js loadtest/results/2026-11-09-verified-boundary
```

`SKIP_BUILD=1` reuses the fresh standard Dockerfile build, including its completed frozen-lockfile install. It does not reuse an older source image. The application runtime source stayed unchanged throughout measurement. The report generator later gained a label for profiled diagnostic runs; it does not affect the workload.

## Workload and results

Each run restores 100,000 seeded signers and starts a fresh production container. Traffic combines 100 equivalent polling tabs, one signup and one search per second, five admin reads every five seconds, built-in analytics and a ten-recipient campaign. Both memory settings use one CPU with no swap. The runner alternates the settings five times.

Values are median [minimum, maximum] across measured runs, in milliseconds. Startup failures contribute to the failure count but have no request timing.

| App quota | Runs meeting every target | Public p95     | Signature p95        | Admin p95            |
| --------- | ------------------------- | -------------- | -------------------- | -------------------- |
| 1:256m    | 1/5                       | 2.5 [2.5, 2.5] | 131.6 [131.6, 131.6] | 635.1 [635.1, 635.1] |
| 1:512m    | 5/5                       | 1.9 [1.8, 2.5] | 137.4 [118.3, 160.2] | 499.8 [400.2, 584.1] |

The timed runs served 11,696 requests with 0 HTTP failures and 0 dropped iterations. They persisted 366 signatures, accepted 426 messages locally and recorded 365/365 expected page views. The work records also check campaign completion, delivery records and an empty live/dead email queue. Consult `runs.json` for each result rather than inferring work completion from HTTP status.

The largest cgroup charge was 266.4 MiB, including startup, cache and verification helpers. The highest sampled Docker working set was 161.3 MiB. Neither number is process RSS. Queue drain after traffic ranged from 2.3 to 4.0 seconds. A passing low-memory run does not cancel a startup OOM in another repetition.

## Limits and diagnosis

The host is WSL2 on a Ryzen 5 5600X with 12 logical CPUs and about 15.6 GiB RAM. Docker storage is ext4 on a virtual disk. Unrelated project containers stayed running. Host load and generator samples are recorded. The final full suite, HTTP verifier and publication verifier finished before these timed runs; the parent started no further heavy tests during them.

The separate [final-source CPU profile](../2026-11-09-verified-profile/NOTES.md) is excluded from this comparison. SQLCipher statements lead its named native samples. Sustained CPU and generator counters, plus earlier durable-write diagnostics, support storage and serialized database waiting as latency constraints. They do not prove a sole bottleneck. Both CPU quotas are identical here, so these results establish no CPU speedup or throughput ceiling.

The earlier [review-fix measurements](../2026-11-09-review-fixes/SUMMARY.md) tested 512 MiB and 1 GiB before the final follow-up corrections. They retain latency misses and host-storage interference. Do not treat the runs as a controlled before/after speed comparison or evidence that more RAM fixes latency.

Mailpit uses authentication and TLS and accepts only local fixture addresses. SMTP acceptance is measured; external delivery, provider limits, spam handling and inbox arrival are not. HTTP clients do not execute browser JavaScript. Backups overlapping peak traffic, uploads, concurrent publishing and long-term analytics growth remain separate sizing concerns.

The runner removes only its own containers, networks and volumes. Its cleanup result is in `raw/cleanup.log`.
