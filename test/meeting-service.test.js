import { beforeEach, afterEach, test, expect } from "bun:test";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import { readFileSync } from "node:fs";
import {
  resetDb,
  db,
  addZoomRegistration,
  addVerifiedSigner,
} from "./helpers.js";
import * as q from "../server/db.js";
import { createMeetingService } from "../server/meeting-service.js";
import { meetingMailing, meetingScope } from "../server/meeting-repository.js";
import { createDurableWork } from "../server/durable-work.js";
import { createEmailManager } from "../server/email-setup.js";
import { ensureEmailAttemptSubjects } from "../db/email-attempts.js";
import config from "../config/letter.config.js";
import { resolvePrivacy } from "../config/privacy.js";

const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const later = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();
let accepted, provider, preparing, enqueueFailure;
let managerConnection;
afterEach(async () => {
  if (managerConnection) await managerConnection.close();
  managerConnection = null;
});

beforeEach(async () => {
  await resetDb();
  await db.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  await ensureEmailAttemptSubjects(db);
  await db.run(`DELETE FROM email_configuration; DELETE FROM email_attempts; DELETE FROM email_quota;
    CREATE TABLE IF NOT EXISTS meeting_test_jobs (id INTEGER PRIMARY KEY,payload TEXT);
    DELETE FROM meeting_test_jobs;`);
  accepted = [];
  provider = async () => {};
  preparing = async () => {};
  enqueueFailure = false;
});

async function harness({ maxRecipientsPerRun } = {}) {
  managerConnection = await openEncrypted(DB_PATH);
  const manager = await createEmailManager(
    managerConnection,
    { email: { provider: "resend", from: "" } },
    {
      request: async (_profile, _path, payload) => {
        if (payload.to === "admin@example.org") return { id: "setup" };
        accepted.push(payload);
        await provider(payload);
        return { id: `fake-${accepted.length}` };
      },
    },
  );
  await manager.save(null, 0, true);
  await manager.save(
    {
      provider: "resend",
      from: "sender@example.org",
      secret: "fixture",
      region: "EU",
    },
    1,
  );
  await manager.test(2, "admin@example.org");
  await manager.confirmReceipt(2, manager.status.validation.id);
  await manager.activate(2);
  await manager.send(
    { to: "admin@example.org", subject: "fixture", html: "<p>fixture</p>" },
    { scope: "fixture-quota" },
  );
  await db.run("UPDATE email_quota SET next_at=0; DELETE FROM email_attempts;");
  const durableWork = createDurableWork(db, {
    ttl: 3600,
    enqueue: async (_queue, payload) => {
      const row = await db
        .query("INSERT INTO meeting_test_jobs(payload) VALUES (?) RETURNING id")
        .get(JSON.stringify(payload));
      if (enqueueFailure) throw new Error("fixture queue failure");
      return row.id;
    },
  });
  durableWork.available();
  const getConfig = async () => {
    const settings = await q.getZoomSettings();
    const eventAt = new Date(settings.zoom_event_at || 0);
    return {
      generation: Number(settings.zoom_generation || 0),
      eventAt,
      eventAtIso: eventAt.toISOString(),
      dateSet: Boolean(settings.zoom_event_at),
      link: settings.zoom_link || "",
      linkOffsetHours: Number(settings.zoom_link_offset_hours || 24),
      reminderOffsetHours: Number(settings.zoom_reminder_offset_hours || 0),
    };
  };
  const service = createMeetingService({
    repository: q.meetingRepository,
    registrations: q,
    durableWork,
    getConfig,
    dispatchEmail: (prepare, options) => manager.send(prepare, options),
    buildMail: async (kind, recipient, _token, config) => {
      await preparing(kind, recipient);
      return {
        to: recipient.email,
        subject: `${kind}:${config.eventAtIso}`,
        html: "<p>fixture</p>",
        attachments:
          kind === "link"
            ? [{ filename: "termin.ics", content: config.eventAtIso }]
            : [],
      };
    },
    getRecipientIdentity: q.getRecipientIdentity,
    authorizeRecipient: q.authorizeRecipient,
    issueUnsubscribeTokenForRecipient: q.issueUnsubscribeTokenForRecipient,
    markDeliveredForRecipient: q.markDeliveredForRecipient,
    retentionMs: 3_600_000,
    maxRecipientsPerRun,
    logger: { error() {} },
  });
  return { service, manager, durableWork, getConfig };
}

