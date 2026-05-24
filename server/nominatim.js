import { resolveState } from "./states.js";
import { updateSignerState, getSignersNeedingState } from "./db.js";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "GehaltsdeckelJetzt/1.0 (kontakt@gehaltsdeckel.jetzt)";
const WORKER_INTERVAL = 5000;
const RATE_LIMIT_MS = 1100;

const queue = [];
let workerRunning = false;
let lastNominatimCall = 0;

export function enqueueStateResolution(signerId, kreisverband) {
  if (!kreisverband) return;

  const localState = resolveState(kreisverband);
  if (localState) {
    updateSignerState(signerId, localState).catch((err) =>
      console.error(`[state] local update failed for signer ${signerId}:`, err),
    );
    return;
  }

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

    try {
      const state = await resolveViaNominatim(item.kreisverband);
      if (state) {
        await updateSignerState(item.signerId, state);
        console.log(
          `[state] resolved "${item.kreisverband}" -> "${state}" (signer ${item.signerId})`,
        );
      } else {
        console.log(
          `[state] no result for "${item.kreisverband}" (signer ${item.signerId})`,
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

export function startStateWorker() {
  getSignersNeedingState(200)
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
