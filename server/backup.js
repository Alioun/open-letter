// Export a consistent SQLCipher snapshot with sqlcipher_export().
// The attached destination uses the backup key. Optionally gzip the encrypted
// file, then delete snapshots older than BACKUP_KEEP hours.
import { mkdir, readdir, unlink, rename, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { db, openEncrypted, DB_PATH } from "../db/connection.js";
import cfg from "../config/letter.config.js";
import { resolvePrivacy, backupKeepHours } from "../config/privacy.js";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
// Hours of hourly backups to keep: the letter's privacy.backupRetentionHours,
// which the privacy policy quotes, unless BACKUP_KEEP overrides it.
const privacy = resolvePrivacy(cfg);
const BACKUP_KEEP = backupKeepHours(privacy, process.env.BACKUP_KEEP);
if (BACKUP_KEEP !== privacy.backupRetentionHours) {
  console.warn(
    `[backup] BACKUP_KEEP=${BACKUP_KEEP} differs from privacy.backupRetentionHours=${privacy.backupRetentionHours}, which the privacy policy states`,
  );
}
const BACKUP_GZIP = process.env.BACKUP_GZIP !== "false"; // gzip by default
// Match restoration key selection. An empty SQLCipher key disables encryption,
// so exportEncrypted rejects it before creating a backup.
const BACKUP_KEY =
  process.env.BACKUP_ENCRYPTION_KEY ||
  process.env.DATABASE_ENCRYPTION_KEY ||
  "";
// Production requires an explicit backup key.
if (
  process.env.NODE_ENV === "production" &&
  !process.env.BACKUP_ENCRYPTION_KEY
) {
  throw new Error(
    "BACKUP_ENCRYPTION_KEY must be set in production to protect encrypted backups.",
  );
}
const ONE_HOUR = 60 * 60 * 1000;

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Write a consistent encrypted snapshot to `destPath` (a SQLCipher DB file).
export async function exportEncrypted(destPath) {
  // Reject an empty key to avoid writing an unencrypted backup.
  if (!BACKUP_KEY) {
    throw new Error(
      "No backup encryption key (set BACKUP_ENCRYPTION_KEY or DATABASE_ENCRYPTION_KEY); refusing to write an unencrypted backup.",
    );
  }
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

const STATUS_KEY = "backup:status";

// What the admin is shown about backups: the last one that worked, the failure
// since (null once one works again), and `expiredRestorePoint`, the time of
// the newest backup when it is being kept past the retention the privacy
// policy states because nothing newer could be written.
export async function backupStatus() {
  const row = await db
    .query("SELECT value FROM app_settings WHERE key = ?")
    .get(STATUS_KEY);
  return {
    lastSuccessAt: null,
    lastSuccessBytes: null,
    lastError: null,
    lastErrorAt: null,
    expiredRestorePoint: null,
    ...(row && JSON.parse(row.value)),
    retentionHours: BACKUP_KEEP,
  };
}

async function saveStatus(change) {
  const { retentionHours, ...status } = await backupStatus();
  await db
    .query(
      `INSERT INTO app_settings /* public-neutral */ (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(
      STATUS_KEY,
      JSON.stringify({ ...status, ...change }),
      new Date().toISOString(),
    );
}

// Rejects when no backup was written, so the job that ran it fails with it.
export async function runBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = join(BACKUP_DIR, `backup-${ts}.sqlite`);
  const tmp = `${base}.tmp`;
  const finalPath = BACKUP_GZIP ? `${base}.gz` : base;
  const status = {};
  let failure;

  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    // Make room before writing, not only after: drop to one below the limit so
    // the new file lands in the slot the oldest one leaves. Steady-state disk
    // use is unchanged, but on a full disk this frees roughly one backup's
    // worth of space. Without it every attempt failed, nothing was ever
    // pruned, and backups never recovered on their own.
    await pruneToCount(Math.max(1, BACKUP_KEEP - 1));
    await exportEncrypted(tmp);

    if (BACKUP_GZIP) {
      await pipeline(
        createReadStream(tmp),
        createGzip(),
        createWriteStream(finalPath),
      );
      await unlink(tmp);
    } else {
      await rename(tmp, finalPath);
    }

    console.log(`[backup] saved ${finalPath}`);
    await pruneToCount(BACKUP_KEEP);
    Object.assign(status, {
      lastSuccessAt: new Date().toISOString(),
      lastSuccessBytes: (await stat(finalPath)).size,
      lastError: null,
      lastErrorAt: null,
    });
  } catch (err) {
    failure = err;
    console.error(`[backup] failed: ${err.message}`);
    for (const f of [tmp, finalPath]) {
      try {
        await unlink(f);
      } catch {}
    }
    Object.assign(status, {
      lastError: String(err.message).slice(0, 300),
      lastErrorAt: new Date().toISOString(),
    });
  }

  // Retention is enforced whether or not this run succeeded: the privacy
  // policy promises deleted data is gone from backups after BACKUP_KEEP (48)
  // hours, and a run of failed backups must not quietly suspend that.
  try {
    status.expiredRestorePoint = await pruneExpired();
    await prunePreRestore();
    await pruneStaleTmp();
  } catch (err) {
    console.error(`[backup] prune failed: ${err.message}`);
  }
  try {
    await saveStatus(status);
  } catch (err) {
    console.error(`[backup] status not saved: ${err.message}`);
  }
  if (failure) throw failure;
}

// Timestamp embedded in backup and pre-restore file names:
// YYYY-MM-DDTHH-MM-SS (UTC). Returns ms since epoch, or NaN.
function nameTime(s) {
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN;
}

// Only finished backups: a `.sqlite.tmp` left behind by an interrupted run is
// not a restore point and must not count towards (or be kept as) the newest.
const BACKUP_FILE_RE = /^backup-.+\.sqlite(\.gz)?$/;

async function listBackups() {
  return (await readdir(BACKUP_DIR))
    .filter((f) => BACKUP_FILE_RE.test(f))
    .sort()
    .reverse(); // newest first
}

async function pruneToCount(keep) {
  let files;
  try {
    files = await listBackups();
  } catch {
    return;
  }
  for (const f of files.slice(keep)) {
    await unlink(join(BACKUP_DIR, f));
    console.log(`[backup] pruned ${f}`);
  }
}

// Delete backups older than BACKUP_KEEP hours, except the newest one. While
// backups are succeeding that exception never applies (the newest is at most
// an hour old). If they keep failing, the last good backup is kept so there is
// still something to restore from. That copy is then past the promised
// retention, so its time is returned for the admin's backup state (null
// otherwise) and logged every run rather than silently resolved by deleting it.
async function pruneExpired() {
  let files;
  try {
    files = await listBackups();
  } catch {
    return null;
  }
  const cutoff = Date.now() - BACKUP_KEEP * ONE_HOUR;
  const [newest, ...older] = files;
  for (const f of older) {
    const at = nameTime(f.slice("backup-".length));
    if (Number.isNaN(at) || at >= cutoff) continue;
    await unlink(join(BACKUP_DIR, f));
    console.log(`[backup] pruned ${f} (older than ${BACKUP_KEEP}h)`);
  }
  const newestAt = newest ? nameTime(newest.slice("backup-".length)) : NaN;
  if (Number.isNaN(newestAt) || newestAt >= cutoff) return null;
  console.error(
    `[backup] newest backup ${newest} is older than ${BACKUP_KEEP}h: backups are failing; kept as the only restore point, past the stated retention`,
  );
  return new Date(newestAt).toISOString();
}

// A `.sqlite.tmp` is only ever the in-flight export of one run. If the process
// dies mid-export (deploy, OOM) the run's own catch never cleans it up, and
// BACKUP_FILE_RE keeps it out of the pruning above, so drop any tmp whose
// timestamp is over an hour old, well past any run that could still own it.
async function pruneStaleTmp() {
  let names;
  try {
    names = await readdir(BACKUP_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - ONE_HOUR;
  for (const f of names) {
    if (!/^backup-.+\.sqlite\.tmp$/.test(f)) continue;
    const at = nameTime(f.slice("backup-".length));
    if (Number.isNaN(at) || at >= cutoff) continue;
    await unlink(join(BACKUP_DIR, f));
    console.log(`[backup] pruned stale ${f}`);
  }
}

// db/restore-backup.js moves the replaced database aside as
// `<DATABASE_PATH>.pre-restore-<timestamp>[-wal|-shm]`. Those are full copies
// of personal data, so they follow the same retention as the backups
// themselves (BACKUP_KEEP hours, which the privacy policy states as 48):
// long enough to check a restore, not kept indefinitely.
async function prunePreRestore() {
  const dir = dirname(DB_PATH);
  const prefix = `${basename(DB_PATH)}.pre-restore-`;
  const cutoff = Date.now() - BACKUP_KEEP * ONE_HOUR;
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const f of names) {
    if (!f.startsWith(prefix)) continue;
    const at = nameTime(f.slice(prefix.length));
    if (Number.isNaN(at) || at >= cutoff) continue;
    await unlink(join(dir, f));
    console.log(`[backup] pruned ${f}`);
  }
}

// Hourly schedule. Kept as a lightweight fallback; the Honker scheduler also
// drives backups in production (db/jobs.js). Safe to run either way.
export function startBackupSchedule() {
  if (!BACKUP_KEY) {
    console.warn("[backup] no encryption key, backups disabled");
    return;
  }

  const safe = () =>
    runBackup().catch((err) => console.error("[backup] unhandled error:", err));

  const initial = setTimeout(safe, 30_000);
  initial.unref?.();
  const interval = setInterval(safe, ONE_HOUR);
  interval.unref?.();

  console.log(
    `[backup] hourly backup scheduled, dir: ${BACKUP_DIR}, keep: ${BACKUP_KEEP}`,
  );
}
