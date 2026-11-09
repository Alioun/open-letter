# Storage diagnostics

This run used the production image with temporary SQL timing instrumentation, one CPU, and 1 GiB of app memory. It offered 1,000 equivalent polling tabs for 60 seconds with the same signature, admin, analytics, and campaign work as the repeated tests. Its timings are excluded from quota comparisons.

| Observation                               | Value                                          |
| ----------------------------------------- | ---------------------------------------------- |
| Recorded page views                       | 393 of 601                                     |
| Persisted signatures                      | 61                                             |
| Campaign recipients reached               | 10                                             |
| Mail accepted / pending jobs              | 71 / 0                                         |
| Admin p95                                 | 9279.0 ms                                      |
| Mean app CPU during the measured interval | 19.2% of one core                              |
| Reported commits over 100 ms              | 121, 119, 116, 116, 105, 133, 142, 199, 124 ms |

A separate probe made 30 writes of 4 KiB, each followed by `fdatasync`, on a fresh Docker volume on the same host.
The median was 41.8 ms, with a range of 37.1 to 95.6 ms. [Individual samples](storage-probe.json) are retained. This probe ran after the diagnostic workload and its cleanup.

The host uses WSL2 and Docker on an ext4 virtual disk. The high durable-write latency and low sustained CPU use explain why CPU quota alone does not resolve the mixed-workload failure. The probe measures storage latency, not application throughput. It does not predict a VPS with different storage.
