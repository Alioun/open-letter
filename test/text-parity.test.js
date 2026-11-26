import { describe, test, expect } from "bun:test";
import {
  UI_DEFAULTS,
  UI_TRANSLATIONS,
  fillText,
  uiDefaults,
} from "../config/ui.js";
import { DEFAULT_PAGE_COPY, defaultPageCopy } from "../server/pages.js";
import example from "../config/letter.config.js";

// Every leaf as [path, value], so two tables can be compared key by key.
function leaves(node, prefix = "", out = []) {
  for (const [k, v] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, path, out);
    else out.push([path, v]);
  }
  return out;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function expectParity(de, other) {
  const a = new Map(leaves(de));
  const b = new Map(leaves(other));
  expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
  for (const [path, value] of a) {
    expect(typeof b.get(path)).toBe(typeof value);
    if (typeof value === "string") {
      expect({ path, keys: placeholders(b.get(path)) }).toEqual({
        path,
        keys: placeholders(value),
      });
    }
  }
}

describe("per-language text tables", () => {
  for (const lang of Object.keys(UI_TRANSLATIONS)) {
    test(`ui table: ${lang} matches de`, () => {
      expectParity(UI_DEFAULTS, uiDefaults(lang));
    });
    test(`page copy: ${lang} matches de`, () => {
      expectParity(DEFAULT_PAGE_COPY, defaultPageCopy(lang));
    });
  }

  // SIGNING_PAUSED shows this text on the form, on confirmation links and
  // as the answer to a sign-up, whatever the pause is for. Mail being down
  // no longer needs a pause: sign-ups wait in the queue.
  test("the pause message gives no reason for the pause", () => {
    for (const lang of ["de", ...Object.keys(UI_TRANSLATIONS)]) {
      const { pausedMessage } = uiDefaults(lang).signForm;
      expect({ lang, pausedMessage }).toEqual({
        lang,
        pausedMessage: expect.not.stringMatching(
          /mail|versand|zustell|deliver|bestätigung|confirmation|gestört/i,
        ),
      });
    }
  });

  // Shown after a sign-up made while no mail can go out. The sign-up waits
  // for its mail only so long, and the link counts from when the mail goes.
  test("the delayed-mail modal says how long the sign-up waits and how long the link then is valid", () => {
    for (const lang of ["de", ...Object.keys(UI_TRANSLATIONS)]) {
      const hint = fillText(uiDefaults(lang).emailModal.delayedHint, {
        hours: 7,
        waitHours: 99,
      });
      expect({ lang, hint }).toEqual({
        lang,
        hint: expect.stringMatching(/\b7\b.*\b99\b|\b99\b.*\b7\b/),
      });
    }
  });

  test("unknown languages fall back to German", () => {
    expect(uiDefaults("xx")).toBe(UI_DEFAULTS);
    expect(uiDefaults("de")).toBe(UI_DEFAULTS);
    expect(defaultPageCopy("xx")).toBe(DEFAULT_PAGE_COPY);
  });
});

// The example letter is in English and has one language, so every interface
// string it does not set itself is the German default.
describe("the English example letter", () => {
  const english = uiDefaults("en");
  const shown = [
    ["signForm", "emailDelayed"],
    ["signForm", "pausedTitle"],
    ["signForm", "pausedMessage"],
    ["emailModal", "delayedTitle"],
    ["emailModal", "delayedSent"],
    ["emailModal", "delayedHint"],
  ];

  test("says in English that mail is delayed and that signing is paused", () => {
    expect(example.brand.lang).toBe("en");
    for (const [group, key] of shown) {
      expect({ key, text: example.ui[group][key] }).toEqual({
        key,
        text: english[group][key],
      });
      expect(example.ui[group][key]).not.toBe(UI_DEFAULTS[group][key]);
    }
  });

  test("its delayed-mail modal states both periods", () => {
    expect(
      fillText(example.ui.emailModal.delayedHint, { hours: 7, waitHours: 99 }),
    ).toMatch(/\b7 hours\b.*\b99 hours\b/);
  });
});
