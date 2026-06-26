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
let timer = null;
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
export function startWorker(handlers, {
  queues = Object.keys(handlers),
  intervalMs = 1000,
  batch = 5,
  visibilityS = 1800,
} = {}) {
  if (started) return;
  started = true;

  const tick = db.query("SELECT honker_scheduler_tick(?) AS v");
  const sweep = db.query("SELECT honker_sweep_expired(?) AS v");
  const claim = db.query("SELECT honker_claim_batch(?, ?, ?, ?) AS rows");
  const ack = db.query("SELECT honker_ack(?, ?) AS v");
  const retry = db.query("SELECT honker_retry(?, ?, ?, ?) AS v");

  async function loop() {
    try {
      await tick.get(Math.floor(Date.now() / 1000));

      for (const queue of queues) {
        await sweep.get(queue);
        const res = await claim.get(queue, WORKER_ID, batch, visibilityS);
        const jobs = res?.rows ? JSON.parse(res.rows) : [];
        for (const job of jobs) {
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
        }
      }
    } catch (err) {
      console.error("[jobs] loop error:", err);
    } finally {
      if (started) timer = setTimeout(loop, intervalMs);
    }
  }

  loop();
  console.log(`[jobs] worker started (queues: ${queues.join(", ")})`);
}

export function stopWorker() {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
