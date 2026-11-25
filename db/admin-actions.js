// Admin log: what was done in the admin and when, for the team to look up
// ("who was removed last week?"). One shared password means there is no "who".
//
// An entry holds the time, the action, the id it was about and a count. It
// never holds an email address. Edits of a signature also hold the old and
// new values (`detail`); those go as soon as the signature itself is deleted,
// so the log never outlives the data it describes. Entries are kept for
// privacy.adminLogDays.
//
// Every function takes the connection explicitly, like db/erasure-log.js: an
// erasure replayed by the restore script works on a connection of its own.
import { ADMIN_ACTIONS } from "../config/admin-actions.js";

const EMAIL_LIKE = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;

// Free text the team types (a consent note, a corrected name) can contain an
// address; the log must not.
export function withoutEmailAddresses(text) {
  return String(text ?? "").replace(EMAIL_LIKE, "[E-Mail-Adresse entfernt]");
}

export async function recordAdminAction(
  db,
  action,
  { targetId = null, count = null, detail = null, at = new Date() } = {},
) {
  if (!(action in ADMIN_ACTIONS))
    throw new Error(`Unknown admin action: ${action}`);
  if (detail)
    detail = JSON.parse(withoutEmailAddresses(JSON.stringify(detail)));
  await db
    .query(
      `INSERT INTO admin_actions /* public-neutral */ (at, action, target_id, count, detail)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      at.toISOString(),
      action,
      targetId,
      count,
      detail ? JSON.stringify(detail) : null,
    );
}

// When the action was last recorded for this target, or null.
export async function lastAdminActionAt(db, action, targetId) {
  const row = await db
    .query(
      `SELECT MAX(at) AS at FROM admin_actions WHERE action = ? AND target_id = ?`,
    )
    .get(action, targetId);
  return row?.at ?? null;
}

function parseDetail(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Newest first. `signerId` narrows it to one signature's entries.
export async function listAdminActions(
  db,
  { limit = 50, offset = 0, signerId = null } = {},
) {
  limit = Math.min(Math.max(1, limit), 100);
  offset = Math.max(0, offset);
  const where = signerId
    ? "WHERE action LIKE 'signer.%' AND target_id = ?"
    : "";
  const params = signerId ? [signerId] : [];
  const { total } = await db
    .query(`SELECT COUNT(*) AS total FROM admin_actions ${where}`)
    .get(...params);
  const rows = await db
    .query(
      `SELECT id, at, action, target_id AS targetId, count, detail
       FROM admin_actions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return {
    total,
    actions: rows.map((row) => ({ ...row, detail: parseDetail(row.detail) })),
  };
}

// Old and new values of signatures that no longer exist.
export async function forgetDeletedSigners(db) {
  await db
    .query(
      `UPDATE admin_actions /* public-neutral */ SET detail = NULL
       WHERE detail IS NOT NULL AND action LIKE 'signer.%'
         AND target_id NOT IN (SELECT id FROM signers)`,
    )
    .run();
}

export async function purgeAdminActions(db, before) {
  await forgetDeletedSigners(db);
  const res = await db
    .query(`DELETE FROM admin_actions /* public-neutral */ WHERE at < ?`)
    .run(before.toISOString());
  return res?.changes ?? 0;
}
