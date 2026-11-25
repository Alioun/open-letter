import { beforeAll, beforeEach, expect, test } from "bun:test";
import { db } from "../db/connection.js";
import { enqueue, initJobs, requeueDeadJobs } from "../db/jobs.js";
import { createEmailManager } from "../server/email-setup.js";
import cfg from "../config/letter.config.js";

const profile = {
  provider: "smtp",
  from: "Campaign <sender@example.org>",
  host: "smtp.example.org",
  port: 587,
  secure: false,
  user: "main@example.org",
  secret: "fixture-password",
  processor: "Example Mail",
  region: "EU",
};

beforeAll(async () => {
  await initJobs();
  await db.run(await Bun.file("db/publishing.sql").text());
});

beforeEach(async () => {
  await db.run(
    "DELETE FROM email_configuration; DELETE FROM email_attempts; DELETE FROM email_quota; DELETE FROM app_settings WHERE key='email:restored'; DELETE FROM _honker_live; DELETE FROM _honker_dead;",
  );
});

async function activeManager(transport) {
  const manager = await createEmailManager(db, cfg, {
    createTransport: () => ({ verify: async () => {}, sendMail: transport }),
  });
  await manager.save(null, 0, true);
  await manager.save(profile, 1);
  await manager.test(2, "admin@example.org");
  await manager.confirmReceipt(2, manager.status.validation?.id);
  await manager.activate(2);
  return manager;
}

const dropConnection = () => {
  const e = new Error("connection closed");
  e.code = "ECONNECTION";
  return e;
};

const attemptStatus = async (scope) =>
  (
    await db
      .query(
        "SELECT status FROM email_attempts ORDER BY updated_at DESC LIMIT 1",
      )
      .get()
  )?.status;

test("an unclear confirmation mail is sent again instead of waiting for the admin", async () => {
  const messageIds = [];
  let fail = false;
  const manager = await activeManager(async (message) => {
    if (message.to !== "signer@example.org") return;
    messageIds.push(message.messageId);
    if (fail) throw dropConnection();
  });
  fail = true;

  await expect(
    manager.send({ to: "signer@example.org" }, { scope: "verification-1" }),
  ).rejects.toThrow("temporary-delivery");
  expect(await attemptStatus()).toBe("retryable");

  fail = false;
  await db.query("UPDATE email_quota SET next_at=0").run();
  await manager.send({ to: "signer@example.org" }, { scope: "verification-1" });
  expect(await attemptStatus()).toBe("delivered");
  expect(messageIds).toHaveLength(2);
  expect(messageIds[1]).toBe(messageIds[0]);
});

test("an unclear mail left from before the fix is retried when its job runs again", async () => {
  let sent = 0;
  const manager = await activeManager(async (message) => {
    if (message.to === "first@example.org") sent++;
  });
  await manager.send({ to: "first@example.org" }, { scope: "warmup" });
  await db
    .query(
      "UPDATE email_attempts SET status='unresolved' WHERE status='delivered'",
    )
    .run();
  await db.query("UPDATE email_quota SET next_at=0").run();
  await manager.send({ to: "first@example.org" }, { scope: "warmup" });
  expect(sent).toBe(2);
  expect(await attemptStatus()).toBe("delivered");
});

test("the admin settles every unclear campaign mail with one decision and waiting mail goes out", async () => {
  let fail = false;
  const manager = await activeManager(async () => {
    if (fail) throw dropConnection();
  });
  fail = true;
  for (const scope of ["campaign-a", "campaign-b"]) {
    await db.query("UPDATE email_quota SET next_at=0").run();
    await expect(
      manager.send(
        { to: `${scope}@example.org` },
        { scope, priority: "campaign" },
      ),
    ).rejects.toThrow("temporary-delivery");
  }
  const counts = async () =>
    Object.fromEntries(
      (
        await db
          .query(
            "SELECT status, COUNT(*) AS n FROM email_attempts GROUP BY status",
          )
          .all()
      ).map((r) => [r.status, r.n]),
    );
  expect(await counts()).toEqual({ unresolved: 2 });

  const held = await enqueue("emails", { kind: "verification" });
  await db
    .query("SELECT honker_claim_batch('emails', 'test-worker', 1, 60)")
    .get();
  await db
    .query("SELECT honker_retry(?, 'test-worker', 3600, 'held')")
    .get(held);
  expect(
    await db.query("SELECT state FROM _honker_live WHERE id=?").get(held),
  ).toEqual({ state: "scheduled" });
  const revision = manager.status.revision;
  await expect(manager.reconcileAll("maybe", revision)).rejects.toThrow();
  const after = await manager.reconcileAll("retryable", revision);
  expect(await counts()).toEqual({ retryable: 2 });
  expect(after.messages).toEqual([{ status: "retryable", count: 2 }]);
  const wait = await db
    .query("SELECT run_at - unixepoch() AS s FROM _honker_live")
    .get();
  expect(wait.s).toBeLessThanOrEqual(0);

  fail = false;
  await db.query("UPDATE email_quota SET next_at=0").run();
  await manager.send(
    { to: "campaign-a@example.org" },
    { scope: "campaign-a", priority: "campaign" },
  );
  await manager.reconcileAll("delivered", revision);
  expect(await counts()).toEqual({ delivered: 1, retryable: 1 });
});

test("failed mail from the last day is put back in the queue, older failures stay", async () => {
  const dead = (payload, ageS) =>
    db
      .query(
        "INSERT INTO _honker_dead (queue,payload,priority,run_at,attempts,max_attempts,last_error,created_at,died_at) VALUES ('emails',?,0,unixepoch(),5,5,'boom',unixepoch()-?,unixepoch())",
      )
      .run(JSON.stringify(payload), ageS);
  await dead({ kind: "verification", signerId: 1 }, 3600);
  await dead({ kind: "verification", signerId: 2 }, 3 * 86400);

  expect(await requeueDeadJobs("emails", 86400)).toBe(1);
  const live = await db
    .query("SELECT payload, attempts, max_attempts FROM _honker_live")
    .all();
  expect(live.map((j) => JSON.parse(j.payload).signerId)).toEqual([1]);
  expect(live[0]).toMatchObject({ attempts: 0, max_attempts: 5 });
  const left = await db.query("SELECT payload FROM _honker_dead").all();
  expect(left.map((j) => JSON.parse(j.payload).signerId)).toEqual([2]);
});
