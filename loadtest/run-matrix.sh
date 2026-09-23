#!/usr/bin/env bash
# Runs the load-test matrix: for each dataset size, seed once; for each CPU/RAM
# tier, restore the seeded DB, start the app under those limits, run the k6
# scenarios and sample container CPU/RSS. Writes loadtest/results/<date>/raw/.
#
#   DATASETS="1000 10000 100000" TIERS="0.5:512m 1:1g 2:2g 4:4g" ./loadtest/run-matrix.sh
#   SCENARIOS="visitors signup mixed"   # which runs per tier (default: visitors signup)
set -euo pipefail
cd "$(dirname "$0")"

DATASETS=${DATASETS:-"1000 10000 100000"}
TIERS=${TIERS:-"0.5:512m 1:1g 2:2g 4:4g"}
SCENARIOS=${SCENARIOS:-"visitors signup"}
OUT=${OUT:-results/$(date +%Y-%m-%d)}
RAW="$OUT/raw"
mkdir -p "$RAW"

[ -f .env.loadtest ] || ./gen-env.sh

dc() { docker compose -f docker-compose.yml "$@"; }

wait_healthy() {
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null http://127.0.0.1:3900/api/health; then return 0; fi
    sleep 1
  done
  echo "app did not become healthy" >&2
  dc logs --tail 50 app >&2
  return 1
}

# Streaming `docker stats` emits a line per second; --no-stream would take
# several seconds per sample and miss peaks.
sample_stats() { # $1 = container, $2 = csv
  echo "ts,cpu_pct,mem" > "$2"
  docker stats --format '{{.CPUPerc}},{{.MemUsage}}' "$1" 2>/dev/null |
    while IFS= read -r line; do
      case $line in *%*) echo "$(date +%s),$line" >> "$2" ;; esac
    done
}

start_app() { # $1 cpus, $2 mem
  dc stop app >/dev/null 2>&1 || true
  dc run --rm --no-deps -T app sh -c "rm -f /app/data/diaetendeckel.db-* && cp /app/data/seed.db /app/data/diaetendeckel.db" >/dev/null
  # Exported for every later compose call too, so nothing recreates the app
  # container with different limits mid-run.
  export APP_CPUS=$1 APP_MEM=$2
  dc up -d --force-recreate app mailpit >/dev/null
  wait_healthy
  sleep 5 # let startup work (bundling, state backfill, job worker) settle
}

# Scenario knobs are read inside the k6 container, so forward the ones that are
# set in this shell (TABS, RATES, HOLD, RAMP, LOAD_SHARE, SIGNUP_RATE, SEARCH_RATE).
k6_env() {
  for v in TABS RATES HOLD RAMP LOAD_SHARE SIGNUP_RATE SEARCH_RATE; do
    eval "val=\${$v:-}"
    [ -n "$val" ] && printf ' -e %s=%s' "$v" "$val"
  done
}

run_k6() { # $1 name, $2 script, rest = extra k6 args
  local name=$1 script=$2; shift 2
  local cid; cid=$(dc ps -q app)
  local startup_mem; startup_mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$cid")
  {
    echo "startup_mem=$startup_mem"
    # Proof the limits under test were actually applied to this container.
    echo "limit_nanocpus=$(docker inspect -f '{{.HostConfig.NanoCpus}}' "$cid")"
    echo "limit_memory=$(docker inspect -f '{{.HostConfig.Memory}}' "$cid")"
  } > "$RAW/$name.meta"
  sample_stats "$cid" "$RAW/$name.stats.csv" &
  local sampler=$!
  # shellcheck disable=SC2046  # intentional word splitting of the -e pairs
  dc --profile k6 run --rm --no-deps -T k6 run --quiet $(k6_env) "$@" \
    --summary-export "/results/$(basename "$OUT")/raw/$name.json" "/scripts/$script" \
    > "$RAW/$name.k6.log" 2>&1 || true
  kill "$sampler" 2>/dev/null || true
  pkill -f "docker stats --format {{.CPUPerc}}" 2>/dev/null || true
  wait "$sampler" 2>/dev/null || true
  {
    echo "oom_killed=$(docker inspect -f '{{.State.OOMKilled}}' "$cid")"
    echo "restarts=$(docker inspect -f '{{.RestartCount}}' "$cid")"
    echo "running=$(docker inspect -f '{{.State.Running}}' "$cid")"
  } >> "$RAW/$name.meta"
  dc logs --no-log-prefix app > "$RAW/$name.app.log" 2>&1 || true
  echo "  done $name ($(grep -c . "$RAW/$name.stats.csv") samples)"
}

dc build app >/dev/null

for n in $DATASETS; do
  echo "== dataset $n signers"
  dc down -v >/dev/null 2>&1 || true
  dc run --rm --no-deps -T app sh -c \
    "bun db/setup.js >/dev/null && bun loadtest/seed-bulk.js $n && cp /app/data/diaetendeckel.db /app/data/seed.db && ls -l /app/data/seed.db" \
    | tee "$RAW/seed-$n.log"

  for tier in $TIERS; do
    cpus=${tier%%:*}; mem=${tier##*:}
    tag="n${n}-cpu${cpus}-mem${mem}"
    echo "-- tier $cpus CPU / $mem"
    for sc in $SCENARIOS; do
      if ! start_app "$cpus" "$mem"; then
        echo "startup_failed=1" > "$RAW/$sc-$tag.meta"
        dc logs --no-log-prefix app > "$RAW/$sc-$tag.app.log" 2>&1 || true
        continue
      fi
      case $sc in
        visitors) run_k6 "visitors-$tag" visitors.js ;;
        signup)   run_k6 "signup-$tag" signup.js ;;
        mixed)    run_k6 "mixed-$tag" visitors.js -e MIX=1 ;;
      esac
    done
  done
done

dc stop app mailpit >/dev/null
echo "results in loadtest/$RAW; summarize with: ${HOLD:+HOLD=$HOLD }bun loadtest/summarize.js loadtest/$OUT"
