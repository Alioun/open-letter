import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/connection.js";
import { resetDb, addVerifiedSigner } from "./helpers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(resetDb);

describe("SQLCipher connection", () => {
  test("cipher is active (PRAGMA cipher_version non-empty)", async () => {
    const row = await db.query("PRAGMA cipher_version").get();
    expect(row?.cipher_version).toBeTruthy();
  });

  test("data is encrypted at rest — plaintext not present in the file", async () => {
    const marker = "ZEBRA_MARKER_" + Date.now();
    await addVerifiedSigner({ name: marker });
    // Flush WAL into the main DB file so we inspect the persisted bytes.
    await db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = readFileSync(process.env.DATABASE_PATH);
    expect(bytes.includes(Buffer.from(marker))).toBe(false);
  });

  test("opening with the wrong key fails", () => {
    const wrong = new Database(process.env.DATABASE_PATH);
    wrong.run("PRAGMA key = 'definitely-wrong-key'");
    expect(() => wrong.query("SELECT COUNT(*) FROM signers").get()).toThrow();
    wrong.close();
  });

  test("fails closed when DATABASE_ENCRYPTION_KEY is missing", () => {
    const proc = Bun.spawnSync(
      ["bun", "-e", "await import('./db/connection.js')"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_ENCRYPTION_KEY: "",
          DATABASE_PATH: "/tmp/diaet-failclosed-test.db",
        },
        stderr: "pipe",
      },
    );
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain("DATABASE_ENCRYPTION_KEY");
  });
});
