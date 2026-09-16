import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { db } from "../db/connection.js";
import { resetDb } from "./helpers.js";
import {
  initJobs,
  enqueue,
  registerSchedule,
  startWorker,
  stopWorker,
  purgeDeadJobs,
  deleteJobsByPayload,
} from "../db/jobs.js";

const hasExt = existsSync(process.env.HONKER_EXTENSION_PATH || "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const liveCount = async () =>
  (await db.query("SELECT COUNT(*) c FROM _honker_live").get()).c;
const deadCount = async () =>
  (await db.query("SELECT COUNT(*) c FROM _honker_dead").get()).c;

describe.skipIf(!hasExt)("Honker durable jobs", () => {
  beforeAll(() => initJobs());
  beforeEach(resetDb);
  afterEach(() => stopWorker());

  test("enqueue -> worker claims -> handler runs -> ack", async () => {
    const seen = [];
    await enqueue("emails", { to: "a@b.c" });
    startWorker({ emails: async (p) => seen.push(p.to) }, { intervalMs: 30 });
    await sleep(250);
    expect(seen).toEqual(["a@b.c"]);
    expect(await liveCount()).toBe(0); // acked + removed
  });

  test("throwing handler does not ack — job stays for retry", async () => {
    let calls = 0;
    await enqueue("flaky", { n: 1 }, { maxAttempts: 5 });
    startWorker(
      {
        flaky: async () => {
          calls++;
          throw new Error("boom");
        },
      },
      { intervalMs: 30 },
    );
    await sleep(250);
    stopWorker();
    expect(calls).toBeGreaterThanOrEqual(1);
    // retry re-queues with a backoff delay -> still present, not dead-lettered yet
    expect(await liveCount()).toBe(1);
  });

  test("scheduler tick enqueues recurring jobs", async () => {
    const seen = [];
    await registerSchedule("ping", "ticks", "@every 1s", { task: "ping" });
    startWorker({ ticks: async (p) => seen.push(p.task) }, { intervalMs: 50 });
    await sleep(1400);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toBe("ping");
  });

  test("concurrency lets a batch overlap instead of running one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let done = 0;
    for (let i = 0; i < 8; i++) await enqueue("emails", { n: i });

    startWorker(
      {
        emails: async () => {
          maxInFlight = Math.max(maxInFlight, ++inFlight);
          await sleep(40);
          inFlight--;
          done++;
        },
      },
      { intervalMs: 30, batch: 8, concurrency: { emails: 4 } },
    );
    await sleep(400);
    stopWorker();

    expect(done).toBe(8);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  test("without concurrency, jobs run strictly one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    for (let i = 0; i < 4; i++) await enqueue("emails", { n: i });

    startWorker(
      {
        emails: async () => {
          maxInFlight = Math.max(maxInFlight, ++inFlight);
          await sleep(20);
          inFlight--;
        },
      },
      { intervalMs: 30, batch: 4 },
    );
    await sleep(300);
    stopWorker();

    expect(maxInFlight).toBe(1);
  });

  test("job payloads are stored in the encrypted DB", async () => {
    await enqueue("secretq", { secret: "TOPSECRET_VALUE" });
    const bytes = Bun.file(process.env.DATABASE_PATH).size;
    expect(bytes).toBeGreaterThan(0);
    // value is retrievable through the keyed connection
    const row = await db.query("SELECT COUNT(*) c FROM _honker_live WHERE queue='secretq'").get();
    expect(row.c).toBe(1);
  });

  test("an exhausted email job is dead-lettered, then purged after the TTL", async () => {
    await enqueue("emails", { kind: "verification", signerId: 7 }, { maxAttempts: 1 });
    startWorker(
      { emails: async () => { throw new Error("provider down"); } },
      { intervalMs: 30 },
    );
    await sleep(250);
    stopWorker();
    expect(await liveCount()).toBe(0);
    expect(await deadCount()).toBe(1);

    // Died just now: kept for the TTL.
    expect(await purgeDeadJobs("emails", 24 * 3600)).toBe(0);
    await db.run("UPDATE _honker_dead SET died_at = unixepoch() - 25 * 3600");
    expect(await purgeDeadJobs("emails", 24 * 3600)).toBe(1);
    expect(await deadCount()).toBe(0);
  });

  test("purging dead jobs leaves other queues alone", async () => {
    await db.run(
      `INSERT INTO _honker_dead (id, queue, payload, died_at)
       VALUES (1, 'emails', '{}', unixepoch() - 90000),
              (2, 'campaigns', '{}', unixepoch() - 90000)`,
    );
    expect(await purgeDeadJobs("emails", 24 * 3600)).toBe(1);
    expect(await deadCount()).toBe(1);
  });

  test("erasing a signer removes their pending and dead email jobs", async () => {
    await enqueue("emails", { kind: "verification", signerId: 42 });
    await enqueue("emails", { kind: "verification", signerId: 43 });
    await db.run(
      `INSERT INTO _honker_dead (id, queue, payload) VALUES (99, 'emails', '{"kind":"deletion","signerId":42}')`,
    );
    expect(await deleteJobsByPayload("emails", "signerId", 42)).toBe(2);
    expect(await liveCount()).toBe(1);
    expect(await deadCount()).toBe(0);
  });
});
