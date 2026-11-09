import { describe, test, expect, beforeEach } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, openEncrypted, DB_PATH } from "../db/connection.js";
import { resetDb, addVerifiedSigner } from "./helpers.js";
import { initJobs } from "../db/jobs.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(resetDb);

describe("SQLCipher connection", () => {
  test("concurrent connections preserve both writes when a transaction first reads its snapshot", async () => {
    const other = await openEncrypted(DB_PATH);
    await db.run(
      "CREATE TABLE connection_snapshot_check(id INTEGER PRIMARY KEY)",
    );
    try {
      let ready;
      const started = new Promise((resolve) => {
        ready = resolve;
      });
      const first = db.transaction(async () => {
        await db
          .query("SELECT COUNT(*) n FROM connection_snapshot_check")
          .get();
        ready();
        await Bun.sleep(150);
        await db.query("INSERT INTO connection_snapshot_check VALUES(1)").run();
      });
      const second = (async () => {
        await started;
        await other
          .query("INSERT INTO connection_snapshot_check VALUES(2)")
          .run();
      })();
      const results = await Promise.allSettled([first, second]);
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      expect(
        (
          await db
            .query("SELECT COUNT(*) n FROM connection_snapshot_check")
            .get()
        ).n,
      ).toBe(2);
    } finally {
      await other.close();
      await db.run("DROP TABLE connection_snapshot_check");
    }
  });
  test.skipIf(!existsSync(process.env.HONKER_EXTENSION_PATH || ""))(
    "queue claims and concurrent writes finish their cursors without losing work",
    async () => {
      await initJobs();
      await db.run(
        "CREATE TEMP TABLE concurrent_cursor_check(id INTEGER PRIMARY KEY, value TEXT)",
      );
      try {
        const results = await Promise.allSettled(
          Array.from({ length: 120 }, (_, i) =>
            i % 3 === 0
              ? db
                  .query(
                    "SELECT honker_claim_batch('cursor-check', 'fixture', 1, 10) AS jobs",
                  )
                  .get()
              : db
                  .query(
                    "INSERT INTO concurrent_cursor_check(value) VALUES (?) RETURNING id",
                  )
                  .get("fixture"),
          ),
        );
        expect(results.filter((r) => r.status === "rejected")).toEqual([]);
        expect(
          (
            await db
              .query("SELECT COUNT(*) n FROM concurrent_cursor_check")
              .get()
          ).n,
        ).toBe(80);
      } finally {
        await db.run("DROP TABLE concurrent_cursor_check");
      }
    },
  );
  test("cipher is active (PRAGMA cipher_version non-empty)", async () => {
    const row = await db.query("PRAGMA cipher_version").get();
    expect(row?.cipher_version).toBeTruthy();
  });

  test("data is encrypted at rest: plaintext not present in the file", async () => {
    const marker = "ZEBRA_MARKER_" + Date.now();
    await addVerifiedSigner({ name: marker });
    // Flush WAL into the main DB file so we inspect the persisted bytes.
    await db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytes = readFileSync(process.env.DATABASE_PATH);
    expect(bytes.includes(Buffer.from(marker))).toBe(false);
    expect(bytes.subarray(0, 16).toString()).not.toBe("SQLite format 3\0");
  });

  test("opening with the wrong key fails", async () => {
    await expect(
      openEncrypted(process.env.DATABASE_PATH, "definitely-wrong-key"),
    ).rejects.toThrow();
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

test("cross-connection statements and nested transactions fail immediately instead of waiting on SQLite", async () => {
  const other = await openEncrypted(DB_PATH);
  try {
    await db.transaction(async () => {
      await expect(other.query("SELECT 1").get()).rejects.toThrow(
        "transaction's connection",
      );
      await expect(db.transaction(async () => {})).rejects.toThrow("nesting");
    });
  } finally {
    await other.close();
  }
});
