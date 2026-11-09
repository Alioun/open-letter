import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  test,
  expect,
} from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
} from "./helpers.js";
import { openEncrypted } from "../db/connection.js";
import { eraseSubject } from "../db/erasure.js";
import * as q from "../server/db.js";
import {
  emailHmac,
  applyErasureLog,
  readErasureLog,
  ERASE,
} from "../db/erasure-log.js";

const old = "2026-01-01T00:00:00.000Z";
const erasedAt = "2026-02-01T00:00:00.000Z";
const later = "2026-03-01T00:00:00.000Z";
const email = "private@example.org";
let dir;
let restored;

test("privacy operations reject calls outside their authorization transaction", async () => {
  await expect(eraseSubject(db, { email })).rejects.toThrow(
    "authorization transaction",
  );
  await expect(q.confirmZoomPending("unclaimed-token")).rejects.toThrow(
    "durableWork.run",
  );
});

beforeEach(async () => {
  await resetDb();
  await db.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  const columns = await db.query("PRAGMA table_info(email_attempts)").all();
  for (const column of ["subject_hmac", "created_at"]) {
    if (!columns.some((c) => c.name === column))
      await db.run(`ALTER TABLE email_attempts ADD COLUMN ${column} TEXT`);
  }
  await db.run("DELETE FROM email_attempts");
  for (const table of [
    "signers",
    "zoom_registrations",
    "zoom_pending",
    "deletion_requests",
    "mailing_deliveries",
    "email_attempts",
    "erasure_log",
  ]) {
    await restored.query(`DELETE FROM ${table}`).run();
  }
  for (const table of ["_honker_live", "_honker_dead"])
    await restored.run(`DROP TABLE IF EXISTS ${table}`);
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "privacy-erasure-"));
  restored = await openEncrypted(join(dir, "restored.db"));
  await restored.run(
    readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"),
  );
  await restored.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  const restoredColumns = await restored
    .query("PRAGMA table_info(email_attempts)")
    .all();
  for (const column of ["subject_hmac", "created_at"]) {
    if (!restoredColumns.some((c) => c.name === column))
      await restored.run(
        `ALTER TABLE email_attempts ADD COLUMN ${column} TEXT`,
      );
  }
}, 30000);

afterEach(async () => {
  await db.run("DROP TRIGGER IF EXISTS reject_erasure");
});

afterAll(async () => {
  await restored.close();
  rmSync(dir, { recursive: true, force: true });
});

async function attempt(
  connection,
  subject = email,
  scope = "attempt",
  createdAt = old,
) {
  await connection
    .query(
      `INSERT INTO email_attempts
    (scope, profile_revision, provider, status, correlation_id, updated_at, subject_hmac, created_at)
    VALUES (?, 1, 'smtp', 'delivered', 'correlation', ?, ?, ?)`,
    )
    .run(scope, createdAt, emailHmac(subject), createdAt);
}
const count = async (connection, table) =>
  (await connection.query(`SELECT COUNT(*) n FROM ${table}`).get()).n;

test("live erasure removes keyed attempts and delivery history", async () => {
  await addVerifiedSigner({ email });
  await attempt(db);
  await db
    .query(
      "INSERT INTO mailing_deliveries (mailing,email) VALUES ('campaign:7',?)",
    )
    .run(email);
  await q.eraseEmail(email);
  expect(await count(db, "email_attempts")).toBe(0);
  expect(await count(db, "mailing_deliveries")).toBe(0);
  expect(await readErasureLog(db)).toHaveLength(1);
});

test("restore erases delivery-only and attempt-only subjects without a signer", async () => {
  await restored
    .query(
      "INSERT INTO mailing_deliveries (mailing,email,sent_at) VALUES ('campaign:7',?,?)",
    )
    .run(email, old);
  await attempt(restored);
  const entries = [{ email_hmac: emailHmac(email), kind: ERASE, at: erasedAt }];
  const applied = await applyErasureLog(restored, entries);
  expect(applied[ERASE]).toBe(1);
  expect(await count(restored, "mailing_deliveries")).toBe(0);
  expect(await count(restored, "email_attempts")).toBe(0);
  expect((await applyErasureLog(restored, entries))[ERASE]).toBe(0);
});

test("a tombstone failure rolls back every live deletion", async () => {
  await addVerifiedSigner({ email });
  await addZoomRegistration({ email });
  await attempt(db);
  await db.run(
    "CREATE TRIGGER reject_erasure BEFORE INSERT ON erasure_log BEGIN SELECT RAISE(ABORT, 'controlled erasure failure'); END",
  );
  await expect(q.eraseEmail(email)).rejects.toThrow(
    "controlled erasure failure",
  );
  expect(await count(db, "signers")).toBe(1);
  expect(await count(db, "zoom_registrations")).toBe(1);
  expect(await count(db, "email_attempts")).toBe(1);
  expect(await count(db, "erasure_log")).toBe(0);
});

