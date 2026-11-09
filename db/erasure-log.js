// Erasure log: survives the case where a backup is restored after someone had
// their data deleted or opted out. Restoring a backup would otherwise bring
// those rows back. db/restore-backup.js reads this log from the database it is
// about to replace and re-applies it to the restored one.
//
// Entries hold an HMAC of the email address (keyed from
// DATABASE_ENCRYPTION_KEY), never the address itself, plus what happened and
// when. They are kept for privacy.erasureLogDays (longer than backups are kept,
// so every backup that could still be restored is covered), then deleted.
//
// Every function takes the connection explicitly: the restore script works on
// connections of its own.
import { emailHmac } from "./email-identity.js";
import { eraseSubject, erasureTables } from "./erasure.js";
export { emailHmac } from "./email-identity.js";

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

export async function recordErasure(db, email, kind, at = new Date()) {
  await db
    .query(
      `INSERT INTO erasure_log /* public-neutral */ (email_hmac, kind, at)
       VALUES (?, ?, ?)
       ON CONFLICT (email_hmac, kind) DO UPDATE SET at = MAX(erasure_log.at, excluded.at)`,
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
  const applied = {
    [ERASE]: 0,
    [NEWSLETTER_OPT_OUT]: 0,
    [TREFFEN_OPT_OUT]: 0,
    [HIDE_PUBLICLY]: 0,
    [HIDE_INVITE_NAME]: 0,
  };
  if (!entries.length) return applied;
  return db.transaction(
    async () => {
      await db.run(ERASURE_LOG_DDL);
      const tables = await erasureTables(db);
      const signerColumns = tables.has("signers")
        ? new Set(
            (await db.query("PRAGMA table_info(signers)").all()).map(
              (c) => c.name,
            ),
          )
        : new Set();
      const choices = {
        [NEWSLETTER_OPT_OUT]: ["signers", "newsletter"],
        [HIDE_PUBLICLY]: ["signers", "show_publicly"],
        [HIDE_INVITE_NAME]: ["signers", "invite_show_name"],
        [TREFFEN_OPT_OUT]: ["zoom_registrations", null],
      };
      for (const { email_hmac, kind, at } of entries) {
        if (kind === ERASE) {
          if (await eraseSubject(db, { subjectHmac: email_hmac, before: at }))
            applied[kind]++;
        } else if (choices[kind]) {
          const [table, column] = choices[kind];
          if (tables.has(table) && (!column || signerColumns.has(column))) {
            let changed = false;
            const rows = await db
              .query(`SELECT id,email FROM ${table} WHERE created_at <= ?`)
              .all(at);
            for (const row of rows) {
              if (emailHmac(row.email) !== email_hmac) continue;
              const sql = column
                ? `UPDATE ${table} SET ${column}=0 WHERE id=? AND ${column}=1`
                : `DELETE FROM ${table} WHERE id=?`;
              const result = await db.query(sql).run(row.id);
              if (result.changes) changed = true;
            }
            if (changed) applied[kind]++;
          }
        }
        await db
          .query(
            `INSERT INTO erasure_log (email_hmac,kind,at) VALUES (?,?,?)
        ON CONFLICT(email_hmac,kind) DO UPDATE SET at=MAX(erasure_log.at,excluded.at)`,
          )
          .run(email_hmac, kind, at);
      }
      return applied;
    },
    { immediate: true },
  );
}
