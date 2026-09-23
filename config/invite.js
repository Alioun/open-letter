// Personal invite links (features.inviteLinks): texts and the stats threshold.
// Letters override any key in their `invite` block; omitted keys use these.
//
// Placeholders: {firstName} (only when the inviter opted in), {title} (the
// letter's title), {url} (the invite link, in shareMessage only).
const DEFAULTS = {
  // Sign-form checkbox, off by default: shows the first name in the invite.
  optInLabel:
    "Meinen Vornamen auf meinem persönlichen Einladungslink zeigen (sonst bleibt die Einladung anonym)",
  modalText: "{firstName} lädt dich ein, auch den Brief „{title}“ zu unterschreiben.",
  modalTextAnonymous: "Du wurdest eingeladen, den Brief „{title}“ zu unterschreiben.",
  modalButton: "Zum Brief",
  successHeading: "Hier ist dein persönlicher Einladungslink:",
  successNote:
    "Teile ihn mit Menschen, die mitzeichnen könnten. Deinen privaten Statistik-Link schicken wir dir per E-Mail.",
  shareMessage:
    "Ich habe den offenen Brief „{title}“ unterschrieben. Unterschreib du auch: {url}",
  copyLabel: "Link kopieren",
  copiedLabel: "Kopiert",
  moreLabel: "Mehr …",
  statsHeading: "Deine Einladungen",
  // "{count}" people signed via the link; below the threshold the page says
  // statsBelow instead, so the count can't reveal that one particular person
  // signed.
  statsCount: "{count} Menschen haben über deinen Link unterschrieben.",
  statsBelow: "Weniger als {threshold} Menschen haben bisher über deinen Link unterschrieben.",
  statsInvalid: "Dieser Statistik-Link ist ungültig oder wurde durch einen neueren ersetzt.",
  statsThreshold: 3,
};

export function resolveInvite(cfg) {
  const title = cfg.invite?.title || cfg.meta?.siteName || cfg.meta?.title || "";
  return { ...DEFAULTS, title, ...(cfg.invite || {}) };
}

// Fill {key} placeholders. Values are plain text; callers render them as text.
export function fillInvite(text, values) {
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) =>
    k in values ? String(values[k] ?? "") : m,
  );
}

// What the stats page may show: the exact count only from the threshold up.
export function thresholdCount(count, threshold) {
  return count >= threshold ? { count } : { below: threshold };
}
