import { describe, test, expect } from "bun:test";
import { renderIndexHtml } from "../config/html.js";

const cfg = {
  brand: { lang: "de" },
  meta: {
    title: "T",
    description: "D",
    canonicalUrl: "https://example.org/",
  },
};
const template = "<html lang=\"{{LANG}}\"><head>{{HEAD}}</head></html>";

describe("generated HTML", () => {
  test("homepage preloads the initial state", () => {
    const html = renderIndexHtml(template, cfg, "x", { preloadBoot: true });
    expect(html).toContain('<link rel="preload" href="/api/boot" as="fetch" crossorigin />');
    expect(renderIndexHtml(template, cfg, "x")).not.toContain("/api/boot");
  });
});
