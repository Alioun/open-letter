// One-time migration: PostgreSQL -> encrypted SQLite (SQLCipher).
//
// Reads every table from the old Postgres database (SOURCE_DATABASE_URL) and
// copies all rows into the new encrypted SQLite file (DATABASE_PATH +
// DATABASE_ENCRYPTION_KEY), preserving primary-key ids and converting types:
//   boolean -> 0/1, Date -> ISO-8601 TEXT, INTEGER[] -> JSON TEXT.
// Prints per-table source vs destination row counts and aborts on any mismatch.
// Idempotent: uses INSERT OR REPLACE, so it can be re-run safely.
//
// Usage:
//   SOURCE_DATABASE_URL=postgres://… \
//   DATABASE_PATH=/app/data/diaetendeckel.db \
//   DATABASE_ENCRYPTION_KEY=… \
//   bun db/migrate-pg-to-sqlite.js
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Insert order respects FK (email_templates before campaigns).
const TABLES = [
  "email_templates",
  "campaigns",
  "signers",
  "zoom_registrations",
  "zoom_event_mailings",
  "app_settings",
  "kv_state_cache",
  "kv_not_typo",
  "occupation_not_typo",
];

function conv(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

async function tableExists(sql, table) {
  const [row] = await sql`
    SELECT to_regclass(${"public." + table}) IS NOT NULL AS present
  `;
  return row?.present === true;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) throw new Error("SOURCE_DATABASE_URL is required");
  if (!process.env.DATABASE_ENCRYPTION_KEY) {
    throw new Error("DATABASE_ENCRYPTION_KEY is required");
  }

  const sslMode = new URL(sourceUrl).searchParams.get("sslmode") || "";
  const ssl = sslMode.startsWith("disable")
    ? false
    : { rejectUnauthorized: false };
  const sql = postgres(sourceUrl, { ssl });

  if (!(await tableExists(sql, "signers"))) {
    await sql.end();
    throw new Error(
      "Source database has no signers table. Select the application's PostgreSQL database.",
    );
  }
  const columns = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='signers'
  `;
  const names = new Set(columns.map((column) => column.column_name));
  if (!["id", "name", "email"].every((column) => names.has(column))) {
    await sql.end();
    throw new Error(
      "Source signers table does not match the application schema.",
    );
  }

  const { db, DB_PATH } = await import("./connection.js");
  console.log(`[migrate] target: ${DB_PATH}`);

  // Apply the SQLite schema first.
  await db.run(readFileSync(join(__dirname, "schema.sql"), "utf-8"));

  const report = {};
  let failed = false;

  for (const table of TABLES) {
    if (!(await tableExists(sql, table))) {
      console.warn(`[migrate] source table ${table} missing, skipped`);
      continue;
    }

    const rows = await sql`SELECT * FROM ${sql(table)}`;
    const srcCount = rows.length;

    if (srcCount > 0) {
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => "?").join(", ");
      const stmt = db.query(
        `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
      );
      await db.transaction(async () => {
        for (const row of rows) {
          await stmt.run(...cols.map((c) => conv(row[c])));
        }
      });
    }

    const dstCount = (
      await db.query(`SELECT COUNT(*) AS c FROM ${table}`).get()
    ).c;
    report[table] = { src: srcCount, dst: dstCount };
    const ok = srcCount === dstCount;
    if (!ok) failed = true;
    console.log(
      `[migrate] ${table}: src=${srcCount} dst=${dstCount} ${ok ? "✓" : "✗ MISMATCH"}`,
    );
  }

  await sql.end();
  await db.close();

  console.log("[migrate] summary:", JSON.stringify(report));
  if (failed) {
    throw new Error(
      "Row counts differ. Migration is incomplete. Keep the app on the source database.",
    );
  }
  console.log("[migrate] migration complete; all table counts match.");
}

main().catch((err) => {
  console.error(`[migrate] ${err.message}`);
  process.exit(1);
});
