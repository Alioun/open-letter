import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
const BACKUP_KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || "48", 10));
const DATABASE_URL = process.env.DATABASE_URL || "";
const ONE_HOUR = 60 * 60 * 1000;

async function runBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(BACKUP_DIR, `backup-${ts}.dump`);

  try {
    await mkdir(BACKUP_DIR, { recursive: true });

    const proc = Bun.spawn(["pg_dump", "--format=custom", DATABASE_URL], {
      stdout: Bun.file(file),
      stderr: "pipe",
    });

    const [exitCode, errText] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error(`pg_dump exited ${exitCode}: ${errText.trim()}`);
    }

    console.log(`[backup] saved ${file}`);
    await prune();
  } catch (err) {
    console.error(`[backup] failed: ${err.message}`);
    // Remove empty/partial file if it was created
    try {
      await unlink(file);
    } catch {}
  }
}

async function prune() {
  const files = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith("backup-") && f.endsWith(".dump"))
    .sort()
    .reverse();

  for (const f of files.slice(BACKUP_KEEP)) {
    await unlink(join(BACKUP_DIR, f));
    console.log(`[backup] pruned ${f}`);
  }
}

export function startBackupSchedule() {
  if (!DATABASE_URL) {
    console.warn("[backup] DATABASE_URL not set — backups disabled");
    return;
  }

  // First backup 30 s after startup, then every hour
  const initial = setTimeout(runBackup, 30_000);
  initial.unref?.();

  const interval = setInterval(runBackup, ONE_HOUR);
  interval.unref?.();

  console.log(
    `[backup] hourly backup scheduled — dir: ${BACKUP_DIR}, keep: ${BACKUP_KEEP}`,
  );
}
