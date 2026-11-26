import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "bun:test";
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
const waitFor = async (condition) => {
  const deadline = Date.now() + 5000;
  while (!(await condition()) && Date.now() < deadline) await sleep(20);
};
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
    await waitFor(async () => seen.length > 0 && (await liveCount()) === 0);
    expect(seen).toEqual(["a@b.c"]);
    expect(await liveCount()).toBe(0); // acked + removed
  });

  test("throwing handler does not ack, job stays for retry", async () => {
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
    await waitFor(() => calls > 0);
    await stopWorker();
    expect(calls).toBeGreaterThanOrEqual(1);
    // retry re-queues with a backoff delay -> still present, not dead-lettered yet
    expect(await liveCount()).toBe(1);
  });

  test("scheduler tick enqueues recurring jobs", async () => {
    const seen = [];
    await registerSchedule("ping", "ticks", "@every 1s", { task: "ping" });
    startWorker({ ticks: async (p) => seen.push(p.task) }, { intervalMs: 50 });
    await waitFor(() => seen.length > 0);
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
    const deadline = Date.now() + 4000;
    while (done < 8 && Date.now() < deadline) await sleep(20);
    stopWorker();

    expect(done).toBe(8);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  test("without concurrency, jobs run strictly one at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let done = 0;
    for (let i = 0; i < 4; i++) await enqueue("emails", { n: i });

    startWorker(
      {
        emails: async () => {
          maxInFlight = Math.max(maxInFlight, ++inFlight);
          await sleep(20);
          inFlight--;
          done++;
        },
      },
      { intervalMs: 30, batch: 4 },
    );
    await waitFor(() => done === 4);
    stopWorker();

    expect(maxInFlight).toBe(1);
    expect(done).toBe(4);
  });

  test("job payloads are stored in the encrypted DB", async () => {
    await enqueue("secretq", { secret: "TOPSECRET_VALUE" });
    const bytes = Bun.file(process.env.DATABASE_PATH).size;
    expect(bytes).toBeGreaterThan(0);
    // value is retrievable through the keyed connection
    const row = await db
      .query("SELECT COUNT(*) c FROM _honker_live WHERE queue='secretq'")
      .get();
    expect(row.c).toBe(1);
  });

  test("an exhausted email job is dead-lettered, then purged after the TTL", async () => {
    await enqueue(
      "emails",
      { kind: "verification", signerId: 7 },
      { maxAttempts: 1 },
    );
    startWorker(
      {
        emails: async () => {
          throw new Error("provider down");
        },
      },
      { intervalMs: 30 },
    );
    await waitFor(async () => (await deadCount()) === 1);
    await stopWorker();
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

test.skipIf(!hasExt)(
  "quota deferral does not exhaust delivery attempts and expired jobs cannot send",
  async () => {
    await resetDb();
    await initJobs();
    const id = await enqueue(
      "quota-fixture",
      { kind: "verification", signerId: 8 },
      { maxAttempts: 1, expires: 60 },
    );
    startWorker(
      {
        "quota-fixture": async () => {
          const error = new Error("provider-quota");
          error.defer = true;
          error.retryAfterS = 60;
          throw error;
        },
      },
      { intervalMs: 30 },
    );
    await waitFor(async () => {
      const row = await db
        .query("SELECT state,attempts,run_at FROM _honker_live WHERE id=?")
        .get(id);
      return (
        row?.state === "pending" &&
        row.attempts === 0 &&
        row.run_at > Math.floor(Date.now() / 1000)
      );
    });
    stopWorker();
    const job = await db.query("SELECT * FROM _honker_live WHERE id=?").get(id);
    expect(job).toBeTruthy();
    expect(job.attempts).toBe(0);
    await db
      .query("UPDATE _honker_live SET expires_at=unixepoch()-1 WHERE id=?")
      .run(id);
    let sends = 0;
    startWorker(
      {
        "quota-fixture": async () => {
          sends++;
        },
      },
      { intervalMs: 30 },
    );
    await sleep(150);
    stopWorker();
    expect(sends).toBe(0);
  },
);

const laterFixable = () => {
  const error = new Error("temporary-delivery");
  error.transient = true;
  return error;
};
const secondsUntilNextRun = async (id) =>
  (
    await db
      .query("SELECT run_at - unixepoch() AS s FROM _honker_live WHERE id=?")
      .get(id)
  ).s;

describe.skipIf(!hasExt)("a job whose failure a later try can fix", () => {
  beforeAll(() => initJobs());
  beforeEach(resetDb);
  afterEach(() => stopWorker());

  const waiting = (id) =>
    waitFor(async () => {
      const row = await db
        .query("SELECT state, run_at FROM _honker_live WHERE id=?")
        .get(id);
      return (
        row &&
        row.state !== "processing" &&
        row.run_at > Math.floor(Date.now() / 1000)
      );
    });

  test("keeps all its attempts while it is kept, however often it fails", async () => {
    const id = await enqueue(
      "outage-fixture",
      { kind: "verification", signerId: 9 },
      { maxAttempts: 2, expires: 3600 },
    );
    let tries = 0;
    startWorker(
      {
        "outage-fixture": async () => {
          tries++;
          throw laterFixable();
        },
      },
      { intervalMs: 20 },
    );
    for (let n = 1; n <= 4; n++) {
      await waitFor(() => tries >= n);
      await waiting(id);
      expect(tries).toBe(n);
      expect(await deadCount()).toBe(0);
      expect(
        (await db.query("SELECT attempts FROM _honker_live WHERE id=?").get(id))
          .attempts,
      ).toBe(0);
      await db
        .query("UPDATE _honker_live SET run_at = unixepoch() WHERE id=?")
        .run(id);
    }
  });

  test("is tried again soon at first and at most ten minutes later after a long wait", async () => {
    const fresh = await enqueue("outage-fixture", { n: 1 }, { expires: 86400 });
    const old = await enqueue("outage-fixture", { n: 2 }, { expires: 86400 });
    await db
      .query(
        "UPDATE _honker_live SET created_at = unixepoch() - 6 * 3600 WHERE id=?",
      )
      .run(old);
    startWorker(
      {
        "outage-fixture": async () => {
          throw laterFixable();
        },
      },
      { intervalMs: 20 },
    );
    await waiting(fresh);
    await waiting(old);
    await stopWorker();
    expect(await secondsUntilNextRun(fresh)).toBeGreaterThanOrEqual(3);
    expect(await secondsUntilNextRun(fresh)).toBeLessThanOrEqual(30);
    expect(await secondsUntilNextRun(old)).toBeGreaterThan(300);
    expect(await secondsUntilNextRun(old)).toBeLessThanOrEqual(600);
  });

  test("is given up on after its attempts when nothing ends its wait", async () => {
    await enqueue("outage-fixture", { n: 1 }, { maxAttempts: 1 });
    startWorker(
      {
        "outage-fixture": async () => {
          throw laterFixable();
        },
      },
      { intervalMs: 20 },
    );
    await waitFor(async () => (await deadCount()) === 1);
    expect(await liveCount()).toBe(0);
    expect(await deadCount()).toBe(1);
  });
});

test.skipIf(!hasExt)(
  "a failure that will repeat uses up a kept job's attempts",
  async () => {
    await resetDb();
    await initJobs();
    await enqueue(
      "outage-fixture",
      { n: 1 },
      { maxAttempts: 1, expires: 3600 },
    );
    startWorker(
      {
        "outage-fixture": async () => {
          throw new Error("recipient-rejected");
        },
      },
      { intervalMs: 20 },
    );
    await waitFor(async () => (await deadCount()) === 1);
    await stopWorker();
    expect(await liveCount()).toBe(0);
    expect(await deadCount()).toBe(1);
  },
);
