import postgres from "postgres";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbUrl = process.env.DATABASE_URL || "";
const sslMode = new URL(dbUrl).searchParams.get("sslmode") || "";
const ssl = sslMode.startsWith("disable")
  ? false
  : { rejectUnauthorized: false };

const sql = postgres(dbUrl, { ssl });

try {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await sql.unsafe(schema);
  console.log("Database schema applied successfully.");
} catch (err) {
  console.error("Failed to apply database schema:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
