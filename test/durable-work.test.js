import { test, expect, beforeEach } from "bun:test";
import { db, resetDb, addVerifiedSigner } from "./helpers.js";
import { existsSync } from "node:fs";
import { createDurableWork } from "../server/durable-work.js";
import { initJobs, enqueue } from "../db/jobs.js";
import { createRequestDrain } from "../server/request-drain.js";
import { openEncrypted, DB_PATH } from "../db/connection.js";

beforeEach(resetDb);
test("unavailable queue rejects work before a mutation, and enqueue errors roll mutations back", async () => {
  let calls = 0;
  const work = createDurableWork(db, {
    enqueue: async () => {
      throw new Error("fixture enqueue failed");
    },
    ttl: 60,
  });
  await expect(
    work.run(() => {
      calls++;
    }),
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(0);
  work.available();
  await expect(
    work.run(async () => {
      await addVerifiedSigner();
      await work.email("verification", { signerId: 1 });
    }),
  ).rejects.toThrow("fixture enqueue failed");
  expect((await db.query("SELECT COUNT(*) n FROM signers").get()).n).toBe(0);
});
test.skipIf(!existsSync(process.env.HONKER_EXTENSION_PATH || ""))(
  "actual Honker enqueue rolls back with business rows",
  async () => {
    await initJobs();
    const work = createDurableWork(db, { enqueue, ttl: 60 });
    work.available();
    await expect(
      work.run(async () => {
        const signer = await addVerifiedSigner();
        await work.email("verification", { signerId: signer.id });
        throw new Error("rollback both");
      }),
    ).rejects.toThrow("rollback both");
    expect((await db.query("SELECT COUNT(*) n FROM signers").get()).n).toBe(0);
    expect(
      (await db.query("SELECT COUNT(*) n FROM _honker_live").get()).n,
    ).toBe(0);
  },
);
test.skipIf(!existsSync(process.env.HONKER_EXTENSION_PATH || ""))(
  "durable enqueue uses the supplied transaction connection",
  async () => {
    await initJobs();
    const connection = await openEncrypted(DB_PATH);
    try {
      await connection.loadExtension(process.env.HONKER_EXTENSION_PATH);
      const work = createDurableWork(connection, { enqueue, ttl: 60 });
      work.available();
      await expect(
        work.run(async () => {
          await connection
            .query(
              "INSERT INTO signers(name,email) VALUES ('Fixture','connection@example.org')",
            )
            .run();
          await work.email("verification", { signerId: 1 });
          throw new Error("rollback supplied connection");
        }),
      ).rejects.toThrow("rollback supplied connection");
      expect((await db.query("SELECT COUNT(*) n FROM signers").get()).n).toBe(
        0,
      );
      expect(
        (await db.query("SELECT COUNT(*) n FROM _honker_live").get()).n,
      ).toBe(0);
    } finally {
      await connection.close();
    }
  },
);
test("request draining finishes whole operations and refuses new ones", async () => {
  const drain = createRequestDrain();
  let release;
  let completed = false;
  const options = drain.options({
    routes: {
      "/erase": {
        POST: async () => {
          await new Promise((r) => (release = r));
          completed = true;
          return new Response("done");
        },
      },
    },
  });
  const pending = options.routes["/erase"].POST();
  await Promise.resolve();
  const closing = drain.close();
  expect(completed).toBe(false);
  expect(options.routes["/erase"].POST().status).toBe(503);
  release();
  await closing;
  expect((await pending).status).toBe(200);
  expect(completed).toBe(true);
});
