import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
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

describe("pre-restore copies", () => {
  test("are pruned with the backups once older than BACKUP_KEEP hours", () => {
    const dataDir = tmp();
    const backupDir = tmp();
    const dbPath = join(dataDir, "live.db");
    const iso = (msAgo) =>
      new Date(Date.now() - msAgo).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const old = `live.db.pre-restore-${iso(49 * 3600_000)}`;
    const recent = `live.db.pre-restore-${iso(3600_000)}`;
    for (const f of [old, `${old}-wal`, recent]) writeFileSync(join(dataDir, f), "x");
    expect(readdirSync(dataDir)).toContain(old);

    const res = run(
      ["-e", "const { runBackup } = await import('./server/backup.js'); await runBackup();"],
      { DATABASE_PATH: dbPath, BACKUP_DIR: backupDir, BACKUP_KEEP: "48" },
    );
    expect(res.exitCode).toBe(0);

    const left = readdirSync(dataDir);
    expect(left).not.toContain(old);
    expect(left).not.toContain(`${old}-wal`);
    expect(left).toContain(recent);
  });
});

describe("backup retention", () => {
  const stamp = (msAgo) =>
    new Date(Date.now() - msAgo).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupName = (msAgo) => `backup-${stamp(msAgo)}.sqlite.gz`;
  const runBackupIn = (env) =>
    run(["-e", "const { runBackup } = await import('./server/backup.js'); await runBackup();"], env);

  test("a failed backup still prunes expired copies, but keeps the newest", () => {
    const dataDir = tmp();
    const backupDir = tmp();
    const dbPath = join(dataDir, "live.db");
    // Make the export fail mid-run: occupy every temp-file path the backup
    // could pick in the next half minute with a directory, so ATTACH can't
    // create its file there.
    for (let s = 0; s < 30; s++) {
      mkdirSync(join(backupDir, `backup-${stamp(-s * 1000)}.sqlite.tmp`), { recursive: true });
    }

    const newest = backupName(60 * 3600_000); // stale: backups have been failing
    const expired = backupName(70 * 3600_000);
    const preRestore = `live.db.pre-restore-${stamp(60 * 3600_000)}`;
    for (const f of [newest, expired]) writeFileSync(join(backupDir, f), "x");
    writeFileSync(join(dataDir, preRestore), "x");

    const res = runBackupIn({ DATABASE_PATH: dbPath, BACKUP_DIR: backupDir, BACKUP_KEEP: "48" });
    expect(res.exitCode).toBe(0);
    expect(res.stderr.toString()).toContain("[backup] failed");

    // No new backup was written, yet retention ran anyway.
    expect(readdirSync(backupDir).filter((f) => !f.endsWith(".tmp"))).toEqual([newest]);
    expect(readdirSync(dataDir)).not.toContain(preRestore);
    // Keeping the last restore point past retention is flagged, not silent.
    expect(res.stderr.toString()).toContain("older than 48h");
  });

  test("makes room before writing, so a full backup set stays at the limit", async () => {
    await resetDb();
    await addVerifiedSigner();
    const backupDir = tmp();
    const keep = 3;
    const existing = [3, 2, 1].map((h) => backupName(h * 3600_000));
    for (const f of existing) writeFileSync(join(backupDir, f), "x");

    const res = runBackupIn({ BACKUP_DIR: backupDir, BACKUP_KEEP: String(keep) });
    expect(res.exitCode).toBe(0);

    const left = readdirSync(backupDir).sort();
    expect(left).toHaveLength(keep);
    expect(left).not.toContain(existing[0]); // the oldest made room
    expect(left.filter((f) => !existing.includes(f))).toHaveLength(1); // the new one
  });
});
