import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readAdminJson, AdminReadStatus } from "../src/admin-read.jsx";
import AdminApp from "../src/AdminApp.jsx";
import CampaignAudit from "../src/CampaignAudit.jsx";
import ZoomMailingRecovery from "../src/ZoomMailingRecovery.jsx";
import {
  readCampaignAudience,
  readCampaignRetryReview,
  readCampaignSubjectExamples,
} from "../src/campaign-approval.js";
import CampaignRetryReview from "../src/CampaignRetryReview.jsx";
import EmailTestReceipt from "../src/EmailTestReceipt.jsx";

test("campaign approval rechecks the current audience and refuses unavailable counts", async () => {
  let count = 36;
  const api = async () =>
    Response.json({
      subscriberCount: count,
      audienceLanguages: { newsletter: { en: count - 5, de: 5 } },
    });
  expect((await readCampaignAudience(api, "newsletter")).count).toBe(36);
  count = 99;
  expect((await readCampaignAudience(api, "newsletter")).count).toBe(99);
  const selected = await readCampaignAudience(
    async (path, options) => {
      expect(path).toBe("/api/admin/newsletter-selection");
      expect(JSON.parse(options.body)).toEqual({ ids: [2, 9], offset: 0 });
      return Response.json({
        total: 1,
        byLanguage: { de: 1 },
        signers: [{ id: 9 }],
      });
    },
    "selection",
    [2, 9],
  );
  expect(selected.count).toBe(1);
  expect(selected.byLanguage).toEqual({ de: 1 });
  for (const response of [
    Response.json({}, { status: 503 }),
    Response.json({ subscriberCount: -1 }),
    Response.json({
      subscriberCount: 10,
      audienceLanguages: { newsletter: { en: 5 } },
    }),
  ])
    await expect(
      readCampaignAudience(async () => response, "newsletter"),
    ).rejects.toThrow("kein Versandauftrag");
});

test("retry approval requires consistent fresh remaining counts and explains changed content and audience", async () => {
  const review = {
    id: 7,
    eligible: 10,
    alreadyAccepted: 4,
    remaining: 6,
    checkedAt: "2026-11-08T12:00:00Z",
    versions: [
      {
        language: "en",
        count: 4,
        templateName: "Newsletter",
        templateId: 8,
        subject: "Current subject",
        subjectExample: "Current subject",
        fallback: false,
      },
      {
        language: "de",
        count: 2,
        templateName: "Newsletter",
        templateId: 8,
        subject: "Current subject",
        subjectExample: "Current subject",
        fallback: true,
      },
    ],
  };
  const loaded = await readCampaignRetryReview(async (path, options) => {
    expect(path).toBe("/api/admin/campaigns/7/retry");
    expect(options).toBeUndefined();
    return Response.json(review);
  }, 7);
  const html = renderToStaticMarkup(
    <CampaignRetryReview review={loaded} paused />,
  );
  for (const text of [
    "6 verbleibende",
    "4 bereits",
    "Current subject",
    "Standardsprache",
    "weitere berechtigte Personen hinzukommen",
    "pausiert",
    "automatisch versendet",
  ])
    expect(html).toContain(text);
  await expect(
    readCampaignRetryReview(
      async () => Response.json({ ...review, remaining: 5 }),
      7,
    ),
  ).rejects.toThrow("nicht vollständig");
  await expect(
    readCampaignRetryReview(
      async () => Response.json({ error: "Vorlage fehlt" }, { status: 400 }),
      7,
    ),
  ).rejects.toThrow("Vorlage fehlt");
});

test("approval renders subject examples through the preview endpoint and refuses failed examples", async () => {
  const examples = await readCampaignSubjectExamples(
    async (path, options) => {
      expect(path).toBe("/api/admin/preview");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        template_id: 8,
        subject: "Hello {{firstName}}",
        lang: "en",
      });
      return Response.json({ subject: "Hello Ada" });
    },
    [{ language: "en", templateId: 8, subject: "Hello {{firstName}}" }],
  );
  expect(examples).toEqual({ en: "Hello Ada" });
  await expect(
    readCampaignSubjectExamples(
      async () => Response.json({}, { status: 503 }),
      [{ language: "de", templateId: 8 }],
    ),
  ).rejects.toThrow("kein Versandauftrag");
});