async function settings(partial = {}) {
  const current = await q.getZoomSettings();
  await q.setZoomSettings(
    {
      zoom_event_at: later(1),
      zoom_link: "https://example.org/meeting",
      zoom_link_offset_hours: 24,
      zoom_reminder_offset_hours: 0,
      ...partial,
    },
    Number(current.zoom_revision || 0),
  );
}
const queued = async () =>
  (
    await db.query("SELECT payload FROM meeting_test_jobs ORDER BY id").all()
  ).map((row) => JSON.parse(row.payload));

test("held old-event acceptance cannot complete the replacement event; next worker sends its calendar", async () => {
  const { service, getConfig } = await harness();
  await settings();
  await addZoomRegistration({ email: "attendee@example.org" });
  const old = await getConfig();
  const started = gate(),
    release = gate();
  provider = async () => {
    started.resolve();
    await release.promise;
  };
  const running = service.runWorker();
  await started.promise;
  await settings({ zoom_event_at: later(2) });
  const next = await getConfig();
  expect(next.generation).toBe(old.generation + 1);
  release.resolve();
  await running;
  expect(await q.listZoomMailings()).toEqual([]);
  expect(await q.countDelivered(meetingMailing("link", next.generation))).toBe(
    0,
  );
  await service.runWorker();
  expect(accepted.map((payload) => payload.attachments[0].content)).toEqual([
    old.eventAtIso,
    next.eventAtIso,
  ]);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    kind: "link",
    status: "sent",
    recipient_count: 1,
  });
}, 15_000);

test("generation zero keeps legacy claim, log and manager scope identities", async () => {
  const { service } = await harness();
  const eventAt = later(1);
  await db
    .query(
      "INSERT INTO app_settings(key,value) VALUES ('zoom_event_at',?),('zoom_link','https://example.org')",
    )
    .run(eventAt);
  const reg = await addZoomRegistration();
  await q.markDelivered("zoom-link", [reg.email]);
  await service.runWorker();
  expect(accepted).toHaveLength(0);
  expect((await q.listZoomMailings())[0].recipient_count).toBe(1);
  expect(
    meetingScope("link", { generation: 0, eventAtIso: eventAt }, reg),
  ).toBe(`zoom-link:${eventAt}:${reg.id}`);
  expect(
    meetingScope("reminder", { generation: 0, eventAtIso: eventAt }, reg),
  ).toBe(`zoom-reminder:${eventAt}:${reg.email}`);
});

test("date changes and explicit resets advance generation while ordinary edits only advance revision", async () => {
  await settings();
  let saved = await q.getZoomSettings();
  const initial = Number(saved.zoom_generation);
  await q.setZoomSettings(
    { zoom_link: "https://example.org/edited" },
    Number(saved.zoom_revision),
  );
  saved = await q.getZoomSettings();
  expect(Number(saved.zoom_generation)).toBe(initial);
  await q.setZoomSettings(
    { zoom_link: "https://example.org/reset" },
    Number(saved.zoom_revision),
    { resetMailings: true },
  );
  expect(await q.meetingRepository.generation()).toBe(initial + 1);
  const previousGeneration = await q.meetingRepository.generation();
  await q.claimZoomMailing("link", previousGeneration);
  await q.resetZoomMailings();
  const currentGeneration = await q.meetingRepository.generation();
  await q.claimZoomMailing("link", currentGeneration);
  await q.touchZoomMailing("link", previousGeneration);
  await q.markZoomMailing("link", "sent", 100, null, previousGeneration);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    kind: "link",
    status: "sending",
    attempts: 1,
  });
});

