// Encrypted SQLCipher backups.
//
// Produces a consistent, SQLCipher-encrypted snapshot of the live database using
// `sqlcipher_export()` into an ATTACHed, keyed backup file. The backup file is
// itself encrypted at rest (no separate encryption step needed). Optionally
// gzips the result. Old backups are pruned to BACKUP_KEEP.
import { mkdir, readdir, unlink, rename } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { openEncrypted, DB_PATH } from "../db/connection.js";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
const BACKUP_KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || "48", 10));
const BACKUP_GZIP = process.env.BACKUP_GZIP !== "false"; // gzip by default
// Backups may use a distinct key; defaults to the live DB key.
const BACKUP_KEY =
  process.env.BACKUP_ENCRYPTION_KEY || process.env.DATABASE_ENCRYPTION_KEY || "";
const ONE_HOUR = 60 * 60 * 1000;

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Write a consistent encrypted snapshot to `destPath` (a SQLCipher DB file).
export async function exportEncrypted(destPath) {
  const db = await openEncrypted(DB_PATH);
  try {
    await db.run(
      `ATTACH DATABASE ${sqlQuote(destPath)} AS backup KEY ${sqlQuote(BACKUP_KEY)}`,
    );
    try {
      await db.query("SELECT sqlcipher_export('backup')").get();
    } finally {
      await db.run("DETACH DATABASE backup");
    }
  } finally {
    await db.close();
  }
}

export async function runBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = join(BACKUP_DIR, `backup-${ts}.sqlite`);
  const tmp = `${base}.tmp`;
  const finalPath = BACKUP_GZIP ? `${base}.gz` : base;

  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    await exportEncrypted(tmp);

    if (BACKUP_GZIP) {
      await pipeline(createReadStream(tmp), createGzip(), createWriteStream(finalPath));
      await unlink(tmp);
    } else {
      await rename(tmp, finalPath);
    }

    console.log(`[backup] saved ${finalPath}`);
    await prune();
  } catch (err) {
    console.error(`[backup] failed: ${err.message}`);
    for (const f of [tmp, finalPath]) {
      try {
        await unlink(f);
      } catch {}
    }
  }
}

async function prune() {
  const files = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith("backup-") && f.includes(".sqlite"))
    .sort()
    .reverse();

  for (const f of files.slice(BACKUP_KEEP)) {
    await unlink(join(BACKUP_DIR, f));
    console.log(`[backup] pruned ${f}`);
  }
}

// Hourly schedule. Kept as a lightweight fallback; the Honker scheduler also
// drives backups in production (db/jobs.js). Safe to run either way.
export function startBackupSchedule() {
  if (!BACKUP_KEY) {
    console.warn("[backup] no encryption key — backups disabled");
    return;
  }

  const safe = () =>
    runBackup().catch((err) => console.error("[backup] unhandled error:", err));

  const initial = setTimeout(safe, 30_000);
  initial.unref?.();
  const interval = setInterval(safe, ONE_HOUR);
  interval.unref?.();

  console.log(
    `[backup] hourly backup scheduled — dir: ${BACKUP_DIR}, keep: ${BACKUP_KEEP}`,
  );
}
