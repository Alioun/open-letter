// A sign-up made while no mail can go out: how long it waits for its
// confirmation mail, and from when its link counts.
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAdminServer } from "./fixtures/admin-server.js";

const HOUR = 3600_000;
const mail = mkdtempSync(join(tmpdir(), "open-letter-mail-"));
const lines = (name) =>
  existsSync(join(mail, name))
    ? readFileSync(join(mail, name), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
async function until(read, what) {
  for (let waited = 0; waited < 90_000; waited += 250) {
    const value = await read();
    if (value) return value;
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

let server;
let admin;
beforeAll(async () => {
  server = await startAdminServer({
    env: {
      REQUIRE_API_TOKEN: "false",
      MAIL_FIXTURE_DIR: mail,
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM: "Fixture <fixture@example.invalid>",
      RESEND_API_KEY: "re_fixture_only",
    },
    preload: ["./test/fixtures/mail-outage.js"],
  });
  admin = await server.login();
}, 120_000);
afterAll(async () => {
  await server?.stop();
  rmSync(mail, { recursive: true, force: true });
});

const sign = (name, email) =>
  server.request("/api/sign", {
    method: "POST",
    body: { name, email, agree: true },
  });
const pending = (email) =>
  server.sql((db) =>
    db
      .query(
        "SELECT verified, verification_token AS token FROM signers WHERE email = ?",
      )
      .get(email),
  );
// Until when the link works, as the admin's look-up of the address says it.
async function linkValidUntil(email) {
  const found = await server.request("/api/admin/signers/lookup", {
    method: "POST",
    token: admin,
    body: { email },
  });
  const { signups } = await found.json();
  return Date.parse(signups[0].confirmationExpiresAt);
}
const linkHoursLeft = async (email) =>
  ((await linkValidUntil(email)) - Date.now()) / HOUR;
const mailsTo = (email) =>
  lines("messages.jsonl").filter((message) => message.to === email);
const refusalsTo = (email) =>
  lines("refused.jsonl").filter((line) => line.to === email).length;
const tryMailNow = () =>
  server.sql((db) =>
    db
      .query(
        "UPDATE _honker_live SET run_at = unixepoch() WHERE queue = 'emails' AND state != 'processing'",
      )
      .run(),
  );
// Lets time pass for one sign-up: its age and both of its clocks.
const hoursPass = (email, hours) =>
  server.sql((db) =>
    db
      .query(
        `UPDATE signers SET
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, ?1),
           token_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', token_expires_at, ?1),
           mail_wait_until = strftime('%Y-%m-%dT%H:%M:%fZ', mail_wait_until, ?1)
         WHERE email = ?2`,
      )
      .run(`-${hours * 60} minutes`, email),
  );

test("a sign-up waits for its mail as long as the mail is kept, and its link counts from when the mail goes out", async () => {
  const email = "waiting@example.org";

  // The letter's link is valid for 1 hour; a queued mail is kept for 24.
  writeFileSync(join(mail, "down"), "");
  expect((await sign("Wanda Waiting", email)).status).toBe(200);
  await until(() => refusalsTo(email) > 0, "a refused mail");

  // Without a mail, the sign-up ends when its mail is given up on, not
  // before and not never.
  const waiting = await linkHoursLeft(email);
  expect(waiting).toBeGreaterThan(23.5);
  expect(waiting).toBeLessThanOrEqual(24);

  // Two hours pass without a mail: longer than the link is valid.
  await hoursPass(email, 2);
  await tryMailNow();
  rmSync(join(mail, "down"));

  const [sent] = await until(() => {
    const mails = mailsTo(email);
    return mails.length ? mails : null;
  }, "the confirmation mail");
  const { token } = await pending(email);
  expect(sent.html).toContain(`/api/confirm/${token}`);

  // The link is valid for its full hour from now, and no longer.
  const window = await until(async () => {
    const left = await linkHoursLeft(email);
    return left <= 1 ? left : null;
  }, "the confirmation window");
  expect(window).toBeGreaterThan(0.9);

  const confirmed = await server.request(`/api/confirm/${token}`, {
    method: "POST",
  });
  expect(confirmed.status).toBe(200);
  expect((await pending(email)).verified).toBe(1);
}, 240_000);

test("signing again while mail is down leaves the link that went out as it is, and the mail asked for still goes out after it", async () => {
  const email = "again@example.org";
  const expired = async (token) =>
    (
      await server.request(`/api/confirm/${token}`, { redirect: "manual" })
    ).headers
      .get("location")
      ?.includes("error=token-expired") ?? false;

  expect((await sign("Agnes Again", email)).status).toBe(200);
  await until(() => mailsTo(email).length === 1, "the confirmation mail");
  const issued = await until(async () => {
    const left = await linkHoursLeft(email);
    return left <= 1 ? left : null;
  }, "the confirmation window");
  const { token } = await pending(email);

  // The second sign-up asks for the mail again, and no mail can go out.
  writeFileSync(join(mail, "down"), "");
  expect((await sign("Agnes Again", email)).status).toBe(200);
  await until(() => refusalsTo(email) > 0, "a refused mail");
  expect(await linkHoursLeft(email)).toBeLessThanOrEqual(issued);
  expect(await expired(token)).toBe(false);

  // The hour of the first mail's link passes. The link is over, and the
  // sign-up still waits for the mail it was promised.
  await hoursPass(email, 1.5);
  expect(await expired(token)).toBe(true);

  rmSync(join(mail, "down"));
  await tryMailNow();
  const [, second] = await until(() => {
    const mails = mailsTo(email);
    return mails.length === 2 ? mails : null;
  }, "the second confirmation mail");
  expect(second.html).toContain(`/api/confirm/${token}`);
  const renewed = await until(async () => {
    const left = await linkHoursLeft(email);
    return left > 0 ? left : null;
  }, "the new confirmation window");
  expect(renewed).toBeGreaterThan(0.9);
  expect(renewed).toBeLessThanOrEqual(1);

  const confirmed = await server.request(`/api/confirm/${token}`, {
    method: "POST",
  });
  expect(confirmed.status).toBe(200);
  expect((await pending(email)).verified).toBe(1);
}, 240_000);

test("when the mail goes out and the write that starts its link's time fails, the job's next run starts it from when the mail went out", async () => {
  const email = "late-window@example.org";
  const waitingJobs = () =>
    server.sql(
      async (db) =>
        (
          await db
            .query(
              "SELECT COUNT(*) AS n FROM _honker_live WHERE queue = 'emails' AND json_extract(payload, '$.kind') = 'verification'",
            )
            .get()
        ).n,
    );

  writeFileSync(join(mail, "fail-window"), "");
  expect((await sign("Lena Late", email)).status).toBe(200);
  await until(() => mailsTo(email).length > 0, "the confirmation mail");
  await until(() => !existsSync(join(mail, "fail-window")), "the failed write");
  // The newest mail the mail service took is this one.
  const wentOutAt = Date.parse(
    (
      await server.sql((db) =>
        db
          .query(
            "SELECT updated_at AS at FROM email_attempts WHERE status = 'delivered' ORDER BY updated_at DESC LIMIT 1",
          )
          .get(),
      )
    ).at,
  );

  // The job runs again, five seconds later at the earliest.
  await until(async () => (await waitingJobs()) === 0, "the job to end");
  expect(mailsTo(email)).toHaveLength(1);

  // The link's hour counts from when the mail went out, not from the later
  // run that recorded it.
  expect((await linkValidUntil(email)) - wentOutAt).toBe(HOUR);
}, 240_000);

test("a sign-up's mail is tried for as long as the mail service only fails for the moment, and goes out when it works again", async () => {
  const email = "outage@example.org";
  const confirmationMails = (db, table) =>
    db
      .query(
        `SELECT COUNT(*) AS n FROM ${table}
         WHERE queue = 'emails' AND json_extract(payload, '$.kind') = 'verification'`,
      )
      .get();
  const mails = () =>
    server.sql(async (db) => ({
      waiting: (await confirmationMails(db, "_honker_live")).n,
      givenUp: (await confirmationMails(db, "_honker_dead")).n,
    }));

  // The mail service answers 503. A queued mail has five attempts for
  // failures that would repeat; this one is tried more often than that.
  writeFileSync(join(mail, "down"), "");
  expect((await sign("Olga Outage", email)).status).toBe(200);
  for (let tries = 1; tries <= 7; tries++) {
    await until(
      async () => refusalsTo(email) >= tries || (await mails()).givenUp > 0,
      `refusal ${tries}`,
    );
    expect(await mails()).toEqual({ waiting: 1, givenUp: 0 });
    await tryMailNow();
  }

  rmSync(join(mail, "down"));
  await tryMailNow();
  await until(() => mailsTo(email).length > 0, "the confirmation mail");
  await until(async () => (await mails()).waiting === 0, "the job to end");
  expect(await mails()).toEqual({ waiting: 0, givenUp: 0 });
}, 240_000);
