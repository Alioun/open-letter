import { ValidationError } from "../config/validation.js";
import sanitize from "sanitize-html";

// How long a formatted text may be, in characters.
export const RICH_LIMIT = 120000;

// HTML as a publication stores it. Sanitizing its own result again changes
// nothing.
export function sanitizeHtml(value) {
  return sanitize(String(value ?? ""), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h2",
      "h3",
      "h4",
      "h5",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "span",
      "code",
      "article",
      "div",
      "aside",
      "details",
      "summary",
      "footer",
    ],
    allowedAttributes: { a: ["href", "title", "rel"], "*": ["class", "id"] },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: "noopener noreferrer" },
      }),
    },
  });
}

// The same for a text of unknown length: what lies beyond the limit is cut
// off.
export const sanitizeRich = (value) =>
  sanitizeHtml(String(value ?? "").slice(0, RICH_LIMIT));

// The placeholders of `original` that `value` lacks.
export function missingPlaceholders(original, value) {
  return (String(original || "").match(/\{\{?\w+\}?\}/g) || []).filter(
    (token) => !String(value).includes(token),
  );
}

export function preservePlaceholders(original, value) {
  for (const token of missingPlaceholders(original, value))
    throw new ValidationError(`Protected placeholder ${token} is required`);
  return value;
}
