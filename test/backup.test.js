import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resetDb, addVerifiedSigner } from "./helpers.js";
import { exportEncrypted } from "../server/backup.js";
import { openEncrypted } from "../db/connection.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.DATABASE_ENCRYPTION_KEY;
const tmpDirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "diaet-bk-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Run a bun snippet/script in an isolated DB environment.
function run(args, extraEnv) {
  return Bun.spawnSync(["bun", ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("encrypted backup", () => {
  beforeEach(resetDb);

  test("exportEncrypted produces a readable, key-matched snapshot", async () => {
    await addVerifiedSigner();
    await addVerifiedSigner();
    const dest = join(tmp(), "snap.sqlite");
    await exportEncrypted(dest);
    expect(existsSync(dest)).toBe(true);

    const snap = await openEncrypted(dest, KEY);
    expect((await snap.query("SELECT COUNT(*) c FROM signers").get()).c).toBe(2);
    await snap.close();
  });
});

describe("backup + restore round-trip (isolated DB, via subprocess)", () => {
  test("restore --latest rebuilds the DB and matches row counts", () => {
    const dir = tmp();
    const dbPath = join(dir, "iso.db");
    const backupDir = join(dir, "backups");
    const env = {
      DATABASE_PATH: dbPath,
      DATABASE_ENCRYPTION_KEY: KEY,
      BACKUP_DIR: backupDir,
      HONKER_EXTENSION_PATH: "", // not needed here
    };

    // 1) schema + 3 signers
    const setup = run(["db/setup.js"], env);
    expect(setup.exitCode).toBe(0);
    const insert = run(
      [
        "-e",
        `import {db} from "./db/connection.js";
         for (let i=0;i<3;i++) await db.query("INSERT INTO signers (name,email,verified,created_at) VALUES (?,?,1,?)").run("P"+i,"p"+i+"@x.de",new Date().toISOString());`,
      ],
      env,
    );
    expect(insert.exitCode).toBe(0);

    // 2) create a backup
    const backup = run(
      ["-e", `import {runBackup} from "./server/backup.js"; await runBackup();`],
      env,
    );
    expect(backup.exitCode).toBe(0);
    expect(readdirSync(backupDir).some((f) => f.includes(".sqlite"))).toBe(true);

    // 3) delete all signers
    const del = run(
      ["-e", `import {db} from "./db/connection.js"; await db.query("DELETE FROM signers").run();`],
      env,
    );
    expect(del.exitCode).toBe(0);

    // 4) restore --latest
    const restore = run(["db/restore-backup.js", "--latest"], env);
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout.toString()).toContain("all table counts match");

    // 5) a pre-restore safety copy was created
    expect(readdirSync(dir).some((f) => f.startsWith("iso.db.pre-restore-"))).toBe(true);

    // 6) verify 3 signers restored
    const verify = run(
      [
        "-e",
        `import {db} from "./db/connection.js"; process.stdout.write(String((await db.query("SELECT COUNT(*) c FROM signers").get()).c));`,
      ],
      env,
    );
    expect(verify.stdout.toString().trim()).toBe("3");
  });
});
