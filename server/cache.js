// Tiny in-process cache for the public read endpoints.
//
// Every visible tab polls /api/stats + /api/signers every 10s, and those run
// full-table aggregates over `signers`. With a few hundred tabs open that is
// hundreds of identical scans per second on the one shared SQLCipher
// connection: the load test found the server falling over there long before
// writes or memory became a problem.
//
// Three mechanisms:
//   * single-flight: concurrent callers asking for the same key share one
//     in-flight query instead of each starting their own. This is what carries
//     the load: at 1,000 open tabs the same aggregate was being computed ~200
//     times a second.
//   * invalidation on write: see `invalidate` below. This is what keeps the
//     cache correct, so reads are never stale with respect to this process.
//   * TTL, with stale-while-revalidate: a value older than `ttlMs` is still
//     returned immediately while one refresh runs behind it. Serving the old
//     value here is safe precisely because no write has happened: it is still
//     the current answer, and the refresh only guards against changes made
//     outside this process.
const entries = new Map();

// The TTL is not the freshness mechanism; writes are (see `invalidate`). It
// only bounds how long a value can survive a change this process did not make
// itself: a direct edit of the database file, a restored backup, a second
// instance. Those are rare and operator-driven, so the TTL is generous; a short
// one would just pay for a full re-scan every few seconds for nothing.
const DEFAULT_TTL_MS = Number(process.env.CACHE_TTL_MS || 60_000);
// Bounds memory when keys vary (e.g. one entry per search term).
const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);

let stopped = false;

function refresh(fn, ttlMs, entry) {
  entry.refreshing = (async () => {
    try {
      const value = await fn();
      entry.value = value;
      entry.hasValue = true;
      entry.expires = Date.now() + ttlMs;
      return value;
    } finally {
      entry.refreshing = null;
    }
  })();
  return entry.refreshing;
}

export function cached(key, fn, ttlMs = DEFAULT_TTL_MS) {
  if (ttlMs <= 0) return fn();
  const now = Date.now();
  let entry = entries.get(key);

  if (entry) {
    // Refresh insertion order so the LRU eviction below keeps hot keys.
    entries.delete(key);
    entries.set(key, entry);

    if (entry.hasValue) {
      if (entry.expires <= now && !entry.refreshing && !stopped) {
        // Stale: kick off one refresh, but answer from the old value now. A
        // failing refresh must not reject this caller, nor poison the entry.
        refresh(fn, ttlMs, entry).catch((err) => {
          console.error(`[cache] refresh failed for ${key}:`, err?.message || err);
        });
      }
      return Promise.resolve(entry.value);
    }
    // First call still in flight: join it rather than starting a second query.
    if (entry.refreshing) return entry.refreshing;
  }

  entry = { value: undefined, hasValue: false, expires: 0, refreshing: null };
  entries.set(key, entry);
  const first = refresh(fn, ttlMs, entry).catch((err) => {
    // Never leave a failed cold start behind; the next caller retries.
    if (!entry.hasValue) entries.delete(key);
    throw err;
  });

  if (entries.size > MAX_ENTRIES) {
    for (const k of entries.keys()) {
      if (k === key) continue;
      entries.delete(k);
      if (entries.size <= MAX_ENTRIES) break;
    }
  }
  return first;
}

// Called after anything that changes what the public endpoints return. This,
// not the TTL, is what keeps the cache correct.
//
// Entries are dropped, not merely aged: the next read re-queries and therefore
// sees the write. Someone who has just confirmed their signature lands on a
// page showing their own name, which is the whole point of the confirmation.
// That costs the next reader one query, but single-flight means it is one
// query no matter how many readers arrive during it; the measured cost at
// 100k signers is tens of milliseconds, not the seconds it would have been
// before `idx_signers_public` (see db/schema.sql).
export function invalidate() {
  entries.clear();
}

// Stop serving and refreshing. Call before closing the database so a refresh
// can't fire a query at a connection that is going away.
export function stopCache() {
  stopped = true;
  entries.clear();
}

export function cacheSize() {
  return entries.size;
}
