
## visitors | open tabs

| signers | CPU | RAM | max OK | tested up to | p95 @ max OK | peak CPU | peak RSS | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.5 | 512m | 4000 | 4000 | 24 ms | 52% | 60 MiB | no ceiling found |
| 1,000 | 1 | 1g | 4000 | 4000 | 2 ms | 74% | 60 MiB | no ceiling found |
| 1,000 | 2 | 2g | 4000 | 4000 | 2 ms | 68% | 58 MiB | no ceiling found |
| 1,000 | 4 | 4g | 4000 | 4000 | 3 ms | 100% | 60 MiB | no ceiling found |
| 10,000 | 0.5 | 512m | 500 | 1000 | 12 ms | 51% | 78 MiB |  |
| 10,000 | 1 | 1g | 1000 | 4000 | 11 ms | 104% | 113 MiB |  |
| 10,000 | 2 | 2g | 1000 | 4000 | 11 ms | 110% | 114 MiB |  |
| 10,000 | 4 | 4g | 1000 | 4000 | 13 ms | 108% | 110 MiB |  |
| 100,000 | 0.5 | 512m | - | 50 | - | 51% | 44 MiB | failed at lowest step |
| 100,000 | 1 | 1g | - | 50 | - | 101% | 45 MiB | failed at lowest step |
| 100,000 | 2 | 2g | - | 50 | - | 102% | 52 MiB | failed at lowest step |
| 100,000 | 4 | 4g | - | 50 | - | 103% | 47 MiB | failed at lowest step |

## signup | sign-ups/s

| signers | CPU | RAM | max OK | tested up to | p95 @ max OK | peak CPU | peak RSS | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.5 | 512m | 50 | 50 | 11 ms | 27% | 73 MiB | no ceiling found |
| 1,000 | 1 | 1g | 50 | 50 | 11 ms | 27% | 70 MiB | no ceiling found |
| 1,000 | 2 | 2g | 50 | 50 | 9 ms | 26% | 74 MiB | no ceiling found |
| 1,000 | 4 | 4g | 50 | 50 | 11 ms | 31% | 76 MiB | no ceiling found |
| 10,000 | 0.5 | 512m | 25 | 50 | 15 ms | 52% | 80 MiB |  |
| 10,000 | 1 | 1g | 50 | 50 | 14 ms | 54% | 68 MiB | no ceiling found |
| 10,000 | 2 | 2g | 50 | 50 | 15 ms | 54% | 67 MiB | no ceiling found |
| 10,000 | 4 | 4g | 50 | 50 | 16 ms | 58% | 74 MiB | no ceiling found |
| 100,000 | 0.5 | 512m | 10 | 25 | 199 ms | 51% | 122 MiB |  |
| 100,000 | 1 | 1g | 10 | 25 | 51 ms | 101% | 90 MiB |  |
| 100,000 | 2 | 2g | 10 | 50 | 52 ms | 107% | 125 MiB |  |
| 100,000 | 4 | 4g | 25 | 50 | 982 ms | 110% | 134 MiB |  |

## per-step detail


