// Active open-letter configuration (plain data, no JSX).
//
// One deployment serves one letter. Pick which one with the LETTER_CONFIG env
// var (default "gehaltsdeckel"). Add a new letter by copying
// config/letters/gehaltsdeckel/ and registering it in the maps below.
//
// Imported by both the server (server/*, db/*, scripts/*) and the client bundle
// (src/*). Rich page content (letter body, FAQ) lives in ./content.jsx.

import gehaltsdeckel from "./letters/gehaltsdeckel/index.js";
import example from "./letters/example/index.js";
import { activeLetterName, activePageLang } from "./active-letter.js";
import {
  letterLanguages,
  defaultLanguage,
  normalizeLang,
  localizeConfig,
} from "./i18n.js";

const LETTERS = {
  gehaltsdeckel,
  example,
};

export const LETTER_NAME = activeLetterName();

const letter = LETTERS[LETTER_NAME] || gehaltsdeckel;
// The letter as written, before its `ui` block is merged and before any admin
// override reaches it. Every further language is built from this copy.
const RAW = structuredClone(letter);

// Languages this letter is served in (one unless features.multiLanguage).
export const LANGUAGES = letterLanguages(RAW);
export const DEFAULT_LANG = defaultLanguage(RAW);
// The page language: from <html lang> in the browser, the default on the
// server (which picks per request via configFor).
export const LANG = normalizeLang(RAW, activePageLang());

// The default language keeps the letter object itself (admin overrides are
// written onto it on the server); another page language gets its own copy.
let config;
if (LANG === DEFAULT_LANG) {
  config = Object.assign(letter, localizeConfig(letter, LANG));
} else {
  config = localizeConfig(structuredClone(RAW), LANG);
}

const byLang = { [LANG]: config };

// The letter config in one of its languages. Languages other than the page's
// are separate copies, so admin overrides on the default never reach them.
export function configFor(lang) {
  const l = normalizeLang(RAW, lang);
  return (byLang[l] ??= localizeConfig(structuredClone(RAW), l));
}

export default config;