test("operational settings, generation and previous-event purge schedule roll back together", async () => {
  await settings({ zoom_event_at: "2020-01-01T12:00:00.000Z" });
  const saved = await q.getZoomSettings();
  const previousPurges = await db
    .query("SELECT value FROM app_settings WHERE key='treffen_previous_purges'")
    .get();
  await db.run(`CREATE TEMP TRIGGER fail_meeting_save BEFORE INSERT ON app_settings
    WHEN NEW.key='zoom_revision' BEGIN SELECT RAISE(ABORT,'fixture settings failure'); END;`);
  try {
    await expect(
      q.setZoomSettings(
        { zoom_event_at: later(1) },
        Number(saved.zoom_revision),
      ),
    ).rejects.toThrow("fixture settings failure");
  } finally {
    await db.run("DROP TRIGGER fail_meeting_save");
  }
  expect(await q.getZoomSettings()).toEqual(saved);
  expect(
    await db
      .query(
        "SELECT value FROM app_settings WHERE key='treffen_previous_purges'",
      )
      .get(),
  ).toEqual(previousPurges);
  await q.setZoomSettings(
    { zoom_event_at: later(1) },
    Number(saved.zoom_revision),
  );
  expect(await q.meetingRepository.generation()).toBe(
    Number(saved.zoom_generation) + 1,
  );
  expect(
    JSON.parse(
      (
        await db
          .query(
            "SELECT value FROM app_settings WHERE key='treffen_previous_purges'",
          )
          .get()
      ).value,
    ).at(-1).purgeAt,
  ).toBe(
    new Date(
      Date.parse("2020-01-01T12:00:00.000Z") +
        resolvePrivacy(config).treffenRetentionMs,
    ).toISOString(),
  );
});

for (const operation of ["opt-out", "erasure"]) {
  test(`a recipient ${operation} after preparation and during account wait prevents submission`, async () => {
    const { service } = await harness();
    await settings();
    await addZoomRegistration({
      email: "first@example.org",
      created_at: new Date(Date.now() + 1000).toISOString(),
    });
    const next = await addZoomRegistration({
      email: "next@example.org",
      created_at: new Date(Date.now() + 2000).toISOString(),
    });
    const prepared = gate();
    preparing = async (_kind, recipient) => {
      if (recipient.id === next.id) prepared.resolve();
    };
    const running = service.runWorker();
    await prepared.promise;
    if (operation === "opt-out") await q.deleteZoomByEmail(next.email);
    else await q.eraseEmail(next.email);
    await running;
    expect(accepted.map((payload) => payload.to)).toEqual([
      "first@example.org",
    ]);
    expect(
      (
        await q.getDeliveredEmails(
          meetingMailing("link", await q.meetingRepository.generation()),
        )
      ).has(next.email),
    ).toBe(false);
  }, 15_000);
}

test("erasing the recipient during its held provider call leaves no acceptance or attempt record", async () => {
  const { service } = await harness();
  await settings();
  const reg = await addZoomRegistration();
  const started = gate(),
    release = gate();
  provider = async () => {
    started.resolve();
    await release.promise;
  };
  const running = service.runWorker();
  await started.promise;
  await q.eraseEmail(reg.email);
  release.resolve();
  await running;
  expect(
    (await db.query("SELECT COUNT(*) AS n FROM mailing_deliveries").get()).n,
  ).toBe(0);
  expect(
    (await db.query("SELECT COUNT(*) AS n FROM email_attempts").get()).n,
  ).toBe(0);
});

test("one worker turn paces three links and three reminders without durable short-spacing retries", async () => {
  const { service } = await harness();
  await settings({ zoom_reminder_offset_hours: 2 });
  for (let i = 0; i < 3; i++) await addZoomRegistration();
  await service.runWorker();
  expect(accepted).toHaveLength(6);
  expect(await q.listZoomMailings()).toMatchObject([
    { kind: "link", status: "sent", attempts: 1, recipient_count: 3 },
    { kind: "reminder", status: "sent", attempts: 1, recipient_count: 3 },
  ]);
}, 20_000);

test("a bounded turn retains unfinished recipients and the next turn resumes without duplicate mail", async () => {
  const { service } = await harness({ maxRecipientsPerRun: 2 });
  await settings();
  for (let i = 0; i < 3; i++) await addZoomRegistration();
  await service.runWorker();
  expect(accepted).toHaveLength(2);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    status: "failed",
    attempts: 0,
  });
  await service.runWorker();
  expect(accepted).toHaveLength(3);
  expect(new Set(accepted.map((payload) => payload.to)).size).toBe(3);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    status: "sent",
    recipient_count: 3,
  });
}, 15_000);

