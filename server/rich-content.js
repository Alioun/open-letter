import { ValidationError } from "../config/validation.js";
import sanitize from "sanitize-html";

export function sanitizeRich(value) {
  return sanitize(String(value ?? "").slice(0, 120000), {
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

export function preservePlaceholders(original, value) {
  for (const token of String(original || "").match(/\{\{?\w+\}?\}/g) || []) {
    if (!String(value).includes(token))
      throw new ValidationError(`Protected placeholder ${token} is required`);
  }
  return value;
}
