import { describe, test, expect } from "bun:test";
import {
  escapeHtml,
  firstNameHtml,
  simplePage,
  pageCopy,
  fill,
  DEFAULT_PAGE_COPY,
} from "../server/pages.js";
import gehaltsdeckel from "../config/letters/gehaltsdeckel/index.js";
import example from "../config/letters/example/index.js";

describe("server-rendered pages", () => {
  test("firstNameHtml escapes an unclosed tag that sanitize() lets through", () => {
    const out = firstNameHtml("<svg/onload=alert(1)// Schmidt");
    expect(out).toBe("&lt;svg/onload=alert(1)//");
    expect(out).not.toContain("<");
  });

  test("escapeHtml covers quotes and ampersands", () => {
    expect(escapeHtml(`a&b"c'd`)).toBe("a&amp;b&quot;c&#39;d");
    expect(escapeHtml(null)).toBe("");
  });

  test("simplePage carries no analytics and no referrer", () => {
    const html = simplePage("<p>x</p>");
    expect(html).not.toContain("<script");
    expect(html).toContain('name="referrer" content="no-referrer"');
  });

  test("simplePage takes language, title and colours from the letter", () => {
    const html = simplePage("<p>x</p>", example);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Open Letter</title>");
    expect(html).toContain(example.theme.colors.rot);
    expect(html).not.toContain("Gehaltsdeckel");
  });

  test("theme values can't break out of the style block", () => {
    const html = simplePage("", {
      theme: { colors: { rot: "red;}</style><script>x()</script>" } },
    });
    expect(html).not.toContain("<script>");
  });

  test("letter copy overrides defaults per key, the rest falls back", () => {
    const copy = pageCopy(example);
    expect(copy.deleteData.button).toBe("Delete permanently");
    // Not set by the example letter (it has no Treffen): German default.
    expect(copy.treffenDone.heading).toBe(DEFAULT_PAGE_COPY.treffenDone.heading);
    expect(pageCopy(gehaltsdeckel).deleteData.text).toContain("Treffen");
    expect(pageCopy({}).expired).toEqual(DEFAULT_PAGE_COPY.expired);
  });

  test("fill replaces known placeholders only", () => {
    expect(fill("Hallo {firstName}{when}, {other}", { firstName: "A", when: "" })).toBe(
      "Hallo A, {other}",
    );
  });
});