test("registration mutation and queue insertion commit together; queue failure keeps confirmation redeemable", async () => {
  const { service, durableWork } = await harness();
  await settings();
  const signer = await addVerifiedSigner();
  const token = await q.issueUnsubscribeToken(signer.id);
  enqueueFailure = true;
  await expect(
    service.register({ signerToken: token, delegierter: false }),
  ).rejects.toThrow("fixture queue failure");
  expect(await q.getCurrentZoomRegistrationByEmail(signer.email)).toBeNull();
  expect(await queued()).toEqual([]);
  await q.insertZoomPending({
    name: "Pending",
    email: "pending@example.org",
    token: "pending-token",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await expect(service.confirm("pending-token")).rejects.toThrow(
    "fixture queue failure",
  );
  expect(await q.getZoomPendingByToken("pending-token")).toBeTruthy();
  expect(
    await q.getCurrentZoomRegistrationByEmail("pending@example.org"),
  ).toBeNull();
  enqueueFailure = false;
  await service.confirm("pending-token");
  expect(await q.getZoomPendingByToken("pending-token")).toBeNull();
  expect(await queued()).toHaveLength(1);
  const result = await service.register({
    signerToken: token,
    delegierter: false,
  });
  expect(result.isNew).toBe(true);
  const jobs = await queued();
  expect(jobs).toHaveLength(2);
  expect(Object.keys(jobs[1]).sort()).toEqual([
    "generation",
    "kind",
    "messageId",
    "registrationId",
  ]);
  durableWork.unavailable();
  await expect(
    service.register({ signerToken: token, delegierter: false, force: true }),
  ).rejects.toMatchObject({ status: 503 });
  expect(await queued()).toHaveLength(2);
});

test("a queued signup survives cooldown, retries once, and shares link scope with the scheduled worker", async () => {
  const { service } = await harness();
  await settings();
  const signer = await addVerifiedSigner();
  const token = await q.issueUnsubscribeToken(signer.id);
  await service.register({ signerToken: token, delegierter: false });
  const [job] = await queued();
  await db
    .query("UPDATE email_quota SET cooldown_until=?")
    .run(Date.now() + 60_000);
  await expect(service.sendSignup(job)).rejects.toMatchObject({
    defer: true,
    message: "account-cooldown",
  });
  expect(await queued()).toHaveLength(1);
  expect(accepted).toHaveLength(0);
  await db.run("UPDATE email_quota SET cooldown_until=0,next_at=0");
  await service.sendSignup(job);
  await service.sendSignup(job);
  await service.runWorker();
  expect(accepted).toHaveLength(1);
  expect(accepted[0].subject.startsWith("link:")).toBe(true);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    status: "sent",
    recipient_count: 1,
  });
});

test("confirmation replay cannot turn into another message when the link window opens", async () => {
  const { service } = await harness();
  await settings({ zoom_event_at: later(48) });
  const reg = await addZoomRegistration();
  const generation = await q.meetingRepository.generation();
  const job = { registrationId: reg.id, generation };
  await service.sendSignup(job);
  expect(accepted[0].subject.startsWith("confirmation:")).toBe(true);
  await q.setZoomSettings(
    { zoom_link_offset_hours: 72 },
    Number((await q.getZoomSettings()).zoom_revision),
  );
  await service.sendSignup(job);
  expect(accepted).toHaveLength(1);
  await service.runWorker();
  expect(accepted).toHaveLength(2);
  expect(accepted[1].subject.startsWith("link:")).toBe(true);
}, 10_000);

test("an erased queued registration is a no-op", async () => {
  const { service } = await harness();
  await settings();
  const reg = await addZoomRegistration();
  const job = {
    registrationId: reg.id,
    generation: await q.meetingRepository.generation(),
  };
  await q.eraseEmail(reg.email);
  await service.sendSignup(job);
  expect(accepted).toHaveLength(0);
});

