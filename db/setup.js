import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./connection.js";
import { applyDataMigrations } from "./data-migrations.js";
import cfg from "../config/letter.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// [table, column, declaration]: keep in sync with db/schema.sql.
const ADDED_COLUMNS = [
  ["campaigns", "attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["campaigns", "heartbeat_at", "TEXT"],
  ["zoom_event_mailings", "attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["signers", "invite_code", "TEXT"],
  ["signers", "invite_stats_hash", "TEXT"],
  ["signers", "invite_show_name", "INTEGER NOT NULL DEFAULT 0"],
  ["signers", "invite_count", "INTEGER NOT NULL DEFAULT 0"],
  ["signers", "pending_ref", "TEXT"],
];

// Indexes on ADDED_COLUMNS: created after the columns exist, since schema.sql
// runs first and would fail on a database that doesn't have them yet.
const ADDED_INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_signers_invite_code
     ON signers (invite_code) WHERE invite_code IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_signers_invite_stats
     ON signers (invite_stats_hash) WHERE invite_stats_hash IS NOT NULL`,
];

// Default transactional templates seeded from the active letter config. Existing
// rows are left untouched (ON CONFLICT DO NOTHING), so admin edits are preserved.
const templates = Object.entries(cfg.email.templates).map(([slug, t]) => ({
  slug,
  name: t.name,
  subject: t.subject,
  htmlBody: t.htmlBody,
}));


try {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await db.run(schema);
  // CREATE TABLE IF NOT EXISTS leaves existing tables as they are, so columns
  // added to schema.sql later are added here for databases created before.
  for (const [table, column, decl] of ADDED_COLUMNS) {
    const cols = await db.query(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }
  for (const sql of ADDED_INDEXES) await db.run(sql);
  const insert = db.query(
    `INSERT INTO email_templates (slug, name, subject, html_body)
     VALUES (?, ?, ?, ?) ON CONFLICT (slug) DO NOTHING`,
  );
  for (const template of templates) {
    await insert.run(
      template.slug,
      template.name,
      template.subject,
      template.htmlBody,
    );
  }
  for (const key of await applyDataMigrations(db)) {
    console.log(`Applied data migration ${key}.`);
  }
  console.log("Database schema applied successfully.");
} catch (err) {
  console.error("Failed to apply database schema:", err.message);
  process.exit(1);
} finally {
  await db.close();
}
