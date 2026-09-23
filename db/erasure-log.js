// Erasure log: survives the case where a backup is restored after someone had
// their data deleted or opted out. Restoring a backup would otherwise bring
// those rows back. db/restore-backup.js reads this log from the database it is
// about to replace and re-applies it to the restored one.
//
// Entries hold an HMAC of the email address (keyed from
// DATABASE_ENCRYPTION_KEY), never the address itself, plus what happened and
// when. They are kept for privacy.erasureLogDays — longer than backups are kept,
// so every backup that could still be restored is covered — then deleted.
//
// Every function takes the connection explicitly: the restore script works on
// connections of its own.
import { createHmac } from "node:crypto";

// Same definition as in db/schema.sql; repeated so a restored pre-log backup
// gets the table.
const ERASURE_LOG_DDL = `CREATE TABLE IF NOT EXISTS erasure_log (
  email_hmac  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  at          TEXT NOT NULL,
  PRIMARY KEY (email_hmac, kind)
)`;

export const ERASE = "erase"; // everything for the address
export const NEWSLETTER_OPT_OUT = "newsletter-opt-out";
export const TREFFEN_OPT_OUT = "treffen-opt-out";
export const HIDE_PUBLICLY = "hide-publicly"; // name taken off the public list
export const HIDE_INVITE_NAME = "hide-invite-name"; // first name off the invite link

function hmacKey() {
  const key = process.env.DATABASE_ENCRYPTION_KEY || "";
  if (!key) throw new Error("DATABASE_ENCRYPTION_KEY is required for the erasure log");
  return createHmac("sha256", key).update("erasure-log").digest();
}

export function emailHmac(email) {
  return createHmac("sha256", hmacKey())
    .update(String(email).trim().toLowerCase())
    .digest("hex");
}

export async function recordErasure(db, email, kind, at = new Date()) {
  await db
    .query(
      `INSERT INTO erasure_log /* public-neutral */ (email_hmac, kind, at)
       VALUES (?, ?, ?)
       ON CONFLICT (email_hmac, kind) DO UPDATE SET at = excluded.at`,
    )
    .run(emailHmac(email), kind, at.toISOString());
}

// Undo an opt-out entry when the person opts back in, so a restore doesn't
// re-apply a choice they reversed.
export async function forgetErasure(db, email, kind) {
  await db
    .query(
      `DELETE FROM erasure_log /* public-neutral */ WHERE email_hmac = ? AND kind = ?`,
    )
    .run(emailHmac(email), kind);
}

export async function readErasureLog(db) {
  return db.query(`SELECT email_hmac, kind, at FROM erasure_log`).all();
}

export async function purgeErasureLog(db, before) {
  const res = await db
    .query(`DELETE FROM erasure_log /* public-neutral */ WHERE at < ?`)
    .run(before.toISOString());
  return res?.changes ?? 0;
}

// Re-apply `entries` (read from the replaced database) to `db`. Only rows
// created before the logged event are touched, so someone who signed up again
// after being erased keeps their new signature. The entries themselves are
// carried over, so a second restore is covered too. Returns counts per kind.
export async function applyErasureLog(db, entries) {
  const byHmac = new Map();
  for (const e of entries) {
    if (!byHmac.has(e.email_hmac)) byHmac.set(e.email_hmac, []);
    byHmac.get(e.email_hmac).push(e);
  }
  const applied = {
    [ERASE]: 0,
    [NEWSLETTER_OPT_OUT]: 0,
    [TREFFEN_OPT_OUT]: 0,
    [HIDE_PUBLICLY]: 0,
    [HIDE_INVITE_NAME]: 0,
  };
  if (byHmac.size === 0) return applied;

  // A backup from before a table existed simply doesn't have it.
  const existing = new Set(
    (await db.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).map(
      (r) => r.name,
    ),
  );
  await db.run(ERASURE_LOG_DDL);
  const has = (t) => existing.has(t);
  // A backup from before invite links has no invite_show_name to reset.
  const hasInviteName =
    has("signers") &&
    (await db.query(`PRAGMA table_info(signers)`).all()).some(
      (c) => c.name === "invite_show_name",
    );
  const emails = new Set();
  for (const t of ["signers", "zoom_registrations", "zoom_pending", "deletion_requests"].filter(has)) {
    for (const row of await db.query(`SELECT email FROM ${t}`).all()) {
      emails.add(row.email);
    }
  }

  for (const email of emails) {
    const matches = byHmac.get(emailHmac(email));
    if (!matches) continue;
    for (const { kind, at } of matches) {
      if (kind === ERASE) {
        let changed = 0;
        for (const t of ["signers", "zoom_registrations", "zoom_pending"].filter(has)) {
          const res = await db
            .query(`DELETE FROM ${t} WHERE email = ? AND created_at < ?`)
            .run(email, at);
          changed += res?.changes ?? 0;
        }
        if (has("deletion_requests")) {
          await db.query(`DELETE FROM deletion_requests WHERE email = ?`).run(email);
        }
        if (changed) applied[kind]++;
      } else if (kind === NEWSLETTER_OPT_OUT) {
        const res = await db
          .query(
            `UPDATE signers SET newsletter = 0
             WHERE email = ? AND newsletter = 1 AND created_at < ?`,
          )
          .run(email, at);
        if (res?.changes) applied[kind]++;
      } else if (kind === HIDE_PUBLICLY) {
        const res = await db
          .query(
            `UPDATE signers SET show_publicly = 0
             WHERE email = ? AND show_publicly = 1 AND created_at < ?`,
          )
          .run(email, at);
        if (res?.changes) applied[kind]++;
      } else if (kind === HIDE_INVITE_NAME && hasInviteName) {
        const res = await db
          .query(
            `UPDATE signers SET invite_show_name = 0
             WHERE email = ? AND invite_show_name = 1 AND created_at < ?`,
          )
          .run(email, at);
        if (res?.changes) applied[kind]++;
      } else if (kind === TREFFEN_OPT_OUT) {
        const res = await db
          .query(`DELETE FROM zoom_registrations WHERE email = ? AND created_at < ?`)
          .run(email, at);
        if (res?.changes) applied[kind]++;
      }
    }
  }

  for (const e of entries) {
    await db
      .query(
        `INSERT INTO erasure_log (email_hmac, kind, at) VALUES (?, ?, ?)
         ON CONFLICT (email_hmac, kind) DO UPDATE
           SET at = MAX(erasure_log.at, excluded.at)`,
      )
      .run(e.email_hmac, e.kind, e.at);
  }
  return applied;
}