test("an authorized deletion retry records intent when the subject is already absent", async () => {
  const signer = await addVerifiedSigner({ email });
  await q.createDeletionRequest(email, "retry", new Date(Date.now() + 60_000));
  await db.query("DELETE FROM signers WHERE id=?").run(signer.id);
  expect(await q.deleteByDeletionToken("retry")).toBe(true);
  expect(await readErasureLog(db)).toHaveLength(1);
  expect(await count(db, "deletion_requests")).toBe(0);
});

test("a delivery-only subject can obtain deletion authorization", async () => {
  await db
    .query(
      "INSERT INTO mailing_deliveries (mailing,email) VALUES ('campaign:7',?)",
    )
    .run(email);
  expect(
    await q.createDeletionRequest(
      email,
      "log-only",
      new Date(Date.now() + 60_000),
    ),
  ).toBeNumber();
  expect(await q.deleteByDeletionToken("log-only")).toBe(true);
  expect(await count(db, "mailing_deliveries")).toBe(0);
});

test("restore preserves signup, requests, deliveries and attempts after the cutoff", async () => {
  await restored
    .query("INSERT INTO signers (name,email,created_at) VALUES ('New',?,?)")
    .run(email, later);
  await restored
    .query(
      "INSERT INTO deletion_requests (email,token,expires_at,created_at) VALUES (?,'new',?,?)",
    )
    .run(email, later, later);
  await restored
    .query(
      "INSERT INTO mailing_deliveries (mailing,email,sent_at) VALUES ('new',?,?)",
    )
    .run(email, later);
  await attempt(restored, email, "new", later);
  await applyErasureLog(restored, [
    { email_hmac: emailHmac(email), kind: ERASE, at: erasedAt },
  ]);
  for (const table of [
    "signers",
    "deletion_requests",
    "mailing_deliveries",
    "email_attempts",
  ]) {
    expect(await count(restored, table)).toBe(1);
  }
});

test("settings deletion uses the same transaction and rejects invalid authorization", async () => {
  const signer = await addVerifiedSigner({ email });
  await db
    .query(
      "UPDATE signers SET unsubscribe_token='settings',unsubscribe_token_created_at=? WHERE id=?",
    )
    .run(new Date().toISOString(), signer.id);
  expect(await q.deleteSignerByUnsubscribeToken("invalid")).toBe(false);
  expect(await count(db, "erasure_log")).toBe(0);
  await attempt(db);
  expect(await q.deleteSignerByUnsubscribeToken("settings")).toBe(true);
  expect(await count(db, "signers")).toBe(0);
  expect(await count(db, "email_attempts")).toBe(0);
  expect(await readErasureLog(db)).toHaveLength(1);
});

test("attempt-only subjects can authorize deletion", async () => {
  await attempt(db);
  expect(
    await q.createDeletionRequest(
      email,
      "attempt-only",
      new Date(Date.now() + 60_000),
    ),
  ).toBeNumber();
  expect(await q.deleteByDeletionToken("attempt-only")).toBe(true);
  expect(await count(db, "email_attempts")).toBe(0);
});

test("dispatch sees completed opt-outs and acceptance cannot recreate erased identities", async () => {
  const signer = await addVerifiedSigner({ email, created_at: old });
  const recipient = await q.getRecipientIdentity("signer", signer.id);
  expect(
    await q.authorizeRecipient(recipient, { audience: "newsletter" }),
  ).toBe(true);
  await db.query("UPDATE signers SET newsletter=0 WHERE id=?").run(signer.id);
  expect(
    await q.authorizeRecipient(recipient, { audience: "newsletter" }),
  ).toBe(false);
  expect(
    await q.markDeliveredForRecipient("started-before-opt-out", recipient),
  ).toBe(true);
  await q.eraseEmail(email);
  await addVerifiedSigner({ email, created_at: later });
  expect(
    await q.authorizeRecipient(recipient, { audience: "newsletter" }),
  ).toBe(false);
  expect(
    await q.markDeliveredForRecipient("completed-after-erasure", recipient),
  ).toBe(false);
  expect(await count(db, "mailing_deliveries")).toBe(0);
});

test("id, email and created_at each fence a renewed row", async () => {
  const signer = await addVerifiedSigner({ email, created_at: old });
  const recipient = await q.getRecipientIdentity("signer", signer.id);
  for (const forged of [
    { ...recipient, id: signer.id + 1 },
    { ...recipient, email: "other@example.org" },
    { ...recipient, createdAt: later },
  ]) {
    expect(await q.authorizeRecipient(forged, { audience: "newsletter" })).toBe(
      false,
    );
    expect(await q.markDeliveredForRecipient("forged", forged)).toBe(false);
  }
  await db
    .query("UPDATE signers SET created_at=? WHERE id=?")
    .run(later, signer.id);
  expect(await q.issueUnsubscribeTokenForRecipient(recipient)).toBeNull();
  expect(await q.markDeliveredForRecipient("old-incarnation", recipient)).toBe(
    false,
  );
  const renewed = await q.getRecipientIdentity("signer", signer.id);
  expect(await q.authorizeRecipient(renewed, { audience: "newsletter" })).toBe(
    true,
  );
});

