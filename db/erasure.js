import { emailHmac, erasureSubject } from "./email-identity.js";
import { legacyAttemptScopes } from "./email-attempts.js";
import { inDatabaseTransaction } from "./connection.js";
import { forgetDeletedSigners } from "./admin-actions.js";

const SUBJECTS = [
  { table: "signers", jobField: "signerId" },
  { table: "zoom_registrations", jobField: "registrationId" },
  { table: "zoom_pending", jobField: "pendingId" },
  { table: "deletion_requests", jobField: "requestId" },
];

export async function erasureTables(db) {
  return new Set(
    (
      await db.query("SELECT name FROM sqlite_master WHERE type='table'").all()
    ).map((r) => r.name),
  );
}

export async function eraseSubject(
  db,
  { email, subjectHmac = emailHmac(email), before = null },
) {
  if (!inDatabaseTransaction())
    throw new Error(
      "Erase recipient data inside its authorization transaction",
    );
  const tables = await erasureTables(db);
  const matches = (address) => emailHmac(address) === subjectHmac;
  const addresses = new Set(email ? [email] : []);
  const deletedIds = new Map();
  let changes = 0;
  for (const { table, jobField } of SUBJECTS) {
    if (!tables.has(table)) continue;
    const rows = await db
      .query(
        `SELECT id, email FROM ${table}
      WHERE (? IS NULL OR created_at <= ?)${email ? " AND lower(trim(email)) = lower(trim(?))" : ""}`,
      )
      .all(before, before, ...(email ? [email] : []));
    const ids = new Set();
    for (const row of rows) {
      if (!matches(erasureSubject(row))) continue;
      if (row.email) addresses.add(row.email);
      ids.add(row.id);
      const res = await db
        .query(`DELETE FROM ${table} WHERE id = ?`)
        .run(row.id);
      changes += res.changes;
    }
    deletedIds.set(jobField, ids);
  }
  if (tables.has("admin_actions") && tables.has("signers"))
    await forgetDeletedSigners(db);

  if (tables.has("mailing_deliveries")) {
    const rows = await db
      .query(
        `SELECT mailing, email FROM mailing_deliveries
      WHERE (? IS NULL OR sent_at <= ?)${email ? " AND lower(trim(email)) = lower(trim(?))" : ""}`,
      )
      .all(before, before, ...(email ? [email] : []));
    for (const row of rows) {
      if (!matches(row.email)) continue;
      addresses.add(row.email);
      const res = await db
        .query(
          "DELETE FROM mailing_deliveries /* public-neutral */ WHERE mailing=? AND email=?",
        )
        .run(row.mailing, row.email);
      changes += res.changes;
    }
  }

  if (tables.has("email_attempts")) {
    const columns = new Set(
      (await db.query("PRAGMA table_info(email_attempts)").all()).map(
        (c) => c.name,
      ),
    );
    if (columns.has("subject_hmac")) {
      const timestamp = columns.has("created_at")
        ? "COALESCE(created_at, updated_at)"
        : "updated_at";
      const res = await db
        .query(
          `DELETE FROM email_attempts /* public-neutral */
        WHERE subject_hmac=? AND (? IS NULL OR ${timestamp} <= ?)`,
        )
        .run(subjectHmac, before, before);
      changes += res.changes;
    }
    for (const address of addresses) {
      for (const scope of await legacyAttemptScopes(
        db,
        address,
        deletedIds,
        tables,
      )) {
        const res = await db
          .query(
            `DELETE FROM email_attempts /* public-neutral */
          WHERE scope=? AND (? IS NULL OR updated_at <= ?)`,
          )
          .run(scope, before, before);
        changes += res.changes;
      }
    }
  }

  for (const table of ["_honker_live", "_honker_dead"].filter((t) =>
    tables.has(t),
  )) {
    const jobs = await db
      .query(`SELECT id, payload FROM ${table} WHERE queue='emails'`)
      .all();
    for (const job of jobs) {
      let payload;
      try {
        payload = JSON.parse(job.payload);
      } catch {
        continue;
      }
      if (!payload || typeof payload !== "object") continue;
      const deletedSubject = [...deletedIds].some(([field, ids]) =>
        ids.has(payload[field]),
      );
      const legacyAddress =
        typeof payload.to === "string" && matches(payload.to);
      if (!deletedSubject && !legacyAddress) continue;
      const res = await db
        .query(`DELETE FROM ${table} /* public-neutral */ WHERE id=?`)
        .run(job.id);
      changes += res.changes;
    }
  }
  return changes;
}
