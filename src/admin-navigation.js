export const ADMIN_AREAS = [
  "copy",
  "templates",
  "campaigns",
  "signers",
  "zoom",
  "settings",
];

export const SETTINGS_SECTIONS = [
  ["settings-email-heading", "E-Mail"],
  ["statistics-heading", "Statistik"],
  ["settings-general-heading", "Ziele & Verwaltung"],
];

export function adminAreaFromHash(hash = "") {
  const fragment = hash.replace(/^#/, "");
  if (SETTINGS_SECTIONS.some(([id]) => id === fragment)) return "settings";
  return ADMIN_AREAS.includes(fragment) ? fragment : "copy";
}
