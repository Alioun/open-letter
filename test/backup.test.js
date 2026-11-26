import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
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
afterAll(() =>
  tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })),
);

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
    expect((await snap.query("SELECT COUNT(*) c FROM signers").get()).c).toBe(
      2,
    );
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
      [
        "-e",
        `import {runBackup} from "./server/backup.js"; await runBackup();`,
      ],
      env,
    );
    expect(backup.exitCode).toBe(0);
    expect(readdirSync(backupDir).some((f) => f.includes(".sqlite"))).toBe(
      true,
    );

    // 3) delete all signers
    const del = run(
      [
        "-e",
        `import {db} from "./db/connection.js"; await db.query("DELETE FROM signers").run();`,
      ],
      env,
    );
    expect(del.exitCode).toBe(0);

    // 4) restore --latest
    const restore = run(["db/restore-backup.js", "--latest"], env);
    expect(restore.exitCode).toBe(0);
    expect(restore.stdout.toString()).toContain(
      "all restored table counts match",
    );

    // 5) a pre-restore safety copy was created
    expect(
      readdirSync(dir).some((f) => f.startsWith("iso.db.pre-restore-")),
    ).toBe(true);

    // 6) verify 3 signers restored
    const verify = run(
      [
        "-e",
        `import {db} from "./db/connection.js"; console.log(String((await db.query("SELECT COUNT(*) c FROM signers").get()).c));`,
      ],
      env,
    );
    expect(verify.exitCode, verify.stderr.toString()).toBe(0);
    expect(verify.stdout.toString().trim()).toBe("3");
  });
});

describe("pre-restore copies", () => {
  test("are pruned with the backups once older than BACKUP_KEEP hours", () => {
    const dataDir = tmp();
    const backupDir = tmp();
    const dbPath = join(dataDir, "live.db");
    const iso = (msAgo) =>
      new Date(Date.now() - msAgo)
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
    const old = `live.db.pre-restore-${iso(49 * 3600_000)}`;
    const recent = `live.db.pre-restore-${iso(3600_000)}`;
    for (const f of [old, `${old}-wal`, recent])
      writeFileSync(join(dataDir, f), "x");
    expect(readdirSync(dataDir)).toContain(old);

    const res = run(
      [
        "-e",
        "const { runBackup } = await import('./server/backup.js'); await runBackup();",
      ],
      { DATABASE_PATH: dbPath, BACKUP_DIR: backupDir, BACKUP_KEEP: "48" },
    );
    expect(res.exitCode).toBe(0);

    const left = readdirSync(dataDir);
    expect(left).not.toContain(old);
    expect(left).not.toContain(`${old}-wal`);
    expect(left).toContain(recent);
  });
});