test("final dispatch verifies current verification credentials", async () => {
  const signer = await addVerifiedSigner({ email });
  const recipient = await q.getRecipientIdentity("signer", signer.id);
  await db
    .query(
      "UPDATE signers SET verified=0,verification_token='new',token_expires_at=? WHERE id=?",
    )
    .run(new Date(Date.now() + 60_000).toISOString(), signer.id);
  expect(
    await q.authorizeRecipient(recipient, {
      kind: "verification",
      token: "old",
    }),
  ).toBe(false);
  expect(
    await q.authorizeRecipient(recipient, {
      kind: "verification",
      token: "new",
    }),
  ).toBe(true);
  expect(await q.authorizeRecipient(recipient, { kind: "verification" })).toBe(
    false,
  );
});

test("restore removes live/dead jobs for erased identities and preserves new signup jobs", async () => {
  await restored
    .query(
      "INSERT INTO signers (id,name,email,created_at) VALUES (1,'Old',?,?)",
    )
    .run(email, old);
  await restored
    .query(
      "INSERT INTO zoom_pending (id,name,email,token,expires_at,created_at) VALUES (2,'New',?,'pending',?,?)",
    )
    .run(email, later, later);
  for (const table of ["_honker_live", "_honker_dead"]) {
    await restored.run(
      `CREATE TABLE ${table} (id TEXT PRIMARY KEY, queue TEXT, payload TEXT)`,
    );
    for (const [id, payload] of [
      ["old", { signerId: 1 }],
      ["new", { pendingId: 2 }],
      ["legacy", { to: email }],
      ["unrelated", { signerId: 999 }],
    ]) {
      await restored
        .query(`INSERT INTO ${table} VALUES (?,'emails',?)`)
        .run(id, JSON.stringify(payload));
    }
  }
  await applyErasureLog(restored, [
    { email_hmac: emailHmac(email), kind: ERASE, at: erasedAt },
  ]);
  for (const table of ["_honker_live", "_honker_dead"]) {
    expect(
      (await restored.query(`SELECT id FROM ${table} ORDER BY id`).all()).map(
        (r) => r.id,
      ),
    ).toEqual(["new", "unrelated"]);
  }
  expect(await count(restored, "zoom_pending")).toBe(1);
});

test("restore deletes pre-erasure attempts even when their completion timestamp is newer", async () => {
  await attempt(restored);
  await restored.query("UPDATE email_attempts SET updated_at=?").run(later);
  await applyErasureLog(restored, [
    { email_hmac: emailHmac(email), kind: ERASE, at: erasedAt },
  ]);
  expect(await count(restored, "email_attempts")).toBe(0);
});

test("recipient helpers use the supplied connection and participate in its transaction", async () => {
  await restored
    .query(
      "INSERT INTO signers (id,name,email,verified,newsletter,created_at) VALUES (77,'Fixture',?,1,1,?)",
    )
    .run(email, old);
  const recipient = await q.getRecipientIdentity("signer", 77, {
    connection: restored,
  });
  expect(recipient.email).toBe(email);
  expect(
    await q.authorizeRecipient(recipient, { audience: "newsletter" }),
  ).toBe(false);
  await expect(
    restored.transaction(async () => {
      expect(
        await q.authorizeRecipient(recipient, {
          audience: "newsletter",
          connection: restored,
        }),
      ).toBe(true);
      expect(
        await q.issueUnsubscribeTokenForRecipient(recipient, {
          connection: restored,
        }),
      ).toBeString();
      expect(
        await q.markDeliveredForRecipient("transaction-test", recipient, {
          connection: restored,
        }),
      ).toBe(true);
      throw new Error("controlled outer rollback");
    }),
  ).rejects.toThrow("controlled outer rollback");
  expect(await count(restored, "mailing_deliveries")).toBe(0);
  expect(
    (
      await restored
        .query("SELECT unsubscribe_token FROM signers WHERE id=77")
        .get()
    ).unsubscribe_token,
  ).toBeNull();
});

test("supplied invite token remains valid when the same logical delivery prepares again", async () => {
  const signer = await addVerifiedSigner({ email });
  await db
    .query("UPDATE signers SET invite_code=? WHERE id=?")
    .run(q.generateInviteCode(), signer.id);
  const first = await q.issueInviteStatsToken(
    signer.id,
    "stable-enqueued-token",
  );
  const second = await q.issueInviteStatsToken(
    signer.id,
    "stable-enqueued-token",
  );
  expect(first).toEqual(second);
  expect(first.token).toBe("stable-enqueued-token");
  expect(await q.getInviteStats(first.inviteCode, first.token)).toEqual({
    count: 0,
  });
});
