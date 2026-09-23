
## visitors: open tabs

| signers | CPU | RAM | max OK | tested up to | p95 @ max OK | peak CPU | peak RSS | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100,000 | 0.5 | 512m | 8000 | 8000 | 21 ms | 64% | 79 MiB | no ceiling found |

## mixed: open tabs (+ sign-ups & searches)

| signers | CPU | RAM | max OK | tested up to | p95 @ max OK | peak CPU | peak RSS | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.5 | 512m | 8000 | 8000 | 1 ms | 59% | 96 MiB | no ceiling found |
| 1,000 | 1 | 1g | 8000 | 8000 | 1 ms | 65% | 95 MiB | no ceiling found |
| 1,000 | 2 | 2g | 8000 | 8000 | 0 ms | 39% | 91 MiB | no ceiling found |
| 10,000 | 0.5 | 512m | 8000 | 8000 | 1 ms | 56% | 97 MiB | no ceiling found |
| 10,000 | 1 | 1g | 8000 | 8000 | 0 ms | 38% | 93 MiB | no ceiling found |
| 10,000 | 2 | 2g | 4000 | 8000 | 11 ms | 237% | 128 MiB |  |
| 100,000 | 0.5 | 512m | 8000 | 8000 | 1 ms | 48% | 113 MiB | no ceiling found |

## signup: sign-ups/s

| signers | CPU | RAM | max OK | tested up to | p95 @ max OK | peak CPU | peak RSS | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 0.5 | 512m | 50 | 50 | 16 ms | 26% | 77 MiB | no ceiling found |
| 1,000 | 1 | 1g | 50 | 50 | 19 ms | 42% | 81 MiB | no ceiling found |
| 1,000 | 2 | 2g | 50 | 50 | 11 ms | 22% | 71 MiB | no ceiling found |
| 10,000 | 0.5 | 512m | 50 | 50 | 23 ms | 38% | 77 MiB | no ceiling found |
| 10,000 | 1 | 1g | 25 | 50 | 105 ms | 464% | 85 MiB |  |
| 10,000 | 2 | 2g | 50 | 50 | 74 ms | 62% | 74 MiB | no ceiling found |
| 100,000 | 0.5 | 512m | 50 | 50 | 41 ms | 39% | 81 MiB | no ceiling found |

## per-step detail


