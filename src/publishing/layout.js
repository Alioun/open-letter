import { anchorLayout } from "../../config/publication.js";

export function updateLayout(document, layout, duplicate) {
  document.layout = anchorLayout(layout);
  if (!duplicate) return;
  for (const locale of Object.values(document.locales)) {
    const content = locale.blocks[duplicate.sourceId];
    if (content) locale.blocks[duplicate.targetId] = structuredClone(content);
  }
}
