import { describe, test, expect } from "bun:test";
import { escapeHtml, firstNameHtml, simplePage } from "../server/pages.js";

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
});
