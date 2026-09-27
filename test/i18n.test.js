import { describe, test, expect } from "bun:test";
import {
  multiLanguage,
  letterLanguages,
  defaultLanguage,
  normalizeLang,
  langPrefix,
  localizeConfig,
  requestLang,
} from "../config/i18n.js";
import { UI_DEFAULTS, uiDefaults } from "../config/ui.js";
import {
  renderIndexHtml,
  languageUrl,
  languageAlternates,
} from "../config/html.js";
import { editableFields } from "../config/editable.js";

const single = {
  brand: { lang: "de" },
  languages: ["de", "en"],
  i18n: { en: { hero: { ctaPrimary: "Sign" } } },
  meta: { title: "T", description: "D", canonicalUrl: "https://example.org/" },
  hero: { ctaPrimary: "Unterschreiben", headlineLines: ["a", "b"] },
  ui: { chrome: { impressum: "Impressum (Brief)" } },
};
const multi = {
  ...single,
  features: { multiLanguage: true },
  i18n: {
    en: {
      hero: { headlineLines: ["x"] },
      ui: { chrome: { datenschutz: "Privacy (letter)" } },
    },
  },
};
const req = (url, headers = {}) => new Request(url, { headers });

describe("language list", () => {
  test("flag off: one language, brand.lang, `languages` ignored", () => {
    expect(multiLanguage(single)).toBe(false);
    expect(letterLanguages(single)).toEqual(["de"]);
    expect(defaultLanguage({ brand: { lang: "en" } })).toBe("en");
    expect(letterLanguages({})).toEqual(["de"]);
  });

  test("flag on: `languages`, first is the default", () => {
    expect(letterLanguages(multi)).toEqual(["de", "en"]);
    expect(defaultLanguage(multi)).toBe("de");
    expect(
      letterLanguages({ ...multi, languages: ["EN", "de", "en"] }),
    ).toEqual(["en", "de"]);
    expect(letterLanguages({ ...multi, languages: [] })).toEqual(["de"]);
  });

  test("normalizeLang and langPrefix", () => {
    expect(normalizeLang(multi, "en")).toBe("en");
    expect(normalizeLang(multi, "EN")).toBe("en");
    expect(normalizeLang(multi, "fr")).toBe("de");
    expect(normalizeLang(multi, null)).toBe("de");
    expect(normalizeLang(single, "en")).toBe("de");
    expect(langPrefix(multi, "de")).toBe("");
    expect(langPrefix(multi, "en")).toBe("/en");
    expect(langPrefix(multi, "fr")).toBe("");
    expect(langPrefix(single, "en")).toBe("");
  });
});

describe("request language (X-Lang)", () => {
  test("header or ?lang=, validated, default otherwise", () => {
    const u = "https://example.org/api/boot";
    expect(requestLang(multi, req(u, { "X-Lang": "en" }))).toBe("en");
    expect(requestLang(multi, req(`${u}?lang=en`))).toBe("en");
    expect(requestLang(multi, req(u, { "X-Lang": "fr" }))).toBe("de");
    expect(requestLang(multi, req(u))).toBe("de");
    expect(requestLang(single, req(u, { "X-Lang": "en" }))).toBe("de");
  });
});

describe("config per language", () => {
  test("flag off: letter ui over the German table, i18n ignored", () => {
    const c = localizeConfig(single, "en");
    expect(c.hero.ctaPrimary).toBe("Unterschreiben");
    expect(c.ui.chrome.impressum).toBe("Impressum (Brief)");
    expect(c.ui.chrome.toTop).toBe(UI_DEFAULTS.chrome.toTop);
    // An English brand.lang still gets the German table, as before.
    const en = localizeConfig({ brand: { lang: "en" } }, "en");
    expect(en.ui.chrome.toTop).toBe(UI_DEFAULTS.chrome.toTop);
  });

  test("defaults(L) < letter < i18n.L, arrays replace", () => {
    const en = localizeConfig(multi, "en");
    expect(en.ui.chrome.toTop).toBe(uiDefaults("en").chrome.toTop);
    expect(en.ui.chrome.impressum).toBe("Impressum (Brief)");
    expect(en.ui.chrome.datenschutz).toBe("Privacy (letter)");
    expect(en.hero.headlineLines).toEqual(["x"]);
    expect(en.hero.ctaPrimary).toBe("Unterschreiben");
    const de = localizeConfig(multi, "de");
    expect(de.ui.chrome.toTop).toBe(UI_DEFAULTS.chrome.toTop);
    expect(de.ui.chrome.datenschutz).toBe(UI_DEFAULTS.chrome.datenschutz);
    expect(de.hero.headlineLines).toEqual(["a", "b"]);
    // The letter itself is not changed.
    expect(multi.ui.chrome.datenschutz).toBeUndefined();
  });
});

describe("language pages", () => {
  const template = '<html lang="{{LANG}}"><head>{{HEAD}}</head></html>';
  const canonical = "https://example.org/";
  const prefix = (c) => (l) => langPrefix(c, l);

  test("flag off: no hreflang, one page as before", () => {
    const alts = languageAlternates(canonical, letterLanguages(single), prefix(single));
    expect(alts).toEqual([]);
    const html = renderIndexHtml(template, single, "x", { alternates: alts });
    expect(html).toBe(renderIndexHtml(template, single, "x"));
    expect(html).not.toContain("hreflang");
    expect(html).toContain('<html lang="de">');
  });

  test("flag on: lang, canonical and hreflang per page", () => {
    const alts = languageAlternates(canonical, letterLanguages(multi), prefix(multi));
    expect(alts).toEqual([
      { hreflang: "de", href: "https://example.org/" },
      { hreflang: "en", href: "https://example.org/en/" },
      { hreflang: "x-default", href: "https://example.org/" },
    ]);
    const en = renderIndexHtml(template, localizeConfig(multi, "en"), "x", {
      lang: "en",
      canonical: languageUrl(canonical, "/en"),
      alternates: alts,
      preloadBoot: "/api/boot?lang=en",
    });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('<link rel="canonical" href="https://example.org/en/" />');
    expect(en).toContain('hreflang="x-default" href="https://example.org/"');
    expect(en).toContain('hreflang="en" href="https://example.org/en/"');
    expect(en).toContain('href="/api/boot?lang=en"');
    const de = renderIndexHtml(template, localizeConfig(multi, "de"), "x", {
      alternates: alts,
    });
    expect(de).toContain('<html lang="de">');
    expect(de).toContain('<link rel="canonical" href="https://example.org/" />');
    expect(de).toContain('hreflang="de"');
  });

  test("languageUrl", () => {
    expect(languageUrl("https://a.org", "/en")).toBe("https://a.org/en/");
    expect(languageUrl("https://a.org/", "")).toBe("https://a.org/");
  });
});

describe("admin fields", () => {
  test("language switch texts are editable only with the flag on", () => {
    const has = (c) =>
      editableFields(localizeConfig(c, "de")).some((f) =>
        f.path.startsWith("ui.chrome.language"),
      );
    expect(has(single)).toBe(false);
    expect(has(multi)).toBe(true);
  });
});
