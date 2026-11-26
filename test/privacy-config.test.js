import { describe, test, expect } from "bun:test";
import {
  resolvePrivacy,
  backupKeepHours,
  PRIVACY_DEFAULTS,
} from "../config/privacy.js";
import example from "../config/letters/example/index.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DefaultPrivacyBody } from "../config/privacy-content.jsx";
import { interpolateTemplate } from "../server/email.js";

describe("the default privacy policy and the region", () => {
  const policy = (features) => {
    const config = structuredClone(example);
    config.features = {
      ...config.features,
      kreisverbandField: true,
      ...features,
    };
    return renderToStaticMarkup(createElement(DefaultPrivacyBody, { config }));
  };
  const withName = "erscheinen dein Name, dein Kreisverband";

  test("a letter with one checkbox says the region appears with the name", () => {
    expect(policy({ publicSignerDetails: false })).toContain(withName);
  });

  test("a letter that asks for name or details says the region appears only with the details", () => {
    const html = policy({ publicSignerDetails: true });
    expect(html).not.toContain(withName);
    expect(html).toContain(
      "Nur dann erscheint auch dein Kreisverband in der Liste.",
    );
    expect(
      policy({ publicSignerDetails: true, stateResolution: true }),
    ).toContain(
      "Nur dann erscheinen auch dein Kreisverband und das daraus ermittelte Bundesland in der Liste.",
    );
  });
});

describe("the default privacy policy and the counts per organisation and role", () => {
  const policy = (features) => {
    const config = structuredClone(example);
    config.features = { ...config.features, ...features };
    return renderToStaticMarkup(createElement(DefaultPrivacyBody, { config }));
  };
  const forEveryPublicName =
    "Für diese Unterschriften veröffentlichen wir die Anzahl je Angabe in den Feldern „Organisation“ und „Role“, getrennt von den Namen.";
  const forPublicDetails =
    "Die Anzahl je Angabe in den Feldern „Organisation“ und „Role“ veröffentlichen wir, getrennt von den Namen, nur für Unterschriften, bei denen der öffentlichen Anzeige dieser Angaben zugestimmt wurde.";

  test("a letter with one checkbox says the counts cover every public name", () => {
    const html = policy({ publicSignerDetails: false });
    expect(html).toContain(forEveryPublicName);
    expect(html).not.toContain(forPublicDetails);
  });

  test("a letter that asks for name or details says the counts cover only the details that are public", () => {
    const html = policy({ publicSignerDetails: true });
    expect(html).toContain(
      `zeigen wir diese Angaben neben deinem Namen. ${forPublicDetails}`,
    );
    expect(html).not.toContain(forEveryPublicName);
  });
});

describe("privacy config", () => {
  test("missing keys fall back to the defaults", () => {
    const p = resolvePrivacy({});
    expect(p.confirmationLinkHours).toBe(
      PRIVACY_DEFAULTS.confirmationLinkHours,
    );
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
    expect(
      resolvePrivacy({ privacy: { deliveryLogDays: 10 } }).deliveryLogMs,
    ).toBe(10 * 24 * 3600 * 1000);
  });

  test("invalid values fail loudly", () => {
    expect(() => resolvePrivacy({ privacy: { settingsLinkDays: 0 } })).toThrow(
      /settingsLinkDays/,
    );
    expect(() =>
      resolvePrivacy({ privacy: { treffenRetentionDays: "14" } }),
    ).toThrow(/treffenRetentionDays/);
  });

  test("backup retention comes from config unless BACKUP_KEEP overrides it", () => {
    const p = resolvePrivacy({ privacy: { backupRetentionHours: 72 } });
    expect(backupKeepHours(p, undefined)).toBe(72);
    expect(backupKeepHours(p, "")).toBe(72); // docker-compose passes an empty value
    expect(backupKeepHours(p, "24")).toBe(24);
    expect(backupKeepHours(p, "nonsense")).toBe(72);
    expect(backupKeepHours(p, "168")).toBe(168);
    expect(() => backupKeepHours(p, "169")).toThrow("erasureLogDays");
  });

  test("retention years must be whole years", () => {
    expect(() =>
      resolvePrivacy({ privacy: { signerRetentionYears: 1.5 } }),
    ).toThrow(/whole number/);
  });

  test("the erasure log must outlive the backups", () => {
    expect(() =>
      resolvePrivacy({
        privacy: { backupRetentionHours: 200, erasureLogDays: 7 },
      }),
    ).toThrow(/erasureLogDays/);
  });

  test("analytics needs a stated retention period", () => {
    const withAnalytics = (analytics) => ({ meta: { analytics } });
    expect(() =>
      resolvePrivacy(withAnalytics({ src: "https://stats.example.org/s.js" })),
    ).toThrow(/retentionMonths/);
    expect(() =>
      resolvePrivacy(
        withAnalytics({
          src: "https://stats.example.org/s.js",
          retentionMonths: 12,
        }),
      ),
    ).not.toThrow();
    expect(() => resolvePrivacy(withAnalytics({ src: "" }))).not.toThrow();
  });

  test("shipped letters resolve", () => {
    expect(() => resolvePrivacy(example)).not.toThrow();
  });

  test("templates can state the link lifetime", () => {
    expect(
      interpolateTemplate("gültig: {{linkHours}} Stunden", { linkHours: "24" }),
    ).toBe("gültig: 24 Stunden");
  });
});
