import { systemTemplateBase } from "./template-localization.js";

export const TEMPLATE_LINKS = [
  ["{{confirmUrl}}", "Anmeldung bestätigen"],
  ["{{deleteUrl}}", "Löschung bestätigen"],
  ["{{unsubscribeUrl}}", "Abmelden und eigene Angaben verwalten"],
  ["{{inviteUrl}}", "Persönlicher Einladungslink"],
  ["{{statsUrl}}", "Persönliche Einladungsstatistik"],
  ["{{zoomJaUrl}}", "Für das Treffen anmelden"],
  ["{{zoomJaDelegiertUrl}}", "Als Delegierte*r für das Treffen anmelden"],
  ["{{zoomLink}}", "Am Online-Treffen teilnehmen"],
];

export const TEMPLATE_VALUES = [
  ["{{name}}", "Vollständiger Name"],
  ["{{firstName}}", "Vorname"],
  ["{{linkHours}}", "Gültigkeit des Bestätigungslinks in Stunden"],
  ["{{signerCount}}", "Anzahl der Unterzeichner"],
  ["{{eventLabel}}", "Name des Treffens"],
  ["{{eventWhen}}", "Datum und Uhrzeit des Treffens"],
];

export function templateTokenLabel(token) {
  const known = [...TEMPLATE_LINKS, ...TEMPLATE_VALUES].find(
    ([value]) => value === token,
  );
  if (known) return known[1];
  const section = /^\{\{([#/])(\w+)\}\}$/.exec(token);
  if (section)
    return `${section[1] === "#" ? "Anfang" : "Ende"} des bedingten Abschnitts "${templateTokenLabel(`{{${section[2]}}}`)}"`;
  return token;
}

export function templateTokenContent(token) {
  const link = TEMPLATE_LINKS.find(([value]) => value === token);
  if (link)
    return {
      type: "text",
      text: link[1],
      marks: [{ type: "link", attrs: { href: token } }],
    };
  if (TEMPLATE_VALUES.some(([value]) => value === token))
    return { type: "text", text: token };
  return null;
}

export function appendTemplateToken(html, token) {
  if (html.includes(token)) return html;
  const link = TEMPLATE_LINKS.find(([value]) => value === token);
  if (link) return `${html}<p><a href="${token}">${link[1]}</a></p>`;
  if (TEMPLATE_VALUES.some(([value]) => value === token))
    return `${html}<p>${templateTokenLabel(token)}: ${token}</p>`;
  return html;
}

export function protectedTemplateTokens(template) {
  return [
    ...new Set(
      String(template?.html_body || "").match(
        /\{\{(?:[#/]\w+|confirmUrl|deleteUrl|unsubscribeUrl|linkHours|inviteUrl|statsUrl|zoomJaUrl|zoomJaDelegiertUrl|zoomLink)\}\}/g,
      ) || [],
    ),
  ];
}

export function templatePlaceholderIssues(
  templates,
  published = [],
  languages = [],
) {
  return templates.flatMap((template) => {
    const original = published.find((t) => t.id === template.id);
    const baseSlug = systemTemplateBase(template.slug, languages);
    const source =
      baseSlug &&
      baseSlug !== template.slug &&
      templates.find((t) => t.slug === baseSlug);
    const required = new Set([
      ...protectedTemplateTokens(original),
      ...protectedTemplateTokens(source),
    ]);
    if (template.slug.startsWith("newsletter-"))
      required.add("{{unsubscribeUrl}}");
    const missing = [...required].filter(
      (token) => !template.html_body.includes(token),
    );
    return missing.length
      ? [{ id: template.id, name: template.name, missing }]
      : [];
  });
}
