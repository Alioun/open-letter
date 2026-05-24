import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const BACKUP_DIR = process.env.BACKUP_DIR || "/app/backups";
const BACKUP_KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || "48", 10));
const DATABASE_URL = process.env.DATABASE_URL || "";
const BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || "";
const ONE_HOUR = 60 * 60 * 1000;

async function runBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = BACKUP_ENCRYPTION_KEY ? ".dump.enc" : ".dump";
  const file = join(BACKUP_DIR, `backup-${ts}${ext}`);

  try {
    await mkdir(BACKUP_DIR, { recursive: true });

    const dbUrl = new URL(DATABASE_URL);
    const pgArgs = ["pg_dump", "--format=custom"];
    if (dbUrl.hostname) pgArgs.push("--host", dbUrl.hostname);
    if (dbUrl.port) pgArgs.push("--port", dbUrl.port);
    if (dbUrl.username)
      pgArgs.push("--username", decodeURIComponent(dbUrl.username));
    const dbName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ""));
    if (dbName) pgArgs.push(dbName);

    const proc = Bun.spawn(pgArgs, {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(dbUrl.password || ""),
      },
    });

    const stdout = Readable.fromWeb(proc.stdout);
    const out = createWriteStream(file);

    if (BACKUP_ENCRYPTION_KEY) {
      const key = Buffer.from(BACKUP_ENCRYPTION_KEY, "hex");
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-cbc", key, iv);
      out.write(iv);
      await pipeline(stdout, cipher, out);
    } else {
      await pipeline(stdout, out);
    }

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
    try {
      await unlink(file);
    } catch {}
  }
}

async function prune() {
  const files = (await readdir(BACKUP_DIR))
    .filter((f) => f.startsWith("backup-") && (f.endsWith(".dump") || f.endsWith(".dump.enc")))
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

  // Belt-and-suspenders: the outer .catch() ensures a bug inside runBackup
  // (or a Bun internal error) can never produce an unhandled rejection that
  // would crash the server process.
  const safe = () =>
    runBackup().catch((err) => console.error("[backup] unhandled error:", err));

  // First backup 30 s after startup, then every hour
  const initial = setTimeout(safe, 30_000);
  initial.unref?.();

  const interval = setInterval(safe, ONE_HOUR);
  interval.unref?.();

  console.log(
    `[backup] hourly backup scheduled — dir: ${BACKUP_DIR}, keep: ${BACKUP_KEEP}`,
  );
}
