import { beforeEach, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db, resetDb, addVerifiedSigner, addTemplate } from "./helpers.js";
import { ensureEmailAttemptSubjects } from "../db/email-attempts.js";
import { emailHmac, applyErasureLog, ERASE } from "../db/erasure-log.js";
import * as q from "../server/db.js";

const email = "legacy@example.org";
const old = "2026-01-01T00:00:00.000Z";
const hash = (scope) => createHash("sha256").update(scope).digest("hex");

beforeEach(async () => {
  await resetDb();
  await db.run("DROP TABLE IF EXISTS email_attempts");
  await db.run(`CREATE TABLE email_attempts (
    scope TEXT PRIMARY KEY, profile_revision INTEGER NOT NULL,
    provider TEXT NOT NULL, status TEXT NOT NULL, correlation_id TEXT NOT NULL,
    updated_at TEXT NOT NULL, diagnostic TEXT)`);
});

const addAttempt = (scope, status = "delivered", provider = "smtp") =>
  db
    .query(
      `INSERT INTO email_attempts
  (scope,profile_revision,provider,status,correlation_id,updated_at)
  VALUES (?,4,?,?, 'preserve-provider-id',?)`,
    )
    .run(hash(scope), provider, status, old);

test("migration backfills delivered and uncertain campaign subjects without reopening attempts", async () => {
  await addVerifiedSigner({ email, created_at: old });
  const template = await addTemplate();
  const campaign = await q.createCampaign({
    templateId: template.id,
    subject: "Legacy",
    scheduledAt: old,
  });
  await addAttempt(`campaign-${campaign.id}:${email}`, "unresolved", "resend");
  await addAttempt("unknown-legacy", "attempting");
  const result = await ensureEmailAttemptSubjects(db);
  expect(result).toEqual({ backfilled: 1, unmatched: 1 });
  const identified = await db
    .query("SELECT * FROM email_attempts WHERE scope=?")
    .get(hash(`campaign-${campaign.id}:${email}`));
  expect(identified.subject_hmac).toBe(emailHmac(email));
  expect(identified.created_at).toBe(old);
  expect(identified.status).toBe("unresolved");
  expect(identified.provider).toBe("resend");
  expect(identified.correlation_id).toBe("preserve-provider-id");
  expect((await ensureEmailAttemptSubjects(db)).backfilled).toBe(0);
  expect(
    (
      await db
        .query("SELECT status FROM email_attempts WHERE scope=?")
        .get(hash("unknown-legacy"))
    ).status,
  ).toBe("attempting");
});

test("migration identifies delivery-only historical attempts", async () => {
  await db
    .query(
      "INSERT INTO mailing_deliveries (mailing,email,sent_at) VALUES ('campaign:12',?,?)",
    )
    .run(email, old);
  await addAttempt(`campaign-12:${email}`);
  expect((await ensureEmailAttemptSubjects(db)).backfilled).toBe(1);
  await q.eraseEmail(email);
  expect(
    (await db.query("SELECT COUNT(*) n FROM email_attempts").get()).n,
  ).toBe(0);
});

test("replay deletes legacy campaign attempts even before the migration has run", async () => {
  await addVerifiedSigner({ email, created_at: old });
  const template = await addTemplate();
  const campaign = await q.createCampaign({
    templateId: template.id,
    subject: "Legacy",
    scheduledAt: old,
  });
  await addAttempt(`campaign-${campaign.id}:${email}`);
  await applyErasureLog(db, [
    {
      email_hmac: emailHmac(email),
      kind: ERASE,
      at: "2026-02-01T00:00:00.000Z",
    },
  ]);
  expect(
    (await db.query("SELECT COUNT(*) n FROM email_attempts").get()).n,
  ).toBe(0);
});

test("fresh schema carries subject identity and migration creates the index", async () => {
  await db.run("DROP TABLE email_attempts");
  await db.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  expect(
    (await db.query("PRAGMA table_info(email_attempts)").all()).map(
      (r) => r.name,
    ),
  ).toContain("subject_hmac");
  await ensureEmailAttemptSubjects(db);
  expect(
    (await db.query("PRAGMA index_list(email_attempts)").all()).map(
      (r) => r.name,
    ),
  ).toContain("idx_email_attempts_subject");
});
