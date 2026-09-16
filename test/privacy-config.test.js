import { describe, test, expect } from "bun:test";
import { resolvePrivacy, PRIVACY_DEFAULTS } from "../config/privacy.js";
import gehaltsdeckel from "../config/letters/gehaltsdeckel/index.js";
import example from "../config/letters/example/index.js";
import { interpolateTemplate } from "../server/email.js";

describe("privacy config", () => {
  test("missing keys fall back to the defaults", () => {
    const p = resolvePrivacy({});
    expect(p.confirmationLinkHours).toBe(PRIVACY_DEFAULTS.confirmationLinkHours);
    expect(p.settingsLinkMs).toBe(90 * 24 * 3600 * 1000);
    expect(p.emailJobRetentionS).toBe(24 * 3600);
  });

  test("letter values override defaults and derive durations", () => {
    const p = resolvePrivacy({
      privacy: { treffenRetentionDays: 30, confirmationLinkHours: 48 },
    });
    expect(p.treffenRetentionMs).toBe(30 * 24 * 3600 * 1000);
    expect(p.confirmationLinkMs).toBe(48 * 3600 * 1000);
    expect(p.settingsLinkDays).toBe(90);
  });

  test("invalid values fail loudly", () => {
    expect(() => resolvePrivacy({ privacy: { settingsLinkDays: 0 } })).toThrow(
      /settingsLinkDays/,
    );
    expect(() =>
      resolvePrivacy({ privacy: { treffenRetentionDays: "14" } }),
    ).toThrow(/treffenRetentionDays/);
  });

  test("analytics needs a stated retention period", () => {
    const withAnalytics = (analytics) => ({ meta: { analytics } });
    expect(() =>
      resolvePrivacy(withAnalytics({ src: "https://stats.example.org/s.js" })),
    ).toThrow(/retentionMonths/);
    expect(() =>
      resolvePrivacy(
        withAnalytics({ src: "https://stats.example.org/s.js", retentionMonths: 12 }),
      ),
    ).not.toThrow();
    expect(() => resolvePrivacy(withAnalytics({ src: "" }))).not.toThrow();
  });

  test("shipped letters resolve", () => {
    expect(() => resolvePrivacy(gehaltsdeckel)).not.toThrow();
    expect(() => resolvePrivacy(example)).not.toThrow();
  });

  test("templates can state the link lifetime", () => {
    expect(
      interpolateTemplate("gültig: {{linkHours}} Stunden", { linkHours: "24" }),
    ).toBe("gültig: 24 Stunden");
  });
});
