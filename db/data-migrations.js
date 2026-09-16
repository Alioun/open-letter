// One-off data migrations, run by db/setup.js after the schema. Each runs once:
// its key is claimed in app_settings in the same transaction as the change.

const MIGRATIONS = [
  {
    // Unsubscribe tokens used to be rotated on every mail and could reach the
    // analytics database via /abmelden/<token> page views. Tokens are stable
    // from now on, so drop every token issued before that change once; the next
    // mail to each address issues a fresh one.
    key: "migration:rotate-unsubscribe-tokens-2026-09",
    statements: [
      `UPDATE signers /* public-neutral */
       SET unsubscribe_token = NULL, unsubscribe_token_created_at = NULL
       WHERE unsubscribe_token IS NOT NULL`,
      `UPDATE zoom_registrations /* public-neutral */
       SET unsubscribe_token = NULL WHERE unsubscribe_token IS NOT NULL`,
    ],
  },
  {
    // Deletion links used to store their token on the signer row. Carry the
    // ones still valid at deploy time over, so a link mailed shortly before
    // the deploy still deletes.
    key: "migration:carry-over-deletion-tokens-2026-09",
    statements: [
      `INSERT INTO deletion_requests /* public-neutral */ (email, token, expires_at)
       SELECT email, deletion_token, deletion_token_expires_at FROM signers
       WHERE deletion_token IS NOT NULL
         AND deletion_token_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
       ON CONFLICT DO NOTHING`,
      `UPDATE signers /* public-neutral */
       SET deletion_token = NULL, deletion_token_expires_at = NULL
       WHERE deletion_token IS NOT NULL`,
    ],
  },
];

// Runs in db/setup.js before the server starts, so nothing else shares the
// connection while a migration's transaction is open.
export async function applyDataMigrations(db) {
  const applied = [];
  for (const m of MIGRATIONS) {
    const claimed = await db.transaction(async () => {
      const row = await db
        .query(
          `INSERT INTO app_settings /* public-neutral */ (key, value)
           VALUES (?, ?) ON CONFLICT (key) DO NOTHING RETURNING key`,
        )
        .get(m.key, new Date().toISOString());
      if (!row) return false;
      for (const sql of m.statements) await db.query(sql).run();
      return true;
    });
    if (claimed) applied.push(m.key);
  }
  return applied;
}
