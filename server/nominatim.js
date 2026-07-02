import { resolveState, addToCache } from "./states.js";
import {
  updateSignerState,
  getSignersNeedingState,
  upsertKvStateCache,
  bulkUpdateSignerStateByKv,
} from "./db.js";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GehaltsdeckelJetzt/1.0 (kontakt@gehaltsdeckel.jetzt)";
const WORKER_INTERVAL = 5000;
const RATE_LIMIT_MS = 1100;
const FETCH_TIMEOUT_MS = 10000;
// Bounds so a burst of unique, unresolvable Kreisverband names can't grow the
// in-memory queue / dedupe set without limit. The durable cache lives in the DB
// (kv_state_cache), so evicting from processedKvs only risks a re-query.
const MAX_QUEUE = 5000;
const MAX_PROCESSED = 10000;

const queue = [];
const processedKvs = new Set();
let workerRunning = false;
let lastNominatimCall = 0;

function markProcessed(kreisverband) {
  processedKvs.add(kreisverband);
  if (processedKvs.size > MAX_PROCESSED) {
    // Evict the oldest entry (Set preserves insertion order).
    processedKvs.delete(processedKvs.values().next().value);
  }
}

export function enqueueStateResolution(signerId, kreisverband) {
  if (!kreisverband) return;

  const localState = resolveState(kreisverband);
  if (localState) {
    updateSignerState(signerId, localState).catch((err) =>
      console.error(`[state] local update failed for signer ${signerId}:`, err),
    );
    return;
  }

  if (processedKvs.has(kreisverband)) return;
  if (queue.length >= MAX_QUEUE) return;

  queue.push({ signerId, kreisverband });
}

async function resolveViaNominatim(kreisverband) {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastNominatimCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  lastNominatimCall = Date.now();

  const params = new URLSearchParams({
    q: kreisverband,
    countrycodes: "de",
    format: "json",
    addressdetails: "1",
    limit: "1",
  });

  const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Nominatim ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  return data[0]?.address?.state || null;
}

async function processQueue() {
  if (workerRunning) return;
  workerRunning = true;

  try {
    const item = queue.shift();
    if (!item) return;

    if (processedKvs.has(item.kreisverband)) {
      const cached = resolveState(item.kreisverband);
      if (cached) {
        await updateSignerState(item.signerId, cached);
      }
      return;
    }

    try {
      const state = await resolveViaNominatim(item.kreisverband);
      markProcessed(item.kreisverband);

      if (state) {
        await upsertKvStateCache(item.kreisverband, state, "nominatim");
        addToCache(item.kreisverband, state);
        const updated = await bulkUpdateSignerStateByKv(item.kreisverband, state);
        console.log(
          `[state] resolved "${item.kreisverband}" -> "${state}" (${updated} signers updated)`,
        );
      } else {
        await upsertKvStateCache(item.kreisverband, "", "nominatim");
        console.log(
          `[state] no result for "${item.kreisverband}" (marked as checked)`,
        );
      }
    } catch (err) {
      console.error(
        `[state] Nominatim error for "${item.kreisverband}":`,
        err.message,
      );
      queue.push(item);
    }
  } finally {
    workerRunning = false;
  }
}

export function getQueueLength() {
  return queue.length;
}

export function clearProcessedKvs() {
  processedKvs.clear();
}

export async function triggerBackfill() {
  const rows = await getSignersNeedingState();
  for (const row of rows) {
    enqueueStateResolution(row.id, row.kreisverband);
  }
  if (rows.length > 0) {
    console.log(`[state] manual backfill: enqueued ${rows.length} signers`);
  }
  return rows.length;
}

export function startStateWorker() {
  getSignersNeedingState()
    .then((rows) => {
      for (const row of rows) {
        enqueueStateResolution(row.id, row.kreisverband);
      }
      if (rows.length > 0) {
        console.log(`[state] backfill: enqueued ${rows.length} signers`);
      }
    })
    .catch((err) => console.error("[state] backfill error:", err));

  const timer = setInterval(processQueue, WORKER_INTERVAL);
  timer.unref?.();

  console.log("[state] worker started (interval: 5s)");
  return timer;
}
