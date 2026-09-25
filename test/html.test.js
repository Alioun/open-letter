import { describe, test, expect } from "bun:test";
import {
  renderIndexHtml,
  renderUnsubscribeHtml,
} from "../config/html.js";

const cfg = {
  brand: { lang: "de" },
  meta: {
    title: "T",
    description: "D",
    canonicalUrl: "https://example.org/",
    analytics: {
      src: "https://stats.example.org/script.js",
      websiteId: "abc",
    },
  },
};
const template = "<html lang=\"{{LANG}}\"><head>{{HEAD}}</head></html>";

describe("generated HTML", () => {
  test("<html> names the active letter so letter styles can scope to it", () => {
    const html = renderIndexHtml(
      '<html lang="{{LANG}}" data-letter="{{LETTER}}"><head>{{HEAD}}</head></html>',
      cfg,
      "beispiel",
    );
    expect(html).toContain('<html lang="de" data-letter="beispiel">');
  });

  test("homepage preloads the initial state", () => {
    const html = renderIndexHtml(template, cfg, "x", { preloadBoot: true });
    expect(html).toContain('<link rel="preload" href="/api/boot" as="fetch" crossorigin />');
    expect(renderIndexHtml(template, cfg, "x")).not.toContain("/api/boot");
  });

  test("homepage loads the analytics script when configured", () => {
    const html = renderIndexHtml(template, cfg, "x");
    expect(html).toContain("https://stats.example.org/script.js");
    expect(html).not.toContain("no-referrer");
  });

  test("unsubscribe page never loads analytics and sends no referrer", () => {
    const html = renderUnsubscribeHtml(template, cfg, "x");
    expect(html).not.toContain("stats.example.org");
    expect(html).not.toContain("data-website-id");
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
});
