// Active letter's rich page content (JSX). Imported only by the frontend
// (src/App.jsx). Selection mirrors config/letter.config.js via LETTER_CONFIG.
// A letter's content module exports LetterArticle / FaqContent in its default
// language and may export one object per further language, e.g.
// `export const en = { LetterArticle, FaqContent }` (features.multiLanguage).

import * as example from "./letters/example/content.jsx";
import { activeLetterName } from "./active-letter.js";
import { LANG, DEFAULT_LANG } from "./letter.config.js";

const CONTENT = {
  example,
};

const name = activeLetterName();
const active = CONTENT[name] || example;
export function contentFor(lang) {
  const localized = (lang !== DEFAULT_LANG && active[lang]) || {};
  return {
    LetterArticle: localized.LetterArticle || active.LetterArticle,
    FaqContent: localized.FaqContent || active.FaqContent,
  };
}
const localized = contentFor(LANG);

export const LetterArticle = localized.LetterArticle || active.LetterArticle;
export const FaqContent = localized.FaqContent || active.FaqContent;
