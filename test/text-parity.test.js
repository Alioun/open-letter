import { describe, test, expect } from "bun:test";
import { UI_DEFAULTS, UI_TRANSLATIONS, uiDefaults } from "../config/ui.js";
import { DEFAULT_PAGE_COPY, defaultPageCopy } from "../server/pages.js";

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

  test("unknown languages fall back to German", () => {
    expect(uiDefaults("xx")).toBe(UI_DEFAULTS);
    expect(uiDefaults("de")).toBe(UI_DEFAULTS);
    expect(defaultPageCopy("xx")).toBe(DEFAULT_PAGE_COPY);
  });
});
