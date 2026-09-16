// Retention periods and link lifetimes, per letter (`cfg.privacy`). Read by the
// server, which enforces them, and by the privacy policy, which states them —
// so the text can't drift from what the code does.
//
// Every value falls back to the default below, so a letter only lists what it
// changes. Invalid values (not a positive number) throw at startup.

export const PRIVACY_DEFAULTS = {
  // Sign-up, Treffen and deletion confirmation links stay valid this long.
  // Unconfirmed sign-ups are deleted once their link has expired.
  confirmationLinkHours: 24,
  // How long after the last mail carrying it a signer's unsubscribe link may
  // still show, edit or delete data. Opting out works with a link of any age.
  // Treffen links have no such limit: they work while the registration exists.
  settingsLinkDays: 90,
  // A queued transactional mail is dropped after this long, and a mail job
  // that failed for good is deleted this long after it failed.
  emailJobRetentionHours: 24,
  // Treffen registrations are deleted this many days after the event.
  treffenRetentionDays: 14,
  // Longest any signature or Treffen registration is kept, counted from when
  // it was made — even if the campaign is still running.
  signerRetentionYears: 3,
  // Hourly backups are kept this many hours (BACKUP_KEEP overrides it per
  // deployment, with a startup warning, since the policy quotes this value).
  backupRetentionHours: 48,
  // Erasures and opt-outs are logged (as an HMAC of the address) for this long,
  // so restoring a backup can re-apply them. Must cover backupRetentionHours.
  erasureLogDays: 7,
  // Campaign and Treffen mailings log which address got the mail when, so an
  // interrupted send resumes without skipping or repeating anyone. Entries are
  // deleted this many days after sending, and an aborted campaign can only be
  // retried within that window (after it the log that prevents repeats is gone).
  deliveryLogDays: 30,
};

// Backup retention in effect: BACKUP_KEEP from the environment when set,
// otherwise the letter's privacy.backupRetentionHours. `envValue` is passed in
// because this module is also bundled for the browser.
export function backupKeepHours(privacy, envValue) {
  const fromEnv = parseInt(envValue ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv >= 1
    ? fromEnv
    : privacy.backupRetentionHours;
}

// The cutoff for signerRetentionYears as of `now`: everything created before
// it is due for deletion. Calendar years, so leap days don't shift it.
export function retentionCutoff(privacy, now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - privacy.signerRetentionYears);
  return cutoff;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function resolvePrivacy(cfg) {
  const merged = { ...PRIVACY_DEFAULTS, ...(cfg?.privacy || {}) };
  for (const [key, value] of Object.entries(merged)) {
    if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) {
      throw new Error(
        `config privacy.${key} must be a positive number, got ${JSON.stringify(value)}`,
      );
    }
  }
  // setUTCFullYear truncates, so a fractional value would silently keep data
  // longer than the period the policy quotes.
  if (!Number.isInteger(merged.signerRetentionYears)) {
    throw new Error(
      `config privacy.signerRetentionYears must be a whole number of years, got ${merged.signerRetentionYears}`,
    );
  }
  if (merged.erasureLogDays * 24 < merged.backupRetentionHours) {
    throw new Error(
      `config privacy.erasureLogDays (${merged.erasureLogDays}) must cover privacy.backupRetentionHours (${merged.backupRetentionHours}h), or a restore could bring back erased data`,
    );
  }
  // The privacy policy has to state how long analytics data is kept.
  const analytics = cfg?.meta?.analytics;
  if (analytics?.src) {
    const months = analytics.retentionMonths;
    if (!(typeof months === "number" && Number.isFinite(months) && months > 0)) {
      throw new Error(
        "config meta.analytics.retentionMonths must be a positive number when analytics is enabled",
      );
    }
  }
  return {
    ...merged,
    confirmationLinkMs: merged.confirmationLinkHours * HOUR,
    settingsLinkMs: merged.settingsLinkDays * DAY,
    emailJobRetentionS: Math.round(merged.emailJobRetentionHours * 3600),
    treffenRetentionMs: merged.treffenRetentionDays * DAY,
    erasureLogMs: merged.erasureLogDays * DAY,
    deliveryLogMs: merged.deliveryLogDays * DAY,
  };
}
