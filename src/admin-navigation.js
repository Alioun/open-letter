// [id, nav label, page title]. The id is the URL hash, so bookmarks of
// /admin#<id> keep working when a label changes.
const AREAS = [
  ["overview", "Übersicht", "Übersicht"],
  ["copy", "Website", "Website"],
  ["templates", "Vorlagen", "E-Mail-Vorlagen"],
  ["campaigns", "Versand", "Versand"],
  ["signatures", "Unterschriften", "Unterschriften verwalten"],
  ["signers", "Empfänger auswählen", "Empfänger auswählen"],
  ["zoom", "Zoom", "Zoom-Termin"],
  ["settings", "Einstellungen", "Einstellungen"],
];

export const ADMIN_AREAS = AREAS.map(([id]) => id);

// The Zoom area stays even when the letter's public meeting sign-up is off,
// so the team can prepare date, link and mails before switching it on.
export function adminAreas() {
  return AREAS.map(([id, label, title]) => ({ id, label, title }));
}

export const SETTINGS_SECTIONS = [
  ["settings-email-heading", "E-Mail"],
  ["statistics-heading", "Statistik"],
  ["settings-general-heading", "Ziele & Verwaltung"],
  ["sessions-heading", "Anmeldung"],
  ["admin-log-heading", "Protokoll"],
];

export function adminAreaFromHash(hash = "", areas = ADMIN_AREAS) {
  const fragment = hash.replace(/^#/, "");
  if (SETTINGS_SECTIONS.some(([id]) => id === fragment)) return "settings";
  return areas.includes(fragment) ? fragment : "overview";
}

export function adminDocumentTitle(title) {
  return `${title} · Verwaltung`;
}
