import cfg from "../config/letter.config.js";
import { letterTemplates } from "../config/i18n.js";
let rows = Object.entries(letterTemplates(cfg)).map(([slug, template], i) => ({
  id: -(i + 1),
  slug,
  ...template,
}));
export function installTemplates(templates) {
  rows = structuredClone(templates);
}
export function memoryTemplate(id) {
  return rows.find((t) => t.id === Number(id)) || null;
}
export function memoryTemplateBySlug(slug) {
  return rows.find((t) => t.slug === slug) || null;
}
export function memoryTemplates() {
  return rows;
}
