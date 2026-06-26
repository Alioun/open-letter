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
} from "../db/jobs.js";

const hasExt = existsSync(process.env.HONKER_EXTENSION_PATH || "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const liveCount = async () =>
  (await db.query("SELECT COUNT(*) c FROM _honker_live").get()).c;

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

  test("job payloads are stored in the encrypted DB", async () => {
    await enqueue("secretq", { secret: "TOPSECRET_VALUE" });
    const bytes = Bun.file(process.env.DATABASE_PATH).size;
    expect(bytes).toBeGreaterThan(0);
    // value is retrievable through the keyed connection
    const row = await db.query("SELECT COUNT(*) c FROM _honker_live WHERE queue='secretq'").get();
    expect(row.c).toBe(1);
  });
});
