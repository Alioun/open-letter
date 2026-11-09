import { test, expect, beforeEach, afterEach } from "bun:test";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import {
  createEmailManager,
  cleanProfile,
  deploymentProfile,
  smtpOptions,
  diagnostic,
} from "../server/email-setup.js";
import { dnsInstructions, checkMailboxDns } from "../server/mailbox-dns.js";
import cfg from "../config/letter.config.js";
let connection;
beforeEach(async () => {
  connection = await openEncrypted(DB_PATH);
  await connection.run(await Bun.file("db/publishing.sql").text());
  await connection.run(
    "DELETE FROM email_configuration; DELETE FROM email_attempts; DELETE FROM email_quota; DELETE FROM app_settings WHERE key='email:restored';",
  );
});
afterEach(async () => {
  await connection.close();
});
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

test("an unmatched legacy attempt expires by its original age after a later retry", async () => {
  const old = "2026-01-01T00:00:00.000Z";
  const manager = await createEmailManager(connection, cfg);
  await connection
    .query(
      `INSERT INTO email_attempts
    (scope,profile_revision,provider,status,correlation_id,updated_at,created_at)
    VALUES ('unmatched-fixture',0,'smtp','attempting','fixture-id',?,?)`,
    )
    .run(new Date().toISOString(), old);
  await manager.purge();
  expect(
    await connection
      .query("SELECT 1 FROM email_attempts WHERE scope='unmatched-fixture'")
      .get(),
  ).toBeFalsy();
});
test("credentials cannot be redirected to a different server/account; TLS is mandatory", () => {
  expect(() =>
    cleanProfile({
      provider: "resend",
      from: "sender@example.org",
      secret: "fixture-api-key",
      region: "",
    }),
  ).toThrow("Verarbeitungsregion");
  const p = cleanProfile(profile);
  expect(smtpOptions(p)).toMatchObject({
    requireTLS: true,
    opportunisticTLS: false,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  expect(() =>
    cleanProfile({ ...p, host: "other.example.org", secret: "" }, p),
  ).toThrow("neue Zugangsdaten");
  expect(() =>
    cleanProfile({ ...p, user: "other@example.org", secret: "" }, p),
  ).toThrow();
  expect(cleanProfile({ ...p, secret: "" }, p).secret).toBe(p.secret);
  expect(
    deploymentProfile(cfg, { EMAIL_PROVIDER: "", SMTP_HOST: "" }).provider,
  ).toBe(cfg.email.provider);
  const mailbox = cleanProfile({
    ...profile,
    provider: "mailbox.org",
    port: 465,
  });
  expect(smtpOptions(mailbox)).toMatchObject({
    host: "smtp.mailbox.org",
    secure: true,
    tls: { rejectUnauthorized: true },
  });
});
test("test/receipt/activation is bound to revision and never returns secrets", async () => {
  let delivered = 0;
  const manager = await createEmailManager(connection, cfg, {
    createTransport: () => ({
      verify: async () => {},
      sendMail: async () => {
        delivered++;
      },
    }),
  });
  await manager.save(null, 0, true);
  await manager.save(profile, 1);
  await manager.test(2, "admin@example.org");
  expect(manager.status.validation).toMatchObject({
    recipient: "admin@example.org",
    profileRevision: 2,
    revision: 2,
    accepted: true,
    received: false,
  });
  expect(JSON.stringify(manager.status)).not.toContain(profile.secret);
  await expect(manager.activate(2)).rejects.toThrow(
    "Bestätige vor der Aktivierung den Empfang",
  );
  await manager.confirmReceipt(2, manager.status.validation?.id);
  await manager.activate(2);
  expect(manager.status.ready).toBe(true);
  await expect(manager.save(profile, 1)).rejects.toMatchObject({ status: 409 });
  await manager.send(
    { to: "person@example.org", subject: "Test", html: "<p>fixture</p>" },
    { scope: "dedupe-fixture" },
  );
  await manager.send(
    { to: "person@example.org", subject: "Test", html: "<p>fixture</p>" },
    { scope: "dedupe-fixture" },
  );
  expect(delivered).toBe(2); // setup test plus one delivery
  const attempts = await connection.query("SELECT * FROM email_attempts").all();
  expect(attempts[0].profile_revision).toBe(2);
  expect(attempts[0].status).toBe("delivered");
  const restarted = await createEmailManager(connection, cfg);
  expect(restarted.status.ready).toBe(true);
  await connection
    .query(
      "INSERT INTO app_settings (key,value) VALUES ('email:restored','fixture-restore')",
    )
    .run();
  const restored = await createEmailManager(connection, cfg);
  expect(restored.status.ready).toBe(false);
  expect(restored.status.validation).toBeNull();
});
test("receipt confirmation identifies the persisted test and refuses approval of a replaced test", async () => {
  const manager = await createEmailManager(connection, cfg, {
    createTransport: () => ({
      verify: async () => {},
      sendMail: async () => {},
    }),
  });
  await manager.save(null, 0, true);
  await manager.save(profile, 1);
  await manager.test(2, "first@example.org");
  const first = manager.status.validation;
  const restarted = await createEmailManager(connection, cfg);
  expect(restarted.status.validation).toEqual(first);
  expect(first.recipient).toBe("first@example.org");
  expect(Number.isFinite(new Date(first.checkedAt).getTime())).toBe(true);
  await manager.test(2, "second@example.org");
  expect(manager.status.validation.id).not.toBe(first.id);
  await expect(manager.confirmReceipt(2, first.id)).rejects.toThrow("veraltet");
  expect(manager.status.validation.received).toBe(false);
  await manager.confirmReceipt(2, manager.status.validation.id);
  expect(manager.status.validation.received).toBe(true);
  expect(manager.status.validation.recipient).toBe("second@example.org");
});
test("diagnostics contain no raw error or recipient; DNS verifies publication only", async () => {
  const d = diagnostic({
    message: "secret recipient@example.org",
    responseCode: 535,
    code: "EAUTH",
  });
  expect(d.category).toBe("authentication");
  expect(JSON.stringify(d)).not.toContain("recipient");
  const instructions = dnsInstructions("example.org", "token");
  const resolver = {
    resolveTxt: async (name) => [
      [
        name.startsWith("_campaign")
          ? "campaign-verification=token"
          : name.startsWith("_dmarc")
            ? "v=DMARC1; p=reject"
            : "v=spf1 include:mailbox.org -all",
      ],
    ],
    resolveCname: async (name) => [
      `${name.split(".")[0].toLowerCase()}._domainkey.mailbox.org.`,
    ],
  };
  const result = await checkMailboxDns("example.org", "token", resolver);
  expect(result.results.every((r) => r.published)).toBe(true);
  expect(result.results.filter((r) => r.type === "CNAME")).toHaveLength(4);
  expect(instructions.notice).toContain(
    "bestätigt weder die Signierung noch den Empfang",
  );
  expect(instructions.records.some((r) => r.type === "MX")).toBe(false);
});

test("replacement tests leave the active transport available; stale test results are rejected", async () => {
  let release;
  let slow = false;
  const sent = [];
  const manager = await createEmailManager(connection, cfg, {
    createTransport: (options) => ({
      verify: async () => {
        if (slow)
          await new Promise((r) => {
            release = r;
          });
      },
      sendMail: async (payload) => {
        sent.push({ host: options.host, to: payload.to });
      },
    }),
  });
  await manager.save(null, 0, true);
  await manager.save(profile, 1);
  await manager.test(2, "admin@example.org");
  await manager.confirmReceipt(2, manager.status.validation?.id);
  await manager.activate(2);
  await manager.save({ ...profile, host: "replacement.example.org" }, 2);
  slow = true;
  const pending = manager.test(3, "admin@example.org");
  while (!release) await Bun.sleep(1);
  await manager.send(
    { to: "person@example.org", subject: "Active", html: "<p>active</p>" },
    { scope: "during-test" },
  );
  expect(sent.at(-1).host).toBe(profile.host);
  await manager.save({ ...profile, host: "third.example.org" }, 3);
  release();
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(manager.status.validation).toBeNull();
  expect(manager.status.ready).toBe(true);
});

test("quota waits preserve provider revision across cutover and restart", async () => {
  let refused = false;
  const sends = [];
  const manager = await createEmailManager(connection, cfg, {
    request: async (p, path) => {
      expect(path).toBe("emails"); // Sending-only Resend keys need no domains permission.
      sends.push(p.revision);
      if (refused) {
        refused = false;
        const e = new Error("secret recipient@example.org");
        e.status = 429;
        e.retryAfterS = 600;
        throw e;
      }
      return { id: "fixture" };
    },
  });
  const apiProfile = {
    ...profile,
    provider: "resend",
    user: "account-1",
    region: "EU",
  };
  await manager.save(null, 0, true);
  await manager.save(apiProfile, 1);
  await manager.test(2, "admin@example.org");
  await manager.confirmReceipt(2, manager.status.validation?.id);
  await manager.activate(2);
  refused = true;
  await expect(
    manager.send({ to: "person@example.org" }, { scope: "original-attempt" }),
  ).rejects.toMatchObject({ defer: true, retryAfterS: 600 });
  expect(manager.status.ready).toBe(true);
  await manager.save(
    { ...apiProfile, user: "account-2", secret: "fresh-api-key" },
    2,
  );
  await manager.test(3, "admin@example.org");
  await manager.confirmReceipt(3, manager.status.validation?.id);
  await manager.activate(3);
  await connection
    .query("UPDATE email_quota SET next_at=0,cooldown_until=0")
    .run();
  const restarted = await createEmailManager(connection, cfg, {
    request: async (p) => {
      sends.push(p.revision);
      return { id: "old-profile-retry" };
    },
  });
  await restarted.send(
    { to: "person@example.org" },
    { scope: "original-attempt" },
  );
  expect(sends.at(-1)).toBe(2);
  const attempt = await connection.query("SELECT * FROM email_attempts").get();
  expect(attempt.profile_revision).toBe(2);
  expect(attempt.status).toBe("delivered");
});

test("uncertain SMTP outcomes pause for reconciliation and concurrent retries do not duplicate", async () => {
  let sent = 0;
  let fail = false;
  let release;
  const manager = await createEmailManager(connection, cfg, {
    createTransport: () => ({
      verify: async () => {},
      sendMail: async () => {
        sent++;
        if (fail) {
          const e = new Error("lost response for person@example.org");
          e.code = "ECONNECTION";
          throw e;
        }
        if (release === null)
          await new Promise((r) => {
            release = r;
          });
      },
    }),
  });
  await manager.save(null, 0, true);
  await manager.save(profile, 1);
  await manager.test(2, "admin@example.org");
  await manager.confirmReceipt(2, manager.status.validation?.id);
  await manager.activate(2);
  fail = true;
  await expect(
    manager.send({ to: "person@example.org" }, { scope: "uncertain" }),
  ).rejects.toThrow("temporary-delivery");
  await connection.query("UPDATE email_quota SET next_at=0").run();
  await expect(
    manager.send({ to: "person@example.org" }, { scope: "uncertain" }),
  ).rejects.toMatchObject({ defer: true });
  expect(sent).toBe(2);
  const attempt = await connection.query("SELECT * FROM email_attempts").get();
  await manager.reconcile(attempt.scope, "retryable", 2);
  fail = false;
  release = null;
  const pending = manager.send(
    { to: "person@example.org" },
    { scope: "uncertain" },
  );
  while (release === null) await Bun.sleep(1);
  await expect(
    manager.send({ to: "person@example.org" }, { scope: "uncertain" }),
  ).rejects.toMatchObject({ defer: true });
  release();
  await pending;
  expect(sent).toBe(3);
  expect(JSON.stringify(await manager.diagnostics())).not.toContain(
    "person@example.org",
  );
});

test("known authentication failure pauses sending; deployment profiles can revalidate after restoration", async () => {
  const previous = { ...process.env };
  const keys = {
    EMAIL_PROVIDER: "smtp",
    SMTP_HOST: profile.host,
    SMTP_PORT: "587",
    SMTP_USER: profile.user,
    SMTP_PASS: profile.secret,
    EMAIL_FROM: profile.from,
  };
  Object.assign(process.env, keys);
  try {
    await connection
      .query(
        "INSERT INTO app_settings(key,value) VALUES('email:restored','deployment-restore')",
      )
      .run();
    let fail = false;
    const manager = await createEmailManager(connection, cfg, {
      createTransport: () => ({
        verify: async () => {},
        sendMail: async () => {
          if (fail) {
            const e = new Error("raw user@example.org password");
            e.responseCode = 535;
            e.code = "EAUTH";
            throw e;
          }
        },
      }),
    });
    expect(manager.status.source).toBe("deployment");
    expect(manager.status.ready).toBe(false);
    const revision = manager.status.revision;
    await manager.test(revision, "admin@example.org");
    await manager.confirmReceipt(revision, manager.status.validation?.id);
    await manager.activate(revision);
    expect(manager.status.source).toBe("deployment");
    expect(manager.status.ready).toBe(true);
    fail = true;
    await expect(
      manager.send({ to: "person@example.org" }, { scope: "auth-outage" }),
    ).rejects.toThrow("authentication");
    expect(manager.status.ready).toBe(false);
    await expect(
      manager.send({ to: "person@example.org" }, { scope: "paused" }),
    ).rejects.toMatchObject({ defer: true });
    expect(JSON.stringify(manager.status)).not.toContain("raw user");
  } finally {
    for (const key of Object.keys(keys)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
