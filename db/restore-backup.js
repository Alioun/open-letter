// Restore an encrypted SQLCipher backup into DATABASE_PATH.
//
// Usage:
//   bun db/restore-backup.js --latest
//   bun db/restore-backup.js /app/backups/backup-2026-06-09T12-00-00.sqlite.gz
//
// Safety:
//   * Verifies the backup opens with the backup key and passes integrity_check.
//   * Never overwrites a live DB silently: any existing DATABASE_PATH is moved
//     aside to <path>.pre-restore-<timestamp> first.
//   * Rebuilds DATABASE_PATH via sqlcipher_export so the restored DB is always
//     re-keyed to DATABASE_ENCRYPTION_KEY (handles a distinct backup key).
//   * Re-applies erasures and opt-outs from the replaced database's erasure log
//     (db/erasure-log.js), so a restore doesn't bring deleted data back.
//   * Ends every admin session, so a restore doesn't bring back sessions that
//     were ended after the backup was taken.
// Intended to run while the app is stopped.
import { readdir, rename, unlink, mkdir } from "node:fs/promises";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import process from "node:process";
import { createHash } from "node:crypto";
import {
  cleanDocument,
  reconcileStoredDocument,
} from "../server/publications.js";
import { openEncrypted, DB_PATH } from "./connection.js";
import { readErasureLog, applyErasureLog } from "./erasure-log.js";
import { endAdminSessions } from "../server/admin-sessions.js";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
const DB_KEY = process.env.DATABASE_ENCRYPTION_KEY || "";
const BACKUP_KEY =
  process.env.BACKUP_ENCRYPTION_KEY ||
  process.env.DATABASE_ENCRYPTION_KEY ||
  "";

const TABLES = [
  "signers",
  "email_templates",
  "campaigns",
  "zoom_registrations",
  "deletion_requests",
  "zoom_pending",
  "erasure_log",
  "zoom_event_mailings",
  "app_settings",
  "kv_state_cache",
  "kv_not_typo",
  "occupation_not_typo",
  "admin_merges",
  "admin_actions",
  "publications",
  "publication_assets",
  "first_signer_pins",
  "email_configuration",
  "email_attempts",
  "email_quota",
];

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function counts(db) {
  const out = {};
  const analytics = await db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'analytics_%'",
    )
    .all();
  for (const t of [...TABLES, ...analytics.map((r) => r.name)]) {
    try {
      out[t] = (await db.query(`SELECT COUNT(*) AS c FROM ${t}`).get()).c;
    } catch {
      out[t] = "-";
    }
  }
  return out;
}

async function resolveBackupFile(arg) {
  if (arg && arg !== "--latest") return arg;
  const files = (await readdir(BACKUP_DIR))
    // Finished backups only, never a `.sqlite.tmp` from an interrupted run.
    .filter((f) => /^backup-.+\.sqlite(\.gz)?$/.test(f))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`No backups found in ${BACKUP_DIR}`);
  }
  return join(BACKUP_DIR, files[0]);
}

async function validatePublications(connection, persist = false) {
  const table = await connection
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='publications'",
    )
    .get();
  if (!table) return;
  const assets = await connection
    .query("SELECT * FROM publication_assets")
    .all();
  for (const asset of assets) {
    if (
      asset.mime !== "image/png" ||
      createHash("sha256").update(Buffer.from(asset.bytes)).digest("hex") !==
        asset.hash ||
      asset.width < 16 ||
      asset.height < 16 ||
      asset.width > 2400 ||
      asset.height > 2400
    )
      throw new Error("Invalid publication asset in backup");
  }
  const knownAssets = assets.map((a) => `/assets/${a.hash}.png`);
  for (const row of await connection
    .query("SELECT revision,document FROM publications")
    .all()) {
    const document = cleanDocument(
      reconcileStoredDocument(JSON.parse(row.document)),
      knownAssets,
    );
    if (persist)
      await connection
        .query("UPDATE publications SET document=? WHERE revision=?")
        .run(JSON.stringify(document), row.revision);
  }
}

async function main() {
  if (!DB_KEY) throw new Error("DATABASE_ENCRYPTION_KEY is required");
  if (!BACKUP_KEY) {
    throw new Error(
      "No backup key (set BACKUP_ENCRYPTION_KEY or DATABASE_ENCRYPTION_KEY) to open the backup.",
    );
  }
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
    throw new Error(
      `Backup failed integrity_check: ${JSON.stringify(integrity)}`,
    );
  }
  await validatePublications(backupDb);
  const srcCounts = await counts(backupDb);
  console.log("[restore] backup row counts:", JSON.stringify(srcCounts));

  // Read the erasure log from the database being replaced, before moving it.
  const erasures = await readLiveErasureLog();

  // Move any existing live DB aside (incl. WAL/SHM sidecars).
  await mkdir(dirname(DB_PATH), { recursive: true });
  if (existsSync(DB_PATH)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = DB_PATH + suffix;
      if (existsSync(p)) {
        const aside = `${DB_PATH}.pre-restore-${ts}${suffix}`;
        await rename(p, aside);
        console.log(
          `[restore] moved ${p} -> ${aside} (removed by the backup job after BACKUP_KEEP hours)`,
        );
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

  const mismatch = [
    ...new Set([...Object.keys(srcCounts), ...Object.keys(dstCounts)]),
  ].filter((t) => srcCounts[t] !== dstCounts[t]);
  if (mismatch.length) {
    throw new Error(`Row-count mismatch after restore: ${mismatch.join(", ")}`);
  }
  console.log("[restore] all restored table counts match.");

  if (erasures === null) {
    console.error(
      "[restore] Could not read the replaced database's erasure log. " +
        "Later erasures and opt-outs have not been reapplied. Reapply them " +
        "before starting the app, using the pre-restore copy if available.",
    );
  }
  const restored = await openEncrypted(DB_PATH, DB_KEY);
  try {
    await restored.transaction(() => validatePublications(restored, true), {
      immediate: true,
    });
    // A backup cannot attest that restored credentials still work or that attempts completed.
    await restored
      .query(
        "INSERT INTO app_settings (key,value) VALUES ('email:restored',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(new Date().toISOString());
    await endAdminSessions(restored);
    const applied = await applyErasureLog(restored, erasures || []);
    console.log(
      `[restore] re-applied erasure log (${(erasures || []).length} entr${(erasures || []).length === 1 ? "y" : "ies"}):`,
      JSON.stringify(applied),
    );
  } finally {
    await restored.close();
  }
}

// null = there was a database but its log couldn't be read; [] = nothing to do.
async function readLiveErasureLog() {
  if (!existsSync(DB_PATH)) return [];
  let live;
  try {
    live = await openEncrypted(DB_PATH, DB_KEY);
    return await readErasureLog(live);
  } catch (err) {
    if (/no such table/i.test(String(err?.message))) return [];
    console.error(`[restore] reading erasure log failed: ${err.message}`);
    return null;
  } finally {
    await live?.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[restore] ${err.message}`);
  process.exit(1);
});
