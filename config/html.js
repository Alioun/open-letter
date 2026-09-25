// Renders the document <head> and the full index.html from a letter's config.
// The server generates index.generated.html from index.template.html at startup
// (see server/index.js) so the page metadata is config-driven, not hand-edited.

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Origin (scheme://host) of the analytics script, or "" when disabled. Used to
// extend the CSP only when analytics is configured.
export function analyticsOrigin(cfg) {
  const src = cfg?.meta?.analytics?.src || "";
  if (!src) return "";
  try {
    return new URL(src).origin;
  } catch {
    return "";
  }
}

// `analytics: false` drops the analytics script, `private: true` adds noindex +
// no-referrer (for pages whose URL carries a personal token), `preloadBoot`
// preloads the initial page state.
export function renderHead(
  cfg,
  letterName,
  {
    analytics: withAnalytics = true,
    private: isPrivate = false,
    preloadBoot = false,
    letterCss = false,
  } = {},
) {
  const m = cfg.meta;
  const canonical = m.canonicalUrl;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: m.siteName,
        url: canonical,
        description: m.description,
      },
      {
        "@type": "WebPage",
        "@id": canonical,
        url: canonical,
        name: m.title,
        isPartOf: { "@id": canonical },
        about: {
          "@type": "Thing",
          name: m.schemaAbout?.name || m.siteName,
          description: m.schemaAbout?.description || m.description,
        },
        significantLink: [
          `${canonical}#brief`,
          `${canonical}#unterzeichnen`,
          `${canonical}#liste`,
        ],
      },
    ],
  };

  const analytics = withAnalytics && m.analytics?.src
    ? `\n    <script\n      defer\n      src="${esc(m.analytics.src)}"\n      data-website-id="${esc(m.analytics.websiteId || "")}"\n    ></script>`
    : "";

  return `    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />${
      isPrivate
        ? `\n    <meta name="robots" content="noindex" />\n    <meta name="referrer" content="no-referrer" />`
        : ""
    }
    <meta name="x-letter" content="${esc(letterName || "")}" />${
      // Starts the initial-state request while the bundle downloads; main.jsx
      // reuses this response. A <link> (unlike <script src="/…">) is left alone
      // by Bun's HTML bundler, so the URL can stay relative.
      preloadBoot
        ? `\n    <link rel="preload" href="/api/boot" as="fetch" crossorigin />`
        : ""
    }
    <title>${esc(m.title)}</title>
    <meta name="description" content="${esc(m.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <link rel="icon" type="image/svg+xml" href="${esc(m.faviconSvg)}" />

    <meta property="og:title" content="${esc(m.title)}" />
    <meta property="og:description" content="${esc(m.ogDescription || m.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:image" content="${esc(m.ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:locale" content="${esc(m.ogLocale || "de_DE")}" />
    <meta property="og:site_name" content="${esc(m.siteName)}" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(m.title)}" />
    <meta name="twitter:description" content="${esc(m.ogDescription || m.description)}" />
    <meta name="twitter:image" content="${esc(m.ogImage)}" />

    <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 6).replace(/^/gm, "      ").trimStart()}
    </script>${analytics}${
      // The letter's own stylesheet (config/letters/<name>/letter.css), bundled
      // by Bun's HTML bundler. Its rules scope to <html data-letter="<name>">.
      letterCss
        ? `\n    <link rel="stylesheet" href="./config/letters/${esc(letterName)}/letter.css" />`
        : ""
    }`;
}

export function renderIndexHtml(template, cfg, letterName, headOptions) {
  return template
    .replace("{{LANG}}", esc(cfg.brand.lang || "de"))
    .replace("{{LETTER}}", esc(letterName || ""))
    .replace("{{HEAD}}", renderHead(cfg, letterName, headOptions));
}

// The /abmelden/<token> page. The token alone reads, edits and deletes a
// signer's data, so this page must never report its URL (or pass it on as a
// referrer) to analytics.
export function renderUnsubscribeHtml(template, cfg, letterName, headOptions) {
  return renderIndexHtml(template, cfg, letterName, {
    ...headOptions,
    analytics: false,
    private: true,
  });
}
