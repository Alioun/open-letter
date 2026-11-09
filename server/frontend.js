import { puckAssets } from "./puck-assets.js";
import { readFileSync, existsSync } from "node:fs";
import {
  renderIndexHtml,
  languageUrl,
  languageAlternates,
} from "../config/html.js";
import { escapeJson } from "../config/publication.js";
import {
  LANGUAGES,
  DEFAULT_LANG,
  LETTER_NAME,
} from "../config/letter.config.js";
import { themeCss } from "../config/theme-css.js";

export async function buildFrontend() {
  const assets = new Map();
  const entries = {};
  for (const [name, entry] of Object.entries({
    public: "src/main.jsx",
    admin: "src/admin-main.jsx",
    preview: "src/preview-main.jsx",
  })) {
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      plugins: name === "admin" ? [puckAssets] : [],
      minify: process.env.NODE_ENV === "production",
      naming: `${name}-[name]-[hash].[ext]`,
      publicPath: "/bundles/",
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          process.env.NODE_ENV || "development",
        ),
      },
    });
    if (!result.success)
      throw new AggregateError(result.logs, `Could not build ${name} frontend`);
    const css = [];
    for (const output of result.outputs) {
      const path = `/bundles/${output.path.split("/").at(-1)}`;
      assets.set(path, {
        bytes: await output.arrayBuffer(),
        type: output.type,
      });
      if (output.kind === "entry-point")
        entries[name] = { ...(entries[name] || {}), script: path };
      if (output.path.endsWith(".css")) css.push(path);
    }
    entries[name].css = css;
  }
  const letterCss = `config/letters/${LETTER_NAME}/letter.css`;
  if (existsSync(letterCss)) {
    const result = await Bun.build({
      entrypoints: [letterCss],
      target: "browser",
      naming: "letter-[name]-[hash].[ext]",
      publicPath: "/bundles/",
      minify: true,
    });
    if (!result.success)
      throw new AggregateError(result.logs, "Could not build letter CSS");
    for (const output of result.outputs) {
      const path = `/bundles/${output.path.split("/").at(-1)}`;
      assets.set(path, {
        bytes: await output.arrayBuffer(),
        type: output.type,
      });
      if (output.path.endsWith(".css")) {
        entries.public.css.push(path);
        entries.preview.css.push(path);
      }
    }
  }
  return { assets, entries };
}

export function publicConfig(config) {
  const copy = structuredClone(config);
  delete copy.i18n;
  copy.email = {
    provider: config.email.provider,
    processor: config.email.processor,
    region: config.email.region,
    ready: config.email.ready,
  };
  return copy;
}

export function documentHtml(
  config,
  letter,
  entries,
  {
    preview = false,
    pageState = "campaign",
    privatePage = false,
    baseUrl = "",
  } = {},
) {
  const data = { config: publicConfig(config), pageState };
  const selected = preview ? entries.preview : entries.public;
  const prefix = preview ? baseUrl : "";
  const template = `<!doctype html><html lang="{{LANG}}" data-letter="{{LETTER}}"><head>{{HEAD}}${selected.css.map((path) => `<link rel="stylesheet" href="${prefix}${path}">`).join("")}</head><body><div id="root"></div><script type="application/json" id="publication-data">${escapeJson(data)}</script><script type="module" src="${prefix}${selected.script}"${preview ? ' crossorigin="anonymous"' : ""}></script></body></html>`;
  const css = `${themeCss(config.theme)}\n${config.publicationCss || ""}`;
  return renderIndexHtml(template, config, letter, {
    lang: config.brand.lang,
    private: privatePage || preview,
    analytics: !privatePage && !preview,
    canonical: languageUrl(
      config.meta.canonicalUrl,
      config.brand.lang === DEFAULT_LANG ? "" : config.brand.lang,
    ),
    alternates: languageAlternates(config.meta.canonicalUrl, LANGUAGES, (l) =>
      l === DEFAULT_LANG ? "" : l,
    ),
  }).replace("</head>", `<style>${css}</style></head>`);
}

export function adminHtml(entries, letter, config) {
  return readFileSync(
    new URL("../admin.template.html", import.meta.url),
    "utf8",
  )
    .replace("{{LETTER}}", letter)
    .replace('src="src/admin-main.jsx"', `src="${entries.admin.script}"`)
    .replace(
      "</head>",
      `<script type="application/json" id="admin-config">${escapeJson({ features: config.features, languages: LANGUAGES })}</script>${entries.admin.css.map((path) => `<link rel="stylesheet" href="${path}">`).join("")}</head>`,
    );
}