test("restored receipt approval identifies its test and older tests require a new identified test", () => {
  const html = renderToStaticMarkup(
    <EmailTestReceipt
      validation={{
        id: "test-one",
        accepted: true,
        recipient: "admin@example.invalid",
        checkedAt: "2026-11-08T12:00:00Z",
        profileRevision: 4,
      }}
    />,
  );
  for (const text of [
    "admin@example.invalid",
    "8.11.2026",
    "Revision 4",
    "Campaign email setup test",
  ])
    expect(html).toContain(text);
  const legacy = renderToStaticMarkup(
    <EmailTestReceipt
      validation={{ accepted: true, checkedAt: "2026-11-08T12:00:00Z" }}
    />,
  );
  expect(legacy).toContain("Sende eine neue Testnachricht");
});

test("stopped meeting mail explains repair, its stopped state and the technical support handoff", () => {
  const html = renderToStaticMarkup(
    <ZoomMailingRecovery
      mailing={{
        kind: "link",
        status: "aborted",
        attempts: 3,
        recipient_count: 5,
        failure: {
          category: "authentication",
          protocol: 535,
          correlationId: "safe-fixture-id",
        },
      }}
      eventAt="2026-11-22T15:00:00Z"
      eventLabel="Meeting fixture"
      repair={() => {}}
    />,
  );
  expect(html).toContain("Anmeldung fehlgeschlagen");
  expect(html).toContain("Der automatische Versand bleibt danach angehalten");
  expect(html).toContain("Supportangaben kopieren");
  expect(html).toContain("safe-fixture-id");
  expect(html).toContain("Meeting fixture");
  expect(html).not.toContain("Server-Log prüfen");
});

test("campaign audit identifies saved language rules and actual send completion without inventing a historical preview", () => {
  const html = renderToStaticMarkup(
    <CampaignAudit
      api={() => {}}
      campaign={{
        id: 42,
        audience: "selection",
        selection_count: 13,
        template_id: 1,
        subject: "Saved subject",
        recipient_count: 10,
        sent_at: "2026-01-05T12:00:00Z",
        created_at: "2026-01-04T12:00:00Z",
        i18n: { de: { subject: "Gespeicherter Betreff" } },
      }}
    />,
  );
  expect(html).toContain("#42");
  expect(html).toContain("13 Einträge");
  expect(html).toContain("Versand abgeschlossen");
  expect(html).toContain(
    new Date("2026-01-05T12:00:00Z").toLocaleString("de-DE", { hour12: false }),
  );
  expect(html).toContain("Saved subject");
  expect(html).toContain("Standardvorlage #1");
  expect(html).toContain(
    "Die Vorlagen können sich seit dem Versand geändert haben",
  );
});

test("the admin renders its login before operational resources are loaded", () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  try {
    const html = renderToStaticMarkup(<AdminApp />);
    expect(html).toContain("Anmelden");
    expect(html).toContain("Passwort");
  } finally {
    globalThis.localStorage = previous;
  }
});

test("admin reads reject failed HTTP responses even when they contain valid JSON", async () => {
  await expect(
    readAdminJson(
      async () => new Response('{"error":"unavailable"}', { status: 503 }),
      "/api/admin/zoom-mailings",
    ),
  ).rejects.toThrow("konnten nicht geladen");
  await expect(
    readAdminJson(async () => {
      throw new TypeError("offline");
    }, "/api/admin/campaigns"),
  ).rejects.toThrow();
  await expect(
    readAdminJson(async () => new Response("invalid"), "/api/admin/campaigns"),
  ).rejects.toThrow();
  expect(
    await readAdminJson(
      async () => Response.json([]),
      "/api/admin/zoom-registrations",
    ),
  ).toEqual([]);
});

test("failed admin reads always offer retry and distinguish retained snapshots", () => {
  const initial = renderToStaticMarkup(
    <AdminReadStatus
      label="Anmeldungen"
      resource={{ data: null, loading: false, error: true, reload() {} }}
    />,
  );
  expect(initial).toContain('role="alert"');
  expect(initial).toContain("Erneut laden");
  expect(initial).toContain("Bitte erneut laden");
  const stale = renderToStaticMarkup(
    <AdminReadStatus
      label="Kampagnen"
      resource={{ data: [], loading: false, error: true, reload() {} }}
    />,
  );
  expect(stale).toContain("zuletzt geladene Stand");
  const ready = renderToStaticMarkup(
    <AdminReadStatus
      label="Kampagnen"
      resource={{ data: [], loading: false, error: false, reload() {} }}
    />,
  );
  expect(ready).not.toContain('role="alert"');
});
