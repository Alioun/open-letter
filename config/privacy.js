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
  // How long after the last mail carrying it an unsubscribe link may still
  // show, edit or delete data. Opting out works with a link of any age.
  settingsLinkDays: 90,
  // A queued transactional mail is dropped after this long, and a mail job
  // that failed for good is deleted this long after it failed.
  emailJobRetentionHours: 24,
  // Treffen registrations are deleted this many days after the event.
  treffenRetentionDays: 14,
  // Longest any signature or Treffen registration is kept, counted from when
  // it was made — even if the campaign is still running.
  signerRetentionYears: 3,
};

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
  return {
    ...merged,
    confirmationLinkMs: merged.confirmationLinkHours * HOUR,
    settingsLinkMs: merged.settingsLinkDays * DAY,
    emailJobRetentionS: Math.round(merged.emailJobRetentionHours * 3600),
    treffenRetentionMs: merged.treffenRetentionDays * DAY,
  };
}
