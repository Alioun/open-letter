import { UI_DEFAULTS } from "../../config/ui.js";
import { getPath } from "../../config/editable.js";

const labels = {
  "features.successMode": "Erfolgsseite statt laufender Kampagne anzeigen",
  "features.collapsedSections": "Abschnitte zunächst eingeklappt anzeigen",
  "hero.headlineLines": "Haupttitel · Zeilen und Hervorhebungen",
  "hero.counterLabel": "Beschriftung des Unterschriftenzählers",
  "hero.goalLabelPrefix": "Text vor dem Unterschriftenziel",
  "hero.goalMetaLabel": "Beschreibung des Unterschriftenziels",
  "hero.ctaPrimary": "Schaltfläche zum Unterzeichnen",
  "hero.ctaSecondary": "Schaltfläche zum Brief",
  "ui.hero.reached": "Anzeige des erreichten Fortschritts",
  "ui.hero.updated": "Zeitpunkt der letzten Aktualisierung",
  "ui.hero.successCtaFallback":
    "Standard-Schaltfläche zum Treffen auf der Erfolgsseite",
  "ui.hero.successAntragFallback":
    "Standard-Schaltfläche für weitere Informationen",
  navCta: "Schaltfläche zum Unterzeichnen in der Navigation",
  "success.kicker": "Einleitung über der Erfolgsmeldung",
  "success.headline": "Titel der Erfolgsmeldung",
  "success.headlineLines": "Erfolgstitel · Zeilen und Hervorhebungen",
  "success.body": "Text der Erfolgsmeldung",
  "success.antragUrl": "Link zu weiteren Informationen",
  "success.antragLabel": "Schaltfläche zu weiteren Informationen",
  "success.ctaZoom": "Schaltfläche zum Treffen",
  "success.countLabel": "Beschriftung der abschließenden Unterschriftenzahl",
  "sign.headingHtml": "Überschrift des Unterschreiben-Abschnitts",
  "sign.criteria": "Voraussetzungen zum Unterzeichnen · ein Punkt je Zeile",
  "sign.privacyNote": "Datenschutzhinweis beim Unterzeichnen",
  "sign.formTitle": "Titel des Unterschreiben-Formulars",
  "sign.formSubtitle": "Einleitung des Unterschreiben-Formulars",
  "list.headingHtml": "Überschrift der Unterschriftenliste",
  "footer.heading": "Überschrift der Fußzeile",
  "footer.blurb": "Kurzbeschreibung der Kampagne",
  "footer.contactEmail": "Öffentliche Kontaktadresse",
  "legal.disclaimer": "Rechtlicher Hinweis",
  "legal.privacyHtml": "Datenschutzerklärung, geschützte Angaben beibehalten",
  "legal.impressumHtml": "Impressum",
  "brand.name": "Name der Kampagne",
  "brand.wordmark": "Schriftzug im Kopfbereich",
};
const roles = {
  sectionNum: "Abschnittsnummer",
  title: "Titel",
  heading: "Überschrift",
  headingHtml: "Überschrift",
  body: "Beschreibung",
  text: "Text",
  label: "Beschriftung",
  placeholder: "Beispiel im leeren Eingabefeld",
  optionalLabel: "Hinweis auf freiwillige Angaben",
  email: "Kontaktadresse",
  button: "Beschriftung der Schaltfläche",
  ok: "Bestätigungsbutton",
  back: "Zurück-Button",
  sub: "Erklärung",
  note: "Hinweis",
  html: "Formatierter Inhalt",
};
export function copyArea(field) {
  const path = field.path;
  if (/aria|Aria|skipLink/.test(path)) return "accessibility";
  if (/^(legal\.|ui\.privacy\.|ui\.deletedModal\.)/.test(path)) return "legal";
  if (/^ui\.chrome\.|^ui\.sections\./.test(path)) return "nav";
  if (/^ui\.hero\./.test(path)) return "hero";
  if (/^ui\.(signForm|emailModal)\./.test(path)) return "sign";
  if (/^ui\.successModal\./.test(path)) return "confirmation";
  if (/^ui\.(list|time)\./.test(path)) return "list";
  if (/^ui\.(zoomForm|server|stoerer)\./.test(path)) return "zoom";
  if (/^brand\./.test(path)) return "branding";
  return field.group;
}
export function copyLabel(field) {
  if (labels[field.path]) return labels[field.path];
  if (/^nav\.\d+\.label$/.test(field.path))
    return "Navigationspunkt " + (Number(field.path.split(".")[1]) + 1);
  const key = field.path.split(".").at(-1);
  const context = field.path.includes(".occupation.")
    ? "Beruf · "
    : field.path.includes(".kreisverband.")
      ? "Kreisverband · "
      : "";
  if (roles[key]) return context + roles[key];
  const source = getPath({ ui: UI_DEFAULTS }, field.path) ?? field.default;
  if (typeof source === "string" && source.trim()) {
    const text = source
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return 'Text: "' + text.slice(0, 65) + (text.length > 65 ? "…" : "") + '"';
  }
  return field.type === "number"
    ? "Anzahl"
    : field.type === "list"
      ? "Texte · ein Eintrag je Zeile"
      : "Öffentliche Beschriftung";
}