**signup · 1,000 signers · 0.5 CPU / 512m** (peak CPU 27%, peak RSS 73 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 15 ms | 23 ms | 24 ms | 0.0% |
| 5 | 5.0 | 14 ms | 24 ms | 28 ms | 0.0% |
| 10 | 10.0 | 13 ms | 22 ms | 27 ms | 0.0% |
| 25 | 25.0 | 9 ms | 15 ms | 18 ms | 0.0% |
| 50 | 50.0 | 7 ms | 11 ms | 29 ms | 0.0% |

**signup · 1,000 signers · 1 CPU / 1g** (peak CPU 27%, peak RSS 70 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 18 ms | 27 ms | 29 ms | 0.0% |
| 5 | 5.0 | 14 ms | 25 ms | 29 ms | 0.0% |
| 10 | 10.0 | 13 ms | 21 ms | 25 ms | 0.0% |
| 25 | 25.0 | 9 ms | 14 ms | 18 ms | 0.0% |
| 50 | 50.0 | 7 ms | 11 ms | 25 ms | 0.0% |

**signup · 1,000 signers · 2 CPU / 2g** (peak CPU 26%, peak RSS 74 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 20 ms | 26 ms | 43 ms | 0.0% |
| 5 | 5.0 | 14 ms | 22 ms | 29 ms | 0.0% |
| 10 | 10.0 | 15 ms | 22 ms | 27 ms | 0.0% |
| 25 | 25.0 | 9 ms | 14 ms | 17 ms | 0.0% |
| 50 | 50.0 | 7 ms | 9 ms | 11 ms | 0.0% |

**signup · 1,000 signers · 4 CPU / 4g** (peak CPU 31%, peak RSS 76 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 23 ms | 30 ms | 33 ms | 0.0% |
| 5 | 5.0 | 18 ms | 26 ms | 29 ms | 0.0% |
| 10 | 10.0 | 16 ms | 22 ms | 26 ms | 0.0% |
| 25 | 25.0 | 9 ms | 15 ms | 23 ms | 0.0% |
| 50 | 50.0 | 8 ms | 11 ms | 19 ms | 0.0% |

**signup · 10,000 signers · 0.5 CPU / 512m** (peak CPU 52%, peak RSS 80 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 22 ms | 32 ms | 36 ms | 0.0% |
| 5 | 5.0 | 19 ms | 27 ms | 31 ms | 0.0% |
| 10 | 10.0 | 15 ms | 26 ms | 33 ms | 0.0% |
| 25 | 25.0 | 13 ms | 15 ms | 30 ms | 0.0% |
| 50 | 48.5 | 16 ms | 1331 ms | 2084 ms | 0.0% |

**signup · 10,000 signers · 1 CPU / 1g** (peak CPU 54%, peak RSS 68 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 20 ms | 28 ms | 28 ms | 0.0% |
| 5 | 5.0 | 18 ms | 26 ms | 29 ms | 0.0% |
| 10 | 10.0 | 16 ms | 24 ms | 29 ms | 0.0% |
| 25 | 25.0 | 12 ms | 14 ms | 17 ms | 0.0% |
| 50 | 50.0 | 12 ms | 14 ms | 29 ms | 0.0% |

**signup · 10,000 signers · 2 CPU / 2g** (peak CPU 54%, peak RSS 67 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 20 ms | 30 ms | 32 ms | 0.0% |
| 5 | 5.0 | 14 ms | 26 ms | 33 ms | 0.0% |
| 10 | 10.0 | 14 ms | 24 ms | 29 ms | 0.0% |
| 25 | 25.0 | 13 ms | 15 ms | 19 ms | 0.0% |
| 50 | 50.0 | 12 ms | 15 ms | 45 ms | 0.0% |

**signup · 10,000 signers · 4 CPU / 4g** (peak CPU 58%, peak RSS 74 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 19 ms | 29 ms | 30 ms | 0.0% |
| 5 | 5.0 | 14 ms | 25 ms | 31 ms | 0.0% |
| 10 | 10.0 | 15 ms | 24 ms | 27 ms | 0.0% |
| 25 | 25.0 | 12 ms | 14 ms | 16 ms | 0.0% |
| 50 | 50.0 | 12 ms | 16 ms | 19 ms | 0.0% |

**signup · 100,000 signers · 0.5 CPU / 512m** (peak CPU 51%, peak RSS 122 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 110 ms | 125 ms | 131 ms | 0.0% |
| 5 | 5.0 | 54 ms | 121 ms | 148 ms | 0.0% |
| 10 | 10.0 | 48 ms | 199 ms | 398 ms | 0.0% |
| 25 | 1.6 | 49336 ms | 60002 ms | 60003 ms | 33.9% |

**signup · 100,000 signers · 1 CPU / 1g** (peak CPU 101%, peak RSS 90 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 61 ms | 77 ms | 77 ms | 0.0% |
| 5 | 5.0 | 57 ms | 66 ms | 68 ms | 0.0% |
| 10 | 10.0 | 48 ms | 51 ms | 52 ms | 0.0% |
| 25 | 11.8 | 1204 ms | 9822 ms | 10579 ms | 0.0% |

**signup · 100,000 signers · 2 CPU / 2g** (peak CPU 107%, peak RSS 125 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 62 ms | 77 ms | 104 ms | 0.0% |
| 5 | 5.0 | 54 ms | 64 ms | 66 ms | 0.0% |
| 10 | 10.0 | 48 ms | 52 ms | 67 ms | 0.0% |
| 25 | 23.8 | 795 ms | 2147 ms | 2813 ms | 0.0% |
| 50 | 4.7 | 60002 ms | 60005 ms | 60005 ms | 88.8% |

**signup · 100,000 signers · 4 CPU / 4g** (peak CPU 110%, peak RSS 134 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 65 ms | 76 ms | 81 ms | 0.0% |
| 5 | 5.0 | 59 ms | 64 ms | 67 ms | 0.0% |
| 10 | 10.0 | 48 ms | 54 ms | 71 ms | 0.0% |
| 25 | 24.6 | 461 ms | 982 ms | 1263 ms | 0.0% |
| 50 | 2.7 | 60002 ms | 60005 ms | 60005 ms | 100.0% |

**visitors · 1,000 signers · 0.5 CPU / 512m** (peak CPU 52%, peak RSS 60 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 17.5 | 2 ms | 4 ms | 5 ms | 0.0% |
| 200 | 70.3 | 2 ms | 4 ms | 6 ms | 0.0% |
| 500 | 173.8 | 1 ms | 4 ms | 6 ms | 0.0% |
| 1000 | 346.0 | 1 ms | 3 ms | 5 ms | 0.0% |
| 2000 | 688.1 | 1 ms | 2 ms | 10 ms | 0.0% |
| 4000 | 1376.7 | 1 ms | 24 ms | 58 ms | 0.3% |

**visitors · 1,000 signers · 1 CPU / 1g** (peak CPU 74%, peak RSS 60 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 18.4 | 2 ms | 4 ms | 5 ms | 0.0% |
| 200 | 69.7 | 2 ms | 4 ms | 5 ms | 0.0% |
| 500 | 176.4 | 2 ms | 4 ms | 5 ms | 0.0% |
| 1000 | 340.6 | 1 ms | 3 ms | 3 ms | 0.0% |
| 2000 | 691.4 | 1 ms | 2 ms | 6 ms | 0.0% |
| 4000 | 1386.1 | 1 ms | 2 ms | 3 ms | 0.3% |

**visitors · 1,000 signers · 2 CPU / 2g** (peak CPU 68%, peak RSS 58 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 17.9 | 2 ms | 4 ms | 6 ms | 0.0% |
| 200 | 68.8 | 2 ms | 4 ms | 11 ms | 0.0% |
| 500 | 174.4 | 2 ms | 4 ms | 5 ms | 0.0% |
| 1000 | 342.6 | 1 ms | 3 ms | 4 ms | 0.0% |
| 2000 | 690.6 | 1 ms | 2 ms | 2 ms | 0.0% |
| 4000 | 1377.7 | 1 ms | 2 ms | 3 ms | 0.3% |

**visitors · 1,000 signers · 4 CPU / 4g** (peak CPU 100%, peak RSS 60 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 18.3 | 2 ms | 4 ms | 6 ms | 0.0% |
| 200 | 69.1 | 2 ms | 4 ms | 6 ms | 0.0% |
| 500 | 171.7 | 2 ms | 4 ms | 5 ms | 0.0% |
| 1000 | 342.9 | 1 ms | 2 ms | 4 ms | 0.0% |
| 2000 | 692.0 | 1 ms | 2 ms | 3 ms | 0.0% |
| 4000 | 1382.2 | 1 ms | 3 ms | 21 ms | 0.3% |

**visitors · 10,000 signers · 0.5 CPU / 512m** (peak CPU 51%, peak RSS 78 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 17.3 | 7 ms | 16 ms | 20 ms | 0.0% |
| 200 | 71.1 | 6 ms | 12 ms | 17 ms | 0.0% |
| 500 | 173.1 | 6 ms | 12 ms | 24 ms | 0.0% |
| 1000 | 238.9 | 1562 ms | 4194 ms | 5679 ms | 0.0% |

**visitors · 10,000 signers · 1 CPU / 1g** (peak CPU 104%, peak RSS 113 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 17.6 | 6 ms | 14 ms | 18 ms | 0.0% |
| 200 | 69.7 | 7 ms | 18 ms | 30 ms | 0.0% |
| 500 | 173.7 | 6 ms | 12 ms | 14 ms | 0.0% |
| 1000 | 342.6 | 5 ms | 11 ms | 16 ms | 0.0% |
| 2000 | 656.6 | 1067 ms | 2970 ms | 4542 ms | 0.0% |
| 4000 | 10.6 | 1994 ms | 2674 ms | 2717 ms | 0.0% |

**visitors · 10,000 signers · 2 CPU / 2g** (peak CPU 110%, peak RSS 114 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 18.3 | 7 ms | 17 ms | 20 ms | 0.0% |
| 200 | 71.1 | 6 ms | 13 ms | 17 ms | 0.0% |
| 500 | 174.5 | 6 ms | 16 ms | 61 ms | 0.0% |
| 1000 | 344.9 | 5 ms | 11 ms | 15 ms | 0.0% |
| 2000 | 655.3 | 1008 ms | 2940 ms | 4281 ms | 0.0% |
| 4000 | 20.7 | 2901 ms | 3700 ms | 3796 ms | 0.2% |

**visitors · 10,000 signers · 4 CPU / 4g** (peak CPU 108%, peak RSS 110 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 17.9 | 6 ms | 15 ms | 19 ms | 0.0% |
| 200 | 71.0 | 6 ms | 14 ms | 17 ms | 0.0% |
| 500 | 174.4 | 6 ms | 12 ms | 22 ms | 0.0% |
| 1000 | 347.0 | 5 ms | 13 ms | 18 ms | 0.0% |
| 2000 | 654.6 | 1039 ms | 2825 ms | 3939 ms | 0.0% |
| 4000 | 6.5 | 1964 ms | 2370 ms | 2411 ms | 0.0% |

**visitors · 100,000 signers · 0.5 CPU / 512m** (peak CPU 51%, peak RSS 44 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 0.3 | 1640 ms | 2989 ms | 3110 ms | 0.0% |

**visitors · 100,000 signers · 1 CPU / 1g** (peak CPU 101%, peak RSS 45 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 0.3 | 3865 ms | 5920 ms | 6028 ms | 0.0% |

**visitors · 100,000 signers · 2 CPU / 2g** (peak CPU 102%, peak RSS 52 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 0.7 | 5485 ms | 8990 ms | 9296 ms | 0.0% |

**visitors · 100,000 signers · 4 CPU / 4g** (peak CPU 103%, peak RSS 47 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 0.4 | 1923 ms | 4173 ms | 4371 ms | 0.0% |