test("a deferred signup confirms the current date and keeps replay idempotent", async () => {
  const { service, getConfig } = await harness();
  await settings({ zoom_event_at: later(72) });
  const signer = await addVerifiedSigner();
  const token = await q.issueUnsubscribeToken(signer.id);
  await service.register({ signerToken: token, delegierter: false });
  const [job] = await queued();
  await db
    .query("UPDATE email_quota SET cooldown_until=?")
    .run(Date.now() + 60_000);
  await expect(service.sendSignup(job)).rejects.toMatchObject({
    defer: true,
    message: "account-cooldown",
  });
  await settings({ zoom_event_at: later(96) });
  await db.run("UPDATE email_quota SET cooldown_until=0,next_at=0");
  await service.sendSignup(job);
  await service.sendSignup(job);
  expect(accepted.map((message) => message.subject)).toEqual([
    `confirmation:${(await getConfig()).eventAtIso}`,
  ]);
});

test("delegate edits retain registration identity during an active link mailing", async () => {
  const { service } = await harness();
  await settings();
  const signers = [];
  for (const email of ["first@example.org", "delegate@example.org"]) {
    const signer = await addVerifiedSigner({ email });
    const token = await q.issueUnsubscribeToken(signer.id);
    await service.register({ signerToken: token, delegierter: false });
    signers.push(token);
    await Bun.sleep(5);
  }
  const before = await q.getCurrentZoomRegistrationByEmail(
    "delegate@example.org",
  );
  const started = gate(),
    release = gate();
  provider = async () => {
    started.resolve();
    await release.promise;
  };
  const worker = service.runWorker();
  await started.promise;
  try {
    await service.register({
      signerToken: signers[1],
      delegierter: true,
      force: true,
    });
  } finally {
    release.resolve();
  }
  await worker;
  const after = await q.getCurrentZoomRegistrationByEmail(
    "delegate@example.org",
  );
  expect(after.created_at).toBe(before.created_at);
  expect(after.delegierter).toBe(true);
  expect(accepted.map((message) => message.to)).toEqual([
    "first@example.org",
    "delegate@example.org",
  ]);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    status: "sent",
    recipient_count: 2,
  });
}, 15_000);

test("a date change during signup preparation defers the job until current details can be sent", async () => {
  const { service, getConfig } = await harness();
  await settings({ zoom_event_at: later(72) });
  const reg = await addZoomRegistration();
  const job = {
    registrationId: reg.id,
    generation: await q.meetingRepository.generation(),
  };
  let changed = false;
  preparing = async () => {
    if (!changed) {
      changed = true;
      await settings({ zoom_event_at: later(96) });
    }
  };
  await expect(service.sendSignup(job)).rejects.toMatchObject({
    defer: true,
    message: "meeting-date-changed",
  });
  expect(accepted).toHaveLength(0);
  await service.sendSignup(job);
  expect(accepted.map((message) => message.subject)).toEqual([
    `confirmation:${(await getConfig()).eventAtIso}`,
  ]);
});

test("a date change after preparation and during account wait fences the next old-event recipient", async () => {
  const { service, getConfig } = await harness();
  await settings();
  await addZoomRegistration({
    email: "first@example.org",
    created_at: new Date(Date.now() + 1000).toISOString(),
  });
  const next = await addZoomRegistration({
    email: "next@example.org",
    created_at: new Date(Date.now() + 2000).toISOString(),
  });
  const prepared = gate();
  preparing = async (_kind, recipient) => {
    if (recipient.id === next.id) prepared.resolve();
  };
  const oldConfig = await getConfig();
  const running = service.runWorker();
  await prepared.promise;
  await settings({ zoom_event_at: later(2) });
  await running;
  expect(accepted.map((payload) => payload.to)).toEqual(["first@example.org"]);
  expect(await q.listZoomMailings()).toEqual([]);
  await service.runWorker();
  expect(accepted).toHaveLength(3);
  expect(accepted[0].subject).toContain(oldConfig.eventAtIso);
  expect(accepted[1].subject).not.toContain(oldConfig.eventAtIso);
  expect((await q.listZoomMailings())[0]).toMatchObject({
    status: "sent",
    recipient_count: 2,
  });
}, 15_000);
