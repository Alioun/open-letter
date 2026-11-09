# Final-source CPU profile

This diagnostic uses `openletter-loadtest:verified-20261109`, Bun 1.4.4, the production dependency lock, 100,000 signers, 100 equivalent polling tabs and one CPU with 512 MiB. It runs traffic for 30 seconds. The CPU profile includes startup, preparation, traffic and queue drain. Do not use its response times in the repeated hardware comparison.

The final regression suite finished before the timed traffic. The profile overlaps the end of application verification and seed setup, so it does not provide an isolated startup measurement. Its work checks pass, including local SMTP acceptance, persisted signatures and analytics counts.

The largest named native entry is `Statement`; route handling and token signing also appear among the sampled functions. The profile's table reflects sampled stacks over wall time and is not a measurement of CPU seconds per request. The cgroup counters show 14.2% of one core averaged during traffic and no CPU quota throttling. The generator peaks at 7.3% of one core. Neither process saturates a core in this run.

The earlier independent Docker-volume probe found a median of 41.8 ms for a 4 KiB write followed by `fdatasync`. Earlier SQL traces also showed commits over 100 ms. These diagnostics, serialized SQLCipher transactions and low sustained CPU support storage and database-queue waiting as latency limits on this host. They do not prove that storage explains every slow request.

The repeated final memory comparison lives in `../2026-11-09-verified-boundary/`. It uses the same image without profiling. The runner removed this profile project's own containers and volumes. Raw logs, resource counters and the full Bun profile remain in `raw/`.