describe("backups that overlap", () => {
  const stamp = (msAgo) =>
    new Date(Date.now() - msAgo)
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

  test("backups started together all succeed, and each leaves its own copy", async () => {
    await resetDb();
    await addVerifiedSigner();
    await addVerifiedSigner();
    const backupDir = tmp();

    // An import's backup and the hourly one, started together.
    const res = run(
      [
        "-e",
        `const { runBackup } = await import('./server/backup.js');
         const results = await Promise.allSettled([runBackup(), runBackup(), runBackup()]);
         console.log(JSON.stringify(results.map((r) => r.status)));
         if (results.some((r) => r.status === "rejected")) process.exit(1);`,
      ],
      { BACKUP_DIR: backupDir, BACKUP_KEEP: "48" },
    );
    expect(res.stdout.toString().trim().split("\n").at(-1)).toBe(
      JSON.stringify(["fulfilled", "fulfilled", "fulfilled"]),
    );
    expect(res.exitCode).toBe(0);

    const files = readdirSync(backupDir);
    expect(files.filter((f) => !/^backup-.+\.sqlite\.gz$/.test(f))).toEqual([]);
    expect(files).toHaveLength(3);
    const plain = join(tmp(), "newest.sqlite");
    writeFileSync(
      plain,
      gunzipSync(readFileSync(join(backupDir, files.sort().at(-1)))),
    );
    const snap = await openEncrypted(plain, KEY);
    expect((await snap.query("SELECT COUNT(*) c FROM signers").get()).c).toBe(
      2,
    );
    await snap.close();
  }, 60_000);

  test("a backup made in the same second as a finished one leaves that one as it is and sorts after it", async () => {
    await resetDb();
    await addVerifiedSigner();
    const backupDir = tmp();
    // A finished backup for every second the run could fall into, such as
    // the restore point taken before an import.
    const finished = [];
    for (let s = 0; s < 30; s++) {
      const name = `backup-${stamp(-s * 1000)}.sqlite.gz`;
      writeFileSync(join(backupDir, name), `restore point ${s}`);
      finished.push(name);
    }

    const res = run(
      [
        "-e",
        "const { runBackup } = await import('./server/backup.js'); await runBackup();",
      ],
      { BACKUP_DIR: backupDir, BACKUP_KEEP: "48" },
    );
    expect(res.exitCode, res.stderr.toString()).toBe(0);

    expect(
      finished.map((name) => readFileSync(join(backupDir, name), "utf8")),
    ).toEqual(finished.map((_, s) => `restore point ${s}`));
    const files = readdirSync(backupDir).sort();
    expect(files).toHaveLength(finished.length + 1);
    // The new backup is the one a restore of the latest picks.
    expect(finished).not.toContain(files.at(-1));
    expect(files.at(-1)).toMatch(/^backup-.+\.sqlite\.gz$/);
  }, 60_000);

  test("a backup that fails leaves the finished backups alone", () => {
    const backupDir = tmp();
    // A finished backup ahead of the clock, so the run takes the second after
    // it for its name, and no way to write an export under that name.
    const finished = `backup-${stamp(-60_000)}.sqlite.gz`;
    writeFileSync(join(backupDir, finished), "finished");
    mkdirSync(join(backupDir, `backup-${stamp(-61_000)}.sqlite.tmp`));

    const res = run(
      [
        "-e",
        "const { runBackup } = await import('./server/backup.js'); await runBackup();",
      ],
      {
        DATABASE_PATH: join(tmp(), "live.db"),
        BACKUP_DIR: backupDir,
        BACKUP_KEEP: "48",
      },
    );
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("[backup] failed");
    expect(readdirSync(backupDir).filter((f) => f.endsWith(".gz"))).toEqual([
      finished,
    ]);
    expect(readFileSync(join(backupDir, finished), "utf8")).toBe("finished");
  }, 60_000);
});

