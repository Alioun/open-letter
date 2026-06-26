// Restore an encrypted SQLCipher backup into DATABASE_PATH.
//
// Usage:
//   bun db/restore-backup.js --latest
//   bun db/restore-backup.js /app/backups/backup-2026-06-09T12-00-00.sqlite.gz
//
// Safety:
//   * Verifies the backup opens with the backup key and passes integrity_check.
//   * Never overwrites a live DB silently — any existing DATABASE_PATH is moved
//     aside to <path>.pre-restore-<timestamp> first.
//   * Rebuilds DATABASE_PATH via sqlcipher_export so the restored DB is always
//     re-keyed to DATABASE_ENCRYPTION_KEY (handles a distinct backup key).
// Intended to run while the app is stopped.
import { readdir, rename, unlink, mkdir } from "node:fs/promises";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import process from "node:process";
import { openEncrypted, DB_PATH } from "./connection.js";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
const DB_KEY = process.env.DATABASE_ENCRYPTION_KEY || "";
const BACKUP_KEY =
  process.env.BACKUP_ENCRYPTION_KEY || process.env.DATABASE_ENCRYPTION_KEY || "";

const TABLES = [
  "signers",
  "email_templates",
  "campaigns",
  "zoom_registrations",
  "zoom_event_mailings",
  "app_settings",
  "kv_state_cache",
  "kv_not_typo",
  "occupation_not_typo",
];

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function counts(db) {
  const out = {};
  for (const t of TABLES) {
    try {
      out[t] = (await db.query(`SELECT COUNT(*) AS c FROM ${t}`).get()).c;
    } catch {
      out[t] = "—";
    }
  }
  return out;
}

async function resolveBackupFile(arg) {
  if (arg && arg !== "--latest") return arg;
  const files = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith("backup-") && f.includes(".sqlite"))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`No backups found in ${BACKUP_DIR}`);
  }
  return join(BACKUP_DIR, files[0]);
}

async function main() {
  if (!DB_KEY) throw new Error("DATABASE_ENCRYPTION_KEY is required");
  const arg = process.argv[2];
  if (!arg) {
    throw new Error("Usage: bun db/restore-backup.js <backup-file | --latest>");
  }

  let src = await resolveBackupFile(arg);
  console.log(`[restore] source: ${src}`);

  // Decompress if gzipped.
  let tmpPlain = null;
  if (src.endsWith(".gz")) {
    tmpPlain = src.replace(/\.gz$/, "") + ".restore-tmp";
    await pipeline(
      createReadStream(src),
      createGunzip(),
      createWriteStream(tmpPlain),
    );
    src = tmpPlain;
  }

  // Verify the backup opens + integrity.
  const backupDb = await openEncrypted(src, BACKUP_KEY);
  const integrity = await backupDb.query("PRAGMA integrity_check").get();
  if (!integrity || integrity.integrity_check !== "ok") {
    await backupDb.close();
    throw new Error(`Backup failed integrity_check: ${JSON.stringify(integrity)}`);
  }
  const srcCounts = await counts(backupDb);
  console.log("[restore] backup row counts:", JSON.stringify(srcCounts));

  // Move any existing live DB aside (incl. WAL/SHM sidecars).
  await mkdir(dirname(DB_PATH), { recursive: true });
  if (existsSync(DB_PATH)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = DB_PATH + suffix;
      if (existsSync(p)) {
        const aside = `${DB_PATH}.pre-restore-${ts}${suffix}`;
        await rename(p, aside);
        console.log(`[restore] moved ${p} -> ${aside}`);
      }
    }
  }

  // Rebuild DATABASE_PATH from the backup, re-keyed to the live key.
  await backupDb.run(
    `ATTACH DATABASE ${sqlQuote(DB_PATH)} AS live KEY ${sqlQuote(DB_KEY)}`,
  );
  try {
    await backupDb.query("SELECT sqlcipher_export('live')").get();
  } finally {
    await backupDb.run("DETACH DATABASE live");
    await backupDb.close();
  }
  if (tmpPlain) await unlink(tmpPlain).catch(() => {});

  // Verify the restored DB opens with the live key and matches counts.
  const liveDb = await openEncrypted(DB_PATH, DB_KEY);
  const dstCounts = await counts(liveDb);
  await liveDb.close();
  console.log("[restore] restored row counts:", JSON.stringify(dstCounts));

  const mismatch = TABLES.filter((t) => srcCounts[t] !== dstCounts[t]);
  if (mismatch.length) {
    throw new Error(`Row-count mismatch after restore: ${mismatch.join(", ")}`);
  }
  console.log("[restore] OK — all table counts match.");
}

main().catch((err) => {
  console.error(`[restore] ${err.message}`);
  process.exit(1);
});
