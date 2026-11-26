import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
  db,
  isoAgoDays,
} from "./helpers.js";
import * as q from "../server/db.js";
import { resolvePrivacy, retentionCutoff } from "../config/privacy.js";
import { emailHmac } from "../db/email-identity.js";

beforeEach(resetDb);

const count = async (table) =>
  (await db.query(`SELECT COUNT(*) c FROM ${table}`).get()).c;

describe("age-based retention", () => {
  test("the cutoff is signerRetentionYears calendar years back", () => {
    const privacy = resolvePrivacy({ privacy: { signerRetentionYears: 3 } });
    const cutoff = retentionCutoff(privacy, new Date("2029-06-15T12:00:00Z"));
    expect(cutoff.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  test("entries older than the cutoff are deleted, newer ones kept", async () => {
    await addVerifiedSigner({ created_at: isoAgoDays(3 * 365 + 5) });
    const keep = await addVerifiedSigner({ created_at: isoAgoDays(3 * 365 - 5) });
    await addZoomRegistration({ created_at: isoAgoDays(3 * 365 + 5) });

    const cutoff = retentionCutoff(resolvePrivacy({}));
    expect(await q.deleteExpiredByAge(cutoff)).toBe(2);
    expect(await count("signers")).toBe(1);
    expect(await count("zoom_registrations")).toBe(0);
    expect(
      (await db.query("SELECT id FROM signers").get()).id,
    ).toBe(keep.id);
    expect(await q.deleteExpiredByAge(cutoff)).toBe(0);
  });
});

describe("sign-ups that run out unconfirmed", () => {
  const NOW = new Date("2026-11-22T10:00:00.000Z");
  const hoursBefore = (hours) => new Date(NOW.getTime() - hours * 3600_000);

  beforeEach(async () => {
    await db.run(await Bun.file("db/publishing.sql").text());
    await db.run("DELETE FROM email_attempts");
  });

  // A sign-up whose wait for its confirmation mail ended an hour ago, unless
  // told otherwise.
  async function addPending(email, { waitEnds = hoursBefore(1) } = {}) {
    await q.insertSigner({
      name: "Pending Person",
      email,
      kv: "",
      occupation: "",
      newsletter: false,
      showPublicly: true,
      token: `token-${email}`,
      expiresAt: waitEnds,
    });
  }
  // The mail service took the confirmation mail of this sign-up. Its link
  // ran out an hour ago, unless told otherwise.
  async function confirmationWentOut(email, linkEnds = hoursBefore(1)) {
    const { id } = await db
      .query("SELECT id FROM signers WHERE email = ?")
      .get(email);
    await q.startConfirmationWindow(id, `token-${email}`, linkEnds);
  }
  // Some mail to this address, whatever it was about.
  async function addMail(email, status, at) {
    await db
      .query(
        `INSERT INTO email_attempts (scope, profile_revision, provider, status, correlation_id, subject_hmac, created_at, updated_at)
         VALUES (?, 1, 'smtp', ?, ?, ?, ?, ?)`,
      )
      .run(
        `scope-${email}-${at.toISOString()}`,
        status,
        `id-${email}`,
        emailHmac(email),
        at.toISOString(),
        at.toISOString(),
      );
  }

  test("only those whose confirmation mail never went out are counted, and all of them go", async () => {
    await addPending("nothing-sent@example.org");
    await addPending("mail-failed@example.org");
    await addMail("mail-failed@example.org", "retryable", hoursBefore(24));
    await addPending("mail-accepted@example.org");
    await confirmationWentOut("mail-accepted@example.org");
    // Asked for a new link, which replaced the one that went out, and the
    // mail with the new one never did.
    await addPending("new-link@example.org");
    await confirmationWentOut("new-link@example.org");
    await q.refreshVerificationToken(
      "new-link@example.org",
      "token-replacement",
      hoursBefore(1),
    );
    await addPending("still-waiting@example.org", {
      waitEnds: new Date(NOW.getTime() + 3600_000),
    });
    const signed = await addVerifiedSigner();

    expect(await q.deleteExpiredUnverifiedSigners(NOW)).toBe(4);
    expect(
      (await db.query("SELECT email FROM signers ORDER BY id").all()).map(
        (row) => row.email,
      ),
    ).toEqual(["still-waiting@example.org", signed.email]);
    expect(await q.getExpiredUnmailedSignups(NOW)).toEqual({
      count: 3,
      lastDay: "2026-11-22",
      days: 30,
    });
  });

  test("signing again after the mail went out is not a lost sign-up when the second mail never goes out", async () => {
    const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600_000);
    const email = "again@example.org";
    await addPending(email, { waitEnds: hoursFromNow(24) });
    await confirmationWentOut(email, hoursFromNow(1));
    await addPending(email, { waitEnds: hoursFromNow(24) });

    const afterBoth = hoursFromNow(25);
    expect(await q.deleteExpiredUnverifiedSigners(afterBoth)).toBe(1);
    expect(await q.getExpiredUnmailedSignups(afterBoth)).toMatchObject({
      count: 0,
    });
  });

  test("another mail to the same address does not hide a lost sign-up", async () => {
    await addPending("lost@example.org");
    // Mailed after the sign-up was made: a deletion link, for example.
    await addMail("lost@example.org", "delivered", new Date());

    expect(await q.deleteExpiredUnverifiedSigners(NOW)).toBe(1);
    expect(await q.getExpiredUnmailedSignups(NOW)).toMatchObject({ count: 1 });
  });

  test("what is kept is a number per day, and it ages out after 30 days", async () => {
    await addPending("first@example.org");
    await q.deleteExpiredUnverifiedSigners(NOW);
    const later = new Date(NOW.getTime() + 20 * 86400_000);
    await addPending("second@example.org");
    await addPending("third@example.org");
    await q.deleteExpiredUnverifiedSigners(later);

    const stored = await db
      .query(
        "SELECT value FROM app_settings WHERE key = 'signups_expired_unmailed'",
      )
      .get();
    expect(JSON.parse(stored.value)).toEqual({
      "2026-11-22": 1,
      "2026-12-12": 2,
    });
    expect(await q.getExpiredUnmailedSignups(later)).toMatchObject({
      count: 3,
      lastDay: "2026-12-12",
    });
    const muchLater = new Date(NOW.getTime() + 35 * 86400_000);
    expect(await q.getExpiredUnmailedSignups(muchLater)).toMatchObject({
      count: 2,
      lastDay: "2026-12-12",
    });
    expect(
      await q.getExpiredUnmailedSignups(
        new Date(NOW.getTime() + 90 * 86400_000),
      ),
    ).toEqual({ count: 0, lastDay: null, days: 30 });
  });

  test("a cleanup with nothing lost writes nothing", async () => {
    await addPending("mail-accepted@example.org");
    await confirmationWentOut("mail-accepted@example.org");
    expect(await q.deleteExpiredUnverifiedSigners(NOW)).toBe(1);
    expect(await q.deleteExpiredUnverifiedSigners(NOW)).toBe(0);
    expect(await count("app_settings")).toBe(0);
  });

  test("a sign-up from before the two clocks, which has only an expiry, is deleted and not counted", async () => {
    await db
      .query(
        `INSERT INTO signers (name, email, verified, verification_token, token_expires_at)
         VALUES ('Earlier Person', 'earlier@example.org', 0, 'token-earlier', ?)`,
      )
      .run(hoursBefore(1).toISOString());
    expect(await q.deleteExpiredUnverifiedSigners(NOW)).toBe(1);
    expect(await q.getExpiredUnmailedSignups(NOW)).toMatchObject({ count: 0 });
  });
});
