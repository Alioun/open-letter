import { isCampaignTemplate } from "./campaign-templates.js";

export function allocateTemplateId(templates, nextTemplateId) {
  if (!Number.isSafeInteger(nextTemplateId) || nextTemplateId < 1)
    throw new Error(
      "Neue Vorlagen sind erst nach dem Laden der aktuellen Veröffentlichungsdaten möglich. Lade die Daten erneut; dein Entwurf bleibt erhalten.",
    );
  let id = nextTemplateId;
  for (const template of templates) {
    if (!Number.isSafeInteger(template.id) || template.id < 1)
      throw new Error("Die Vorlagen enthalten eine ungültige Kennung.");
    id = Math.max(id, template.id + 1);
  }
  if (!Number.isSafeInteger(id) || id >= Number.MAX_SAFE_INTEGER)
    throw new Error("Für neue Vorlagen ist keine gültige Kennung verfügbar.");
  return id;
}

export function systemTemplateBase(slug, languages) {
  if (isCampaignTemplate({ slug })) return null;
  const suffix = languages.slice(1).find((lang) => slug.endsWith(`.${lang}`));
  return suffix ? slug.slice(0, -suffix.length - 1) : slug;
}

export function systemTemplateSlug(base, language, defaultLanguage) {
  return language === defaultLanguage ? base : `${base}.${language}`;
}

export function createSystemTranslation(
  templates,
  baseSlug,
  language,
  languages,
  nextTemplateId,
) {
  const source = templates.find((t) => t.slug === baseSlug);
  if (
    !source ||
    systemTemplateBase(baseSlug, languages) !== baseSlug ||
    !languages.slice(1).includes(language)
  )
    throw new Error("Ungültige Systemnachricht oder Sprache");
  const slug = systemTemplateSlug(baseSlug, language, languages[0]);
  if (templates.some((t) => t.slug === slug))
    throw new Error("Diese Übersetzung ist bereits vorhanden");
  return {
    ...source,
    id: allocateTemplateId(templates, nextTemplateId),
    slug,
    name: `${source.name} (${language.toUpperCase()})`,
  };
}
