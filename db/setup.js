import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./connection.js";
import { applyDataMigrations } from "./data-migrations.js";
import cfg from "../config/letter.config.js";
import { ensureCampaignSubmissionKeys } from "./campaign-submissions.js";
import { ensureEmailAttemptSubjects } from "./email-attempts.js";
import { letterTemplates } from "../config/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// [table, column, declaration]: keep in sync with db/schema.sql.
const ADDED_COLUMNS = [
  ["email_templates", "revision", "INTEGER NOT NULL DEFAULT 1"],
  ["campaigns", "attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["campaigns", "heartbeat_at", "TEXT"],
  ["campaigns", "failure", "TEXT"],
  ["campaigns", "delivery_expires_at", "TEXT"],
  ["zoom_event_mailings", "attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["zoom_event_mailings", "failure", "TEXT"],
  ["signers", "invite_code", "TEXT"],
  ["signers", "invite_stats_hash", "TEXT"],
  ["signers", "invite_show_name", "INTEGER NOT NULL DEFAULT 0"],
  ["signers", "invite_count", "INTEGER NOT NULL DEFAULT 0"],
  ["signers", "pending_ref", "TEXT"],
  // Person language (features.multiLanguage; NULL = default language).
  ["signers", "lang", "TEXT"],
  ["signers", "signer_function", "TEXT NOT NULL DEFAULT ''"],
  [
    "signers",
    "show_signer_details",
    "INTEGER CHECK(show_signer_details IN (0, 1))",
  ],
  ["signers", "mail_wait_until", "TEXT"],
  ["signers", "admin_consent_at", "TEXT"],
  ["signers", "admin_consent_note", "TEXT"],
  [
    "signers",
    "first_signer",
    "INTEGER NOT NULL DEFAULT 0 CHECK(first_signer IN (0, 1))",
  ],
  ["zoom_registrations", "lang", "TEXT"],
  ["zoom_pending", "lang", "TEXT"],
  ["deletion_requests", "lang", "TEXT"],
  ["campaigns", "i18n", "TEXT"],
  ["campaigns", "audience_size", "INTEGER"],
];

// Indexes on ADDED_COLUMNS: created after the columns exist, since schema.sql
// runs first and would fail on a database that doesn't have them yet.
const ADDED_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_signers_first_signer
     ON signers (id) WHERE first_signer = 1`,
  `CREATE INDEX IF NOT EXISTS idx_signers_by_hand
     ON signers (id) WHERE email IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_signers_invite_code
     ON signers (invite_code) WHERE invite_code IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_signers_invite_stats
     ON signers (invite_stats_hash) WHERE invite_stats_hash IS NOT NULL`,
];

// Default transactional templates seeded from the active letter config, plus
// each further language's own as "<slug>.<lang>" (features.multiLanguage).
// Existing rows are left untouched (ON CONFLICT DO NOTHING), so admin edits are
// preserved.
const templates = Object.entries(letterTemplates(cfg)).map(([slug, t]) => ({
  slug,
  name: t.name,
  subject: t.subject,
  htmlBody: t.html_body,
}));

// Databases from before hand-added first signers have `email NOT NULL` and no
// `first_signer` column. SQLite cannot drop a NOT NULL, so the table is
// rebuilt from its current definition in schema.sql, keeping every row, its
// id and the id sequence. Foreign keys are off meanwhile, or dropping the old
// table would cascade into first_signer_pins. Dropping the table drops its
// indexes too; schema.sql is run again afterwards to recreate them.
async function rebuildSignersWithoutRequiredEmail(schema) {
  const columns = await db.query("PRAGMA table_info(signers)").all();
  if (!columns.find((c) => c.name === "email")?.notnull) return false;
  const definition =
    /CREATE TABLE IF NOT EXISTS signers \(([\s\S]*?)\n\);/.exec(schema)[1];
  await db.run("PRAGMA foreign_keys = OFF");
  try {
    await db.transaction(
      async () => {
        const sequence = await db
          .query("SELECT seq FROM sqlite_sequence WHERE name = 'signers'")
          .get();
        await db.run(`CREATE TABLE signers_rebuild (${definition}\n)`);
        const kept = new Set(
          (await db.query("PRAGMA table_info(signers_rebuild)").all()).map(
            (c) => c.name,
          ),
        );
        const copied = columns
          .map((c) => c.name)
          .filter((name) => kept.has(name))
          .join(", ");
        await db.run(
          `INSERT INTO signers_rebuild (${copied}) SELECT ${copied} FROM signers`,
        );
        await db.run("DROP TABLE signers");
        await db.run("ALTER TABLE signers_rebuild RENAME TO signers");
        if (sequence)
          await db
            .query(
              "UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'signers'",
            )
            .run(sequence.seq);
        const broken = await db.query("PRAGMA foreign_key_check").all();
        if (broken.length)
          throw new Error(
            `Rebuilding signers broke ${broken.length} foreign key(s)`,
          );
      },
      { immediate: true },
    );
  } finally {
    await db.run("PRAGMA foreign_keys = ON");
  }
  return true;
}

try {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await db.run(schema);
  await db.run(readFileSync(join(__dirname, "publishing.sql"), "utf-8"));
  // CREATE TABLE IF NOT EXISTS leaves existing tables as they are, so columns
  // added to schema.sql later are added here for databases created before.
  for (const [table, column, decl] of ADDED_COLUMNS) {
    const cols = await db.query(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }
  if (await rebuildSignersWithoutRequiredEmail(schema)) {
    await db.run(schema);
    console.log("Rebuilt the signers table for signatures added by hand.");
  }
  for (const sql of ADDED_INDEXES) await db.run(sql);
  await ensureCampaignSubmissionKeys(db);
  const attempts = await ensureEmailAttemptSubjects(db);
  if (attempts.unmatched) {
    console.warn(
      `Retaining ${attempts.unmatched} unmatched legacy email attempts until attempt retention expires to prevent duplicate retries.`,
    );
  }
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
  console.log("Database schema is up to date.");
} catch (err) {
  console.error("Database schema update failed:", err.message);
  process.exit(1);
} finally {
  await db.close();
}
