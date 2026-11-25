// What an uptime monitor is told about the things that need a person: mail
// that cannot go out, mail that was given up on, and backups that stopped.
//
// `checks` is public, so it holds one word per check and nothing a stranger
// could use: no counts, no addresses, no paths, no error text. `details` goes
// only to a caller with the health token.

// The backup job runs hourly; two missed runs in a row are not a hiccup.
export const BACKUP_STALE_HOURS = 3;
const HOUR = 3600_000;

function backupCheck(backup, uptimeMs, now) {
  const { lastSuccessAt, lastErrorAt } = backup;
  if (lastErrorAt && (!lastSuccessAt || lastErrorAt > lastSuccessAt))
    return "failed";
  // A fresh install has had no chance yet.
  const since = lastSuccessAt ? now - Date.parse(lastSuccessAt) : uptimeMs;
  return since > BACKUP_STALE_HOURS * HOUR ? "stale" : "ok";
}

export function operationsHealth({
  db,
  jobs,
  mail,
  backup,
  uptimeMs,
  now = Date.now(),
}) {
  const checks = {
    app: db && jobs.ready ? "ok" : "down",
    mail: mail.ready ? "ok" : "not-ready",
    mailQueue: !mail.queue.available
      ? "unknown"
      : mail.queue.failed > 0
        ? "failed"
        : "ok",
    backup: backupCheck(backup, uptimeMs, now),
  };
  return {
    ok: Object.values(checks).every((state) => state === "ok"),
    checks,
    details: {
      failedMails: mail.queue.failed,
      queuedMails: mail.queue.queued,
      lastMailAcceptedAt: mail.lastSuccess,
      lastBackupAt: backup.lastSuccessAt,
      lastBackupAgeHours: backup.lastSuccessAt
        ? Math.round(((now - Date.parse(backup.lastSuccessAt)) / HOUR) * 10) /
          10
        : null,
      lastBackupFailedAt: backup.lastErrorAt,
    },
  };
}
