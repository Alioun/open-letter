import { describe, test, expect, beforeEach } from "bun:test";
import { resetDb } from "./helpers.js";
import cfg from "../config/letter.config.js";
import {
  editableFields,
  applyOverrides,
  cleanValue,
  getPath,
} from "../config/editable.js";
import { UI_DEFAULTS, fillText, deepMerge } from "../config/ui.js";
import { pageCopy } from "../server/pages.js";
import * as q from "../server/db.js";

beforeEach(resetDb);

const pristine = () => structuredClone(cfg);
const fieldsFor = (c) => editableFields(c, pageCopy(c));
const field = (fields, path) => fields.find((f) => f.path === path);

describe("editable fields", () => {
  test("cover the mode toggles, config texts, pages and every ui default", () => {
    const fields = fieldsFor(pristine());
    const paths = new Set(fields.map((f) => f.path));
    for (const p of [
      "features.successMode",
      "features.collapsedSections",
      "hero.ctaPrimary",
      "sign.criteria",
      "nav.0.label",
      "pages.confirmSignature.button",
      "ui.stoerer.showFrom",
      "ui.settings.save",
      "ui.errors.tooMany",
    ]) {
      expect(paths.has(p)).toBe(true);
    }
    // Structural or privacy-relevant keys stay out.
    for (const p of ["features.inviteLinks", "privacy.signerRetentionYears", "invite.statsMode", "email.provider"]) {
      expect(paths.has(p)).toBe(false);
    }
    expect(field(fields, "ui.stoerer.showFrom").type).toBe("number");
    expect(field(fields, "sign.headingHtml").type).toBe("html");
  });

  test("overrides apply and reset to the deployed value", () => {
    const base = pristine();
    const fields = fieldsFor(base);
    const target = pristine();
    applyOverrides(target, fields, {
      "hero.ctaPrimary": "Los!",
      "features.successMode": true,
      "nav.1.label": "Mitmachen",
    });
    expect(target.hero.ctaPrimary).toBe("Los!");
    expect(target.features.successMode).toBe(true);
    expect(target.nav[1].label).toBe("Mitmachen");
    expect(target.nav[1].id).toBe(base.nav[1].id);

    applyOverrides(target, fields, {});
    expect(target.hero.ctaPrimary).toBe(base.hero.ctaPrimary);
    expect(target.features.successMode).toBe(base.features.successMode);
    expect(target.nav[1].label).toBe(base.nav[1].label);
  });

  test("values are checked against their type", () => {
    const fields = fieldsFor(pristine());
    const clean = (path, v) => cleanValue(field(fields, path), v);
    expect(clean("features.successMode", true)).toBe(true);
    expect(() => clean("features.successMode", "yes")).toThrow();
    expect(clean("features.collapsedSections", ["faq", "faq", "liste"])).toEqual(["faq", "liste"]);
    expect(() => clean("features.collapsedSections", ["hero"])).toThrow();
    expect(clean("sign.criteria", [" a ", "", "b"])).toEqual(["a", "b"]);
    expect(clean("ui.stoerer.showFrom", "2500")).toBe(2500);
    expect(() => clean("ui.stoerer.showFrom", -1)).toThrow();
    expect(() => clean("success.antragUrl", "javascript:alert(1)")).toThrow();
    expect(() => clean("hero.headlineLines", [{ text: "x", style: "a b" }])).toThrow();
    expect(() => clean("hero.ctaPrimary", "x".repeat(6000))).toThrow();
  });
});

describe("ui defaults", () => {
  test("are merged into the config and fill placeholders", () => {
    expect(getPath(cfg, "ui.settings.save")).toBe(UI_DEFAULTS.settings.save);
    expect(fillText("{a} und {b} {c}", { a: 1, b: "x" })).toBe("1 und x {c}");
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1] }, { a: { b: 3 }, l: [2] })).toEqual({
      a: { b: 3, c: 2 },
      l: [2],
    });
  });
});

describe("override storage", () => {
  test("stores JSON per path and deletes on null", async () => {
    await q.setCopyOverrides({ "hero.ctaPrimary": "Los!", "sign.criteria": ["a"] });
    expect(await q.getCopyOverrides()).toEqual({
      "hero.ctaPrimary": "Los!",
      "sign.criteria": ["a"],
    });
    await q.setCopyOverrides({ "hero.ctaPrimary": null });
    expect(await q.getCopyOverrides()).toEqual({ "sign.criteria": ["a"] });
  });
});
