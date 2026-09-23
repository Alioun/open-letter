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
import { activeLetterName } from "./active-letter.js";
import { UI_DEFAULTS, deepMerge } from "./ui.js";

const LETTERS = {
  gehaltsdeckel,
  example,
};

export const LETTER_NAME = activeLetterName();

const config = LETTERS[LETTER_NAME] || gehaltsdeckel;
// Interface texts: the letter's `ui` block over the defaults.
config.ui = deepMerge(UI_DEFAULTS, config.ui || {});

export default config;
