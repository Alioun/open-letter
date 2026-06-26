// Bun test preload — runs once before any test module is imported.
//
// Critically, this sets the DB env vars BEFORE db/connection.js is ever loaded
// (connection.js opens the shared SQLCipher connection eagerly at import). We use
// a dynamic import so the assignments below are guaranteed to run first.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const tmp = mkdtempSync(join(tmpdir(), "diaet-test-"));
process.env.DATABASE_PATH = join(tmp, "test.db");
process.env.DATABASE_ENCRYPTION_KEY = "test-encryption-key-123";
if (!process.env.HONKER_EXTENSION_PATH) {
  const ext =
    process.platform === "darwin"
      ? "vendor/libhonker_ext.dylib"
      : "vendor/libhonker_ext.so";
  process.env.HONKER_EXTENSION_PATH = join(repoRoot, ext);
}

// Open the (now correctly-configured) shared connection and apply the schema.
const { db } = await import("../db/connection.js");
await db.run(readFileSync(join(repoRoot, "db/schema.sql"), "utf-8"));

// Best-effort cleanup of the temp DB dir on exit.
process.on("exit", () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});
