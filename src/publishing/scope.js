import { publicationChanges } from "./reconcile.js";
import { LANGUAGES, DEFAULT_LANG } from "../../config/letter.config.js";

export function publicationScope(before, after) {
  const changes = publicationChanges(before, after);
  const languages = Object.keys(after.locales || before.locales || {});
  const groups = new Set();
  const emailChanges = new Map();
  let website = false;
  let emails = false;
  for (const { path } of changes) {
    if (path[0] === "templates") {
      emails = true;
      const previous = before.templates?.find(
        (template) => String(template.id) === path[1],
      );
      const current = after.templates?.find(
        (template) => String(template.id) === path[1],
      );
      const template = current || previous;
      const suffix = template?.slug?.split(".").at(-1);
      const language = (languages.length ? languages : LANGUAGES).includes(
        suffix,
      )
        ? suffix
        : DEFAULT_LANG;
      const name = template?.name || `Vorlage #${path[1]}`;
      const languageLabel = ` (${language.toUpperCase()})`;
      const key = `E-Mail · ${name.endsWith(languageLabel) ? name : name + languageLabel}`;
      const fields = emailChanges.get(key) || new Set();
      fields.add(
        path.length === 2
          ? current
            ? "neu angelegt"
            : "entfernt"
          : {
              subject: "Betreff",
              html_body: "Nachricht",
              name: "Name",
              slug: "Sprache / Kennung",
            }[path[2]] || "Einstellungen",
      );
      emailChanges.set(key, fields);
    } else {
      website = true;
      if (path[0] === "locales")
        groups.add(
          `Website · ${path[2] === "copy" ? "Texte" : "Abschnitte"} (${path[1].toUpperCase()})`,
        );
      else if (path[0] === "metadata")
        groups.add(
          `Website · Suchmaschinen & Teilen (${path[1].toUpperCase()})`,
        );
      else
        groups.add(
          `Website · ${{ layout: "Layout", appearance: "Design & CSS", assets: "Bilder" }[path[0]] || "Inhalte"}`,
        );
    }
  }
  for (const [template, fields] of emailChanges)
    groups.add(`${template} · ${[...fields].join(", ")}`);
  return {
    groups: [...groups],
    label:
      website && emails
        ? "Website & E-Mails veröffentlichen"
        : website
          ? "Website veröffentlichen"
          : emails
            ? "E-Mails veröffentlichen"
            : "Speichern & veröffentlichen",
  };
}
