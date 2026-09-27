// Per-letter languages, behind `features.multiLanguage`.
//
// With the flag on, a letter lists its languages in `languages` (the first is
// the default and is served at "/"; every other one at "/<lang>"). Copy for a
// language lives in the letter's `i18n.<lang>` block, a partial config that is
// deep-merged over the letter: objects merge key by key, arrays and strings
// replace. With the flag off (the default) a letter has exactly one language,
// `brand.lang`, and `languages` / `i18n` are ignored.
import { UI_DEFAULTS, uiDefaults, deepMerge } from "./ui.js";

export function multiLanguage(cfg) {
  return Boolean(cfg?.features?.multiLanguage);
}

export function letterLanguages(cfg) {
  const own = cfg?.brand?.lang || "de";
  const list = cfg?.languages;
  if (!multiLanguage(cfg) || !Array.isArray(list) || list.length === 0) {
    return [own];
  }
  return [...new Set(list.map((l) => String(l).toLowerCase()))];
}

export function defaultLanguage(cfg) {
  return letterLanguages(cfg)[0];
}

// A language this letter offers, else its default.
export function normalizeLang(cfg, lang) {
  const list = letterLanguages(cfg);
  const l = String(lang ?? "").toLowerCase();
  return list.includes(l) ? l : list[0];
}

// URL prefix for a language: "" for the default, "/en" for the others.
export function langPrefix(cfg, lang) {
  const l = normalizeLang(cfg, lang);
  return l === defaultLanguage(cfg) ? "" : `/${l}`;
}

// The language of the page a request comes from: the X-Lang header (sent by
// the frontend only off the default language) or ?lang=, validated against the
// letter's languages; the default otherwise.
export function requestLang(cfg, req) {
  let q = null;
  try {
    q = new URL(req.url).searchParams.get("lang");
  } catch {}
  return normalizeLang(cfg, req.headers?.get?.("x-lang") || q);
}

// The letter config as seen in `lang`, built from the letter as written
// (without a merged `ui`): defaults(lang) < letter < i18n.<lang>. With the flag
// off this is the letter with its `ui` block over the German table, exactly as
// before languages existed.
export function localizeConfig(letter, lang) {
  if (!multiLanguage(letter)) {
    return { ...letter, ui: deepMerge(UI_DEFAULTS, letter.ui || {}) };
  }
  const l = normalizeLang(letter, lang);
  const over = letter.i18n?.[l] || {};
  const merged = deepMerge(letter, over);
  merged.ui = deepMerge(
    deepMerge(uiDefaults(l), letter.ui || {}),
    over.ui || {},
  );
  return merged;
}

// Every email template a letter ships, keyed by stored slug: the letter's own
// (default language) as "<slug>", each further language's
// `i18n.<lang>.email.templates` as "<slug>.<lang>". Values: { name, subject,
// html_body }. With the flag off this is exactly `email.templates`.
export function letterTemplates(cfg) {
  const out = {};
  const put = (slug, t) => {
    out[slug] = { name: t.name, subject: t.subject, html_body: t.htmlBody };
  };
  for (const [slug, t] of Object.entries(cfg?.email?.templates || {})) {
    put(slug, t);
  }
  for (const l of letterLanguages(cfg).slice(1)) {
    const own = cfg?.i18n?.[l]?.email?.templates || {};
    for (const [slug, t] of Object.entries(own)) {
      // A partial translation keeps the default's other fields.
      const base = cfg?.email?.templates?.[slug] || {};
      put(`${slug}.${l}`, {
        ...base,
        ...t,
        name: t.name || `${base.name || slug} (${l.toUpperCase()})`,
      });
    }
  }
  return out;
}

// The stored slug of a template in `lang`: "<slug>" for the default language,
// "<slug>.<lang>" for a further one.
export function templateSlug(cfg, slug, lang) {
  const l = normalizeLang(cfg, lang);
  return l === defaultLanguage(cfg) ? slug : `${slug}.${l}`;
}

// `url` with "lang=<l>" added for a further language, unchanged for the
// default. Mail links carry it so the page behind them can answer in the
// person's language even once their row is gone.
export function withLang(cfg, url, lang) {
  const l = normalizeLang(cfg, lang);
  if (l === defaultLanguage(cfg)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}lang=${l}`;
}

// The language to store for a person: null for the default (so NULL keeps
// meaning "the default language"), the code for a further one.
export function storedLang(cfg, lang) {
  const l = normalizeLang(cfg, lang);
  return l === defaultLanguage(cfg) ? null : l;
}
