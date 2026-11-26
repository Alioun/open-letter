import { ADMIN_ACTIONS, SIGNER_EDIT_FIELDS } from "../config/admin-actions.js";
import { DEFAULT_LANG } from "../config/letter.config.js";
import { copyLabel } from "./publishing/copy-labels.js";

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

// What a start of the server did to a text ("website.upgrade"), by the kind
// of change server/publications.js records. Texts that only follow their
// changed default share one line, except the privacy policy.
const POLICY = "legal.privacyHtml";
const UPGRADES = {
  default: "Der unbearbeitete Text folgt seinem geänderten Standard.",
  policy: "Auf den Stand des Briefs gebracht. Bitte prüfen.",
  placeholder: "Ein fehlender Platzhalter wurde ergänzt. Bitte prüfen.",
  replaced:
    "Der gespeicherte Text war nicht mehr gültig. An seiner Stelle steht der Standardtext.",
  review:
    "Der Standardtext hat sich geändert. Der bearbeitete Text ist unverändert. Bitte prüfen.",
  wording:
    "Ein Satz über die Angaben des Formulars enthält eigene Formulierungen und ist unverändert. Bitte prüfen, ob er noch stimmt.",
  length:
    "Der Text müsste an das Formular angepasst werden, wäre dann aber länger als 120.000 Zeichen. Er ist unverändert. Bitte kürzen und selbst anpassen.",
};

function upgradeLines(texts) {
  const summed = (text) => text.change === "default" && text.path !== POLICY;
  const followed = texts.filter(summed).length;
  return [
    ...texts
      .filter((text) => !summed(text) && UPGRADES[text.change])
      .map(
        ({ lang, path, change, before }) =>
          `${path === POLICY ? "Datenschutzerklärung" : copyLabel({ path })} (${lang.toUpperCase()}): ${UPGRADES[change]}${before ? ` Vorher: „${before}“` : ""}`,
      ),
    ...(followed
      ? [
          followed === 1
            ? "1 unbearbeiteter Text folgt seinem geänderten Standard."
            : `${followed} unbearbeitete Texte folgen ihrem geänderten Standard.`,
        ]
      : []),
  ];
}

// One line per changed field of a "signer.edit" entry: "Name: „alt“ → „neu“",
// and the lines of a "website.upgrade" entry.
export function changeLines(detail) {
  if (Array.isArray(detail?.texts)) return upgradeLines(detail.texts);
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