**mixed · 1,000 signers · 0.5 CPU / 512m** (peak CPU 59%, peak RSS 96 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 20.7 | 1 ms | 13 ms | 27 ms | 0.0% |
| 200 | 77.0 | 1 ms | 5 ms | 14 ms | 0.0% |
| 500 | 175.0 | 1 ms | 19 ms | 94 ms | 0.0% |
| 1000 | 345.1 | 0 ms | 2 ms | 13 ms | 0.0% |
| 2000 | 698.2 | 0 ms | 1 ms | 4 ms | 0.0% |
| 4000 | 1381.4 | 0 ms | 1 ms | 2 ms | 0.3% |
| 8000 | 2802.8 | 0 ms | 1 ms | 7 ms | 0.2% |

**mixed · 1,000 signers · 1 CPU / 1g** (peak CPU 65%, peak RSS 95 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 21.1 | 1 ms | 12 ms | 19 ms | 0.0% |
| 200 | 76.6 | 1 ms | 6 ms | 17 ms | 0.0% |
| 500 | 177.1 | 1 ms | 3 ms | 12 ms | 0.0% |
| 1000 | 348.1 | 1 ms | 4 ms | 22 ms | 0.0% |
| 2000 | 694.1 | 0 ms | 2 ms | 7 ms | 0.0% |
| 4000 | 1383.0 | 0 ms | 1 ms | 2 ms | 0.3% |
| 8000 | 2766.3 | 0 ms | 1 ms | 7 ms | 0.2% |

**mixed · 1,000 signers · 2 CPU / 2g** (peak CPU 39%, peak RSS 91 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 23.0 | 1 ms | 12 ms | 21 ms | 0.0% |
| 200 | 75.2 | 1 ms | 5 ms | 14 ms | 0.0% |
| 500 | 174.7 | 1 ms | 3 ms | 10 ms | 0.0% |
| 1000 | 355.1 | 1 ms | 2 ms | 6 ms | 0.0% |
| 2000 | 689.8 | 0 ms | 1 ms | 3 ms | 0.0% |
| 4000 | 1384.8 | 0 ms | 1 ms | 2 ms | 0.3% |
| 8000 | 2765.5 | 0 ms | 0 ms | 2 ms | 0.2% |

**mixed · 10,000 signers · 0.5 CPU / 512m** (peak CPU 56%, peak RSS 97 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 23.2 | 1 ms | 11 ms | 17 ms | 0.0% |
| 200 | 73.2 | 1 ms | 4 ms | 13 ms | 0.0% |
| 500 | 179.2 | 1 ms | 3 ms | 10 ms | 0.0% |
| 1000 | 349.9 | 0 ms | 2 ms | 6 ms | 0.0% |
| 2000 | 689.3 | 0 ms | 3 ms | 13 ms | 0.0% |
| 4000 | 1423.4 | 0 ms | 0 ms | 2 ms | 0.2% |
| 8000 | 2828.6 | 0 ms | 1 ms | 8 ms | 0.3% |

**mixed · 10,000 signers · 1 CPU / 1g** (peak CPU 38%, peak RSS 93 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 22.2 | 1 ms | 9 ms | 17 ms | 0.0% |
| 200 | 73.0 | 1 ms | 5 ms | 14 ms | 0.0% |
| 500 | 180.3 | 1 ms | 3 ms | 10 ms | 0.0% |
| 1000 | 349.7 | 1 ms | 2 ms | 7 ms | 0.0% |
| 2000 | 692.7 | 0 ms | 1 ms | 4 ms | 0.0% |
| 4000 | 1379.5 | 0 ms | 1 ms | 2 ms | 0.3% |
| 8000 | 2764.8 | 0 ms | 0 ms | 2 ms | 0.2% |

**mixed · 10,000 signers · 2 CPU / 2g** (peak CPU 237%, peak RSS 128 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 22.2 | 1 ms | 14 ms | 30 ms | 0.0% |
| 200 | 75.2 | 1 ms | 6 ms | 18 ms | 0.0% |
| 500 | 180.3 | 1 ms | 11 ms | 165 ms | 0.0% |
| 1000 | 352.3 | 0 ms | 2 ms | 6 ms | 0.0% |
| 2000 | 700.2 | 0 ms | 2 ms | 8 ms | 0.0% |
| 4000 | 1388.2 | 1 ms | 11 ms | 51 ms | 0.3% |
| 8000 | 1993.9 | 115 ms | 1835 ms | 3775 ms | 0.2% |

**mixed · 100,000 signers · 0.5 CPU / 512m** (peak CPU 48%, peak RSS 113 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 21.7 | 1 ms | 14 ms | 28 ms | 0.0% |
| 200 | 73.6 | 1 ms | 5 ms | 16 ms | 0.0% |
| 500 | 180.0 | 1 ms | 3 ms | 13 ms | 0.0% |
| 1000 | 349.5 | 0 ms | 2 ms | 12 ms | 0.0% |
| 2000 | 691.3 | 0 ms | 1 ms | 10 ms | 0.0% |
| 4000 | 1399.4 | 0 ms | 1 ms | 5 ms | 0.3% |
| 8000 | 2815.1 | 0 ms | 1 ms | 12 ms | 0.2% |

**signup · 1,000 signers · 0.5 CPU / 512m** (peak CPU 26%, peak RSS 77 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 12 ms | 45 ms | 69 ms | 0.0% |
| 5 | 5.0 | 13 ms | 27 ms | 50 ms | 0.0% |
| 10 | 10.0 | 11 ms | 36 ms | 128 ms | 0.0% |
| 25 | 25.0 | 8 ms | 21 ms | 49 ms | 0.0% |
| 50 | 50.0 | 6 ms | 16 ms | 56 ms | 0.0% |

**signup · 1,000 signers · 1 CPU / 1g** (peak CPU 42%, peak RSS 81 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 12 ms | 23 ms | 35 ms | 0.0% |
| 5 | 5.0 | 10 ms | 19 ms | 33 ms | 0.0% |
| 10 | 10.0 | 12 ms | 52 ms | 335 ms | 0.0% |
| 25 | 25.0 | 8 ms | 18 ms | 54 ms | 0.0% |
| 50 | 50.0 | 6 ms | 19 ms | 100 ms | 0.0% |

**signup · 1,000 signers · 2 CPU / 2g** (peak CPU 22%, peak RSS 71 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 13 ms | 20 ms | 26 ms | 0.0% |
| 5 | 5.0 | 10 ms | 17 ms | 21 ms | 0.0% |
| 10 | 10.0 | 10 ms | 18 ms | 36 ms | 0.0% |
| 25 | 25.0 | 8 ms | 15 ms | 34 ms | 0.0% |
| 50 | 50.0 | 6 ms | 11 ms | 21 ms | 0.0% |

**signup · 10,000 signers · 0.5 CPU / 512m** (peak CPU 38%, peak RSS 77 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 13 ms | 20 ms | 21 ms | 0.0% |
| 5 | 5.0 | 11 ms | 18 ms | 24 ms | 0.0% |
| 10 | 10.0 | 9 ms | 17 ms | 43 ms | 0.0% |
| 25 | 25.0 | 8 ms | 17 ms | 43 ms | 0.0% |
| 50 | 50.0 | 6 ms | 23 ms | 65 ms | 0.0% |

**signup · 10,000 signers · 1 CPU / 1g** (peak CPU 464%, peak RSS 85 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 14 ms | 21 ms | 28 ms | 0.0% |
| 5 | 5.0 | 12 ms | 21 ms | 29 ms | 0.0% |
| 10 | 10.0 | 10 ms | 24 ms | 44 ms | 0.0% |
| 25 | 24.4 | 11 ms | 105 ms | 521 ms | 0.0% |
| 50 | 15.5 | 287 ms | 12752 ms | 13459 ms | 0.0% |

**signup · 10,000 signers · 2 CPU / 2g** (peak CPU 62%, peak RSS 74 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 44 ms | 263 ms | 394 ms | 0.0% |
| 5 | 5.0 | 14 ms | 32 ms | 124 ms | 0.0% |
| 10 | 10.0 | 34 ms | 168 ms | 240 ms | 0.0% |
| 25 | 25.0 | 9 ms | 30 ms | 84 ms | 0.0% |
| 50 | 50.0 | 8 ms | 74 ms | 151 ms | 0.0% |

**signup · 100,000 signers · 0.5 CPU / 512m** (peak CPU 39%, peak RSS 81 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0 | 16 ms | 27 ms | 34 ms | 0.0% |
| 5 | 5.0 | 13 ms | 35 ms | 93 ms | 0.0% |
| 10 | 10.0 | 13 ms | 53 ms | 144 ms | 0.0% |
| 25 | 25.0 | 17 ms | 116 ms | 187 ms | 0.0% |
| 50 | 50.0 | 10 ms | 41 ms | 86 ms | 0.0% |

**visitors · 100,000 signers · 0.5 CPU / 512m** (peak CPU 64%, peak RSS 79 MiB)

| step | req/s | p50 | p95 | p99 | failed |
| --- | --- | --- | --- | --- | --- |
| 50 | 17.4 | 1 ms | 3 ms | 5 ms | 0.0% |
| 200 | 71.5 | 1 ms | 2 ms | 6 ms | 0.0% |
| 500 | 174.8 | 1 ms | 2 ms | 5 ms | 0.0% |
| 1000 | 347.7 | 1 ms | 2 ms | 4 ms | 0.0% |
| 2000 | 696.3 | 0 ms | 11 ms | 94 ms | 0.0% |
| 4000 | 1398.1 | 0 ms | 67 ms | 320 ms | 0.3% |
| 8000 | 2864.8 | 0 ms | 21 ms | 96 ms | 0.5% |