describe("backup retention", () => {
  const stamp = (msAgo) =>
    new Date(Date.now() - msAgo)
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
  const backupName = (msAgo) => `backup-${stamp(msAgo)}.sqlite.gz`;
  const runBackupIn = (env) =>
    run(
      [
        "-e",
        "const { runBackup } = await import('./server/backup.js'); await runBackup();",
      ],
      env,
    );

  test("a failed backup still prunes expired copies, but keeps the newest", () => {
    const dataDir = tmp();
    const backupDir = tmp();
    const dbPath = join(dataDir, "live.db");
    // Make the export fail mid-run: occupy every temp-file path the backup
    // could pick in the next half minute with a directory, so ATTACH can't
    // create its file there.
    for (let s = 0; s < 30; s++) {
      mkdirSync(join(backupDir, `backup-${stamp(-s * 1000)}.sqlite.tmp`), {
        recursive: true,
      });
    }

    const newest = backupName(60 * 3600_000); // stale: backups have been failing
    const expired = backupName(70 * 3600_000);
    const preRestore = `live.db.pre-restore-${stamp(60 * 3600_000)}`;
    for (const f of [newest, expired]) writeFileSync(join(backupDir, f), "x");
    writeFileSync(join(dataDir, preRestore), "x");

    const res = runBackupIn({
      DATABASE_PATH: dbPath,
      BACKUP_DIR: backupDir,
      BACKUP_KEEP: "48",
    });
    // The run fails with the backup, so the job that started it does too.
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.toString()).toContain("[backup] failed");

    // No new backup was written, yet retention ran anyway.
    expect(readdirSync(backupDir).filter((f) => !f.endsWith(".tmp"))).toEqual([
      newest,
    ]);
    expect(readdirSync(dataDir)).not.toContain(preRestore);
    // Keeping the last restore point past retention is flagged, not silent.
    expect(res.stderr.toString()).toContain("older than 48h");
  });

  test("the backup state records what worked, what failed since, and a copy kept past retention", async () => {
    await resetDb();
    await addVerifiedSigner();
    const backupDir = tmp();
    const env = { BACKUP_DIR: backupDir, BACKUP_KEEP: "48" };
    const state = async () => {
      const res = run(
        [
          "-e",
          "const { backupStatus } = await import('./server/backup.js'); console.log(JSON.stringify(await backupStatus()));",
        ],
        env,
      );
      expect(res.exitCode, res.stderr.toString()).toBe(0);
      return JSON.parse(res.stdout.toString());
    };
    expect(await state()).toMatchObject({
      lastSuccessAt: null,
      lastError: null,
      expiredRestorePoint: null,
      retentionHours: 48,
    });

    expect(runBackupIn(env).exitCode).toBe(0);
    const worked = await state();
    expect(Date.parse(worked.lastSuccessAt)).toBeGreaterThan(
      Date.now() - 120_000,
    );
    const [file] = readdirSync(backupDir);
    expect(worked.lastSuccessBytes).toBe(statSync(join(backupDir, file)).size);
    expect(worked).toMatchObject({ lastError: null, expiredRestorePoint: null });

    // From here the export has nowhere to write, and the one backup there is
    // has aged past retention.
    rmSync(join(backupDir, file));
    const staleAt = stamp(60 * 3600_000);
    const stale = `backup-${staleAt}.sqlite.gz`;
    writeFileSync(join(backupDir, stale), "x");
    for (let s = 0; s < 30; s++)
      mkdirSync(join(backupDir, `backup-${stamp(-s * 1000)}.sqlite.tmp`), {
        recursive: true,
      });
    expect(runBackupIn(env).exitCode).not.toBe(0);
    const failed = await state();
    expect(failed.lastSuccessAt).toBe(worked.lastSuccessAt);
    expect(failed.lastError).toBeTruthy();
    expect(Date.parse(failed.lastErrorAt)).toBeGreaterThan(
      Date.parse(worked.lastSuccessAt) - 1,
    );
    expect(failed.expiredRestorePoint).toBe(
      `${staleAt.replace(/T(..)-(..)-(..)$/, "T$1:$2:$3")}.000Z`,
    );
    expect(readdirSync(backupDir)).toContain(stale);
  });

  test("removes a .tmp export orphaned by a crashed run, but not a fresh one", async () => {
    await resetDb();
    await addVerifiedSigner();
    const backupDir = tmp();
    const orphan = `backup-${stamp(3 * 3600_000)}.sqlite.tmp`;
    const fresh = `backup-${stamp(10 * 60_000)}.sqlite.tmp`;
    for (const f of [orphan, fresh]) writeFileSync(join(backupDir, f), "x");

    const res = runBackupIn({ BACKUP_DIR: backupDir, BACKUP_KEEP: "48" });
    expect(res.exitCode).toBe(0);

    const left = readdirSync(backupDir);
    expect(left).not.toContain(orphan);
    expect(left).toContain(fresh);
  });

  test("makes room before writing, so a full backup set stays at the limit", async () => {
    await resetDb();
    await addVerifiedSigner();
    const backupDir = tmp();
    const keep = 3;
    const existing = [3, 2, 1].map((h) => backupName(h * 3600_000));
    for (const f of existing) writeFileSync(join(backupDir, f), "x");

    const res = runBackupIn({
      BACKUP_DIR: backupDir,
      BACKUP_KEEP: String(keep),
    });
    expect(res.exitCode).toBe(0);

    const left = readdirSync(backupDir).sort();
    expect(left).toHaveLength(keep);
    expect(left).not.toContain(existing[0]); // the oldest made room
    expect(left.filter((f) => !existing.includes(f))).toHaveLength(1); // the new one
  });
});
