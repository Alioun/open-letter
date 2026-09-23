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
  // How exact the private stats page is. Every step the inviter can see is a
  // chance to tell that one particular person signed, so coarser is safer:
  //   "ranges"    : "{min}–{max}" between the statsRanges bounds (default)
  //   "threshold" : "fewer than {threshold}", then the exact number
  //   "exact"     : always the exact number
  statsMode: "ranges",
  // Lower bounds of the ranges (ascending). Below the first: statsBelow; from
  // the last on: statsAtLeast.
  statsRanges: [3, 5, 10, 25, 50, 100, 250, 500, 1000],
  statsThreshold: 3,
  statsCount: "{count} Menschen haben über deinen Link unterschrieben.",
  statsBelow: "Weniger als {threshold} Menschen haben bisher über deinen Link unterschrieben.",
  statsRange: "{min} bis {max} Menschen haben über deinen Link unterschrieben.",
  statsAtLeast: "Mindestens {min} Menschen haben über deinen Link unterschrieben.",
  statsInvalid: "Dieser Statistik-Link ist ungültig oder wurde durch einen neueren ersetzt.",
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

// What the stats page may show for `count`, per the letter's statsMode:
// { count } | { below } | { min, max } | { min } (at least).
export function statsDisplay(count, invite) {
  const mode = invite.statsMode;
  if (mode === "exact") return { count };
  if (mode === "threshold") {
    return count >= invite.statsThreshold
      ? { count }
      : { below: invite.statsThreshold };
  }
  const bounds = [...invite.statsRanges].sort((a, b) => a - b);
  if (!bounds.length || count < bounds[0]) return { below: bounds[0] ?? 1 };
  for (let i = bounds.length - 1; i >= 0; i--) {
    if (count >= bounds[i]) {
      return i === bounds.length - 1
        ? { min: bounds[i] }
        : { min: bounds[i], max: bounds[i + 1] - 1 };
    }
  }
}
