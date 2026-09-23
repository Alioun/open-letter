import { describe, expect, test } from "bun:test";
import { themeCss } from "../config/theme-css.js";

describe("themeCss", () => {
  test("hard shadows by default: no elevation tokens", () => {
    expect(themeCss({ style: {} })).not.toContain("--elev-");
  });

  test("soft shadows, radii and CTA colours when configured", () => {
    const css = themeCss({
      colors: { ctaBg: "#811d62", onAkzent: "#fed919" },
      style: { shadow: "soft", cardRadius: "16px", buttonRadius: "48px" },
    });
    expect(css).toContain("--elev-md:");
    expect(css).toContain("--radius-card: 16px;");
    expect(css).toContain("--radius-button: 48px;");
    expect(css).toContain("--cta-bg: #811d62;");
    expect(css).toContain("--on-akzent: #fed919;");
  });
});
