import { ADMIN_ACTIONS, SIGNER_EDIT_FIELDS } from "../config/admin-actions.js";
import { DEFAULT_LANG } from "../config/letter.config.js";

export const logTime = (value) =>
  new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const actionLabel = (action) => ADMIN_ACTIONS[action] || action;

function shown(field, value) {
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (field === "lang") return (value || DEFAULT_LANG).toUpperCase();
  return value ? `„${value}“` : "leer";
}

// One line per changed field of a "signer.edit" entry: "Name: „alt“ → „neu“".
export function changeLines(detail) {
  const changes = detail?.changes || {};
  const lines = Object.keys(SIGNER_EDIT_FIELDS)
    .filter((field) => field in changes)
    .map(
      (field) =>
        `${SIGNER_EDIT_FIELDS[field]}: ${shown(field, changes[field][0])} → ${shown(field, changes[field][1])}`,
    );
  if ("consentNote" in (detail || {}))
    lines.push(
      detail.consentNote
        ? `Zustimmung liegt vor: ${detail.consentNote}`
        : "Zustimmung liegt vor",
    );
  return lines;
}

// What an entry was about, as far as the log knows it.
export function entrySubject({ action, targetId, count }) {
  const parts = [];
  if (targetId != null) {
    const [area] = action.split(".");
    const noun = {
      signer: "Unterschrift",
      campaign: "Nachricht",
      template: "Vorlage",
      website: "Stand",
      merge: "Vorgang",
    }[area];
    if (noun) parts.push(`${noun} #${targetId}`);
  }
  if (action === "campaign.stop" && count != null)
    parts.push(`${count.toLocaleString("de-DE")} bereits gesendet`);
  else if (count != null && (targetId == null || count !== 1))
    parts.push(
      `${count.toLocaleString("de-DE")} ${count === 1 ? "Eintrag" : "Einträge"}`,
    );
  return parts.join(" · ");
}
