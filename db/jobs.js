// Durable background jobs via Honker (https://honker.dev).
//
// Honker is a SQLite loadable extension exposing `honker_*` SQL functions for
// durable at-least-once queues + a cron scheduler. We load it into the app's
// existing SQLCipher-keyed connection and drive it via SQL — so job rows live in
// the same encrypted database (encrypted at rest), enqueue is consistent with
// business writes, and we avoid honker-bun's own `setCustomSQLite`/unkeyed
// connections (which are incompatible with SQLCipher).
//
// A single poll loop drives the scheduler tick, reclaims expired claims, and
// processes each registered queue. Handlers ack on success, retry-with-backoff
// on throw (Honker dead-letters automatically after maxAttempts).
import process from "node:process";
import { db } from "./connection.js";

function defaultExt() {
  if (process.env.HONKER_EXTENSION_PATH) return process.env.HONKER_EXTENSION_PATH;
  if (process.platform === "darwin") return "./vendor/libhonker_ext.dylib";
  return "/app/vendor/libhonker_ext.so";
}

const EXT = defaultExt();
const WORKER_ID = `w-${process.pid}`;

let started = false;
const timers = new Set();
let booted = false;

// Load the extension into the keyed connection and create Honker's tables.
export async function initJobs() {
  if (booted) return;
  await db.loadExtension(EXT);
  await db.run("SELECT honker_bootstrap()");
  booted = true;
  console.log(`[jobs] Honker extension loaded (${EXT})`);
}

// honker_enqueue(queue, payload, delay, runAt, priority, maxAttempts, expires)
export async function enqueue(
  queue,
  payload,
  { runAt = null, delay = null, priority = 0, maxAttempts = 5, expires = null } = {},
) {
  const row = await db
    .query("SELECT honker_enqueue(?, ?, ?, ?, ?, ?, ?) AS id")
    .get(queue, JSON.stringify(payload), delay, runAt, priority, maxAttempts, expires);
  return row.id;
}

// Honker's tables only exist once initJobs() ran; without the extension there
// are no jobs to clean up.
async function ignoreMissingTables(fn) {
  try {
    return await fn();
  } catch (err) {
    if (/no such table/i.test(String(err?.message))) return 0;
    throw err;
  }
}

// Remove dead-lettered jobs of `queue` that died more than `olderThanS` seconds
// ago. Honker never deletes from _honker_dead by itself (expired jobs land there
// too), so without this a failed mail's payload would be kept forever.
export async function purgeDeadJobs(queue, olderThanS) {
  return ignoreMissingTables(async () => {
    const res = await db
      .query(
        `DELETE FROM _honker_dead /* public-neutral */
         WHERE queue = ? AND died_at < unixepoch() - ?`,
      )
      .run(queue, olderThanS);
    return res?.changes ?? 0;
  });
}

// Remove pending and dead jobs of `queue` whose JSON payload has `field` equal
// to `value` — used when the person a job is about gets erased.
export async function deleteJobsByPayload(queue, field, value) {
  return ignoreMissingTables(async () => {
    let removed = 0;
    for (const table of ["_honker_live", "_honker_dead"]) {
      const res = await db
        .query(
          `DELETE FROM ${table} /* public-neutral */
           WHERE queue = ? AND json_extract(payload, '$.' || ?) = ?`,
        )
        .run(queue, field, value);
      removed += res?.changes ?? 0;
    }
    return removed;
  });
}

// Register an idempotent recurring task (cron or `@every Ns`) that enqueues
// `payload` into `queue` when due.
export async function registerSchedule(name, queue, expr, payload = {}, { priority = 0, expires = null } = {}) {
  await db.query("SELECT honker_scheduler_register(?, ?, ?, ?, ?, ?) AS v").get(
    name,
    queue,
    expr,
    JSON.stringify(payload),
    priority,
    expires,
  );
}

// Start the poll loop. `handlers` maps queue name -> async (payload, job) => {}.
// `concurrency` (per queue, default 1) is how many claimed jobs run at once.
// Transactional email needs more than 1: a provider round-trip is ~100-300ms,
// so strictly sequential sends would cap the queue at a handful per second and
// a sign-up burst would take minutes to drain.
//
// `isolated` queues get a poll loop of their own. The main loop awaits each
// handler before moving to the next queue, so a long handler (a campaign send
// runs for many minutes) would otherwise hold up every queue after it —
// including the verification mail of someone signing up during the send.
export function startWorker(handlers, {
  queues = Object.keys(handlers),
  intervalMs = 1000,
  batch = 5,
  visibilityS = 1800,
  concurrency = {},
  isolated = [],
} = {}) {
  if (started) return;
  started = true;

  const tick = db.query("SELECT honker_scheduler_tick(?) AS v");
  const sweep = db.query("SELECT honker_sweep_expired(?) AS v");
  const claim = db.query("SELECT honker_claim_batch(?, ?, ?, ?) AS rows");
  const ack = db.query("SELECT honker_ack(?, ?) AS v");
  const retry = db.query("SELECT honker_retry(?, ?, ?, ?) AS v");

  async function loop(loopQueues, withTick) {
    try {
      if (withTick) await tick.get(Math.floor(Date.now() / 1000));

      for (const queue of loopQueues) {
        await sweep.get(queue);
        const res = await claim.get(queue, WORKER_ID, batch, visibilityS);
        const jobs = res?.rows ? JSON.parse(res.rows) : [];

        const runJob = async (job) => {
          let payload;
          try {
            payload = JSON.parse(job.payload);
          } catch {
            payload = job.payload;
          }
          try {
            await handlers[queue](payload, job);
            await ack.get(job.id, WORKER_ID);
          } catch (err) {
            const backoff = Math.min(600, 5 * (job.attempts || 1));
            await retry.get(job.id, WORKER_ID, backoff, String(err?.message || err));
            console.error(
              `[jobs] ${queue}#${job.id} failed (attempt ${job.attempts}): ${err?.message || err}`,
            );
          }
        };

        // Handlers may overlap; ack/retry still go through the shared
        // connection, which serialises them.
        const width = Math.max(1, concurrency[queue] || 1);
        for (let i = 0; i < jobs.length; i += width) {
          await Promise.all(jobs.slice(i, i + width).map(runJob));
        }
      }
    } catch (err) {
      console.error("[jobs] loop error:", err);
    } finally {
      if (started) {
        const t = setTimeout(() => {
          timers.delete(t);
          loop(loopQueues, withTick);
        }, intervalMs);
        timers.add(t);
      }
    }
  }

  const shared = queues.filter((q) => !isolated.includes(q));
  loop(shared, true);
  for (const q of queues.filter((q) => isolated.includes(q))) loop([q], false);
  console.log(`[jobs] worker started (queues: ${queues.join(", ")})`);
}

export function stopWorker() {
  started = false;
  for (const t of timers) clearTimeout(t);
  timers.clear();
}
