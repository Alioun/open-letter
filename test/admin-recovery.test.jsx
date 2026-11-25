import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  initializeCampaignTemplate,
  campaignTemplatesAvailable,
} from "../src/campaign-draft.js";
import CampaignMessageFields from "../src/CampaignMessageFields.jsx";
import EmailProfileReview from "../src/EmailProfileReview.jsx";
import { readPublicationPreview } from "../src/publishing/preview.js";

test("a refreshed template catalogue preserves an existing message even when its template disappears", () => {
  const templates = [
    { id: 6, name: "Alternative", subject: "Different default" },
  ];
  const draft = {
    template: "5",
    subject: "My carefully written subject",
    texts: { de: "Mein eigener Betreff" },
  };
  expect(initializeCampaignTemplate(draft, templates)).toBe(draft);
  const html = renderToStaticMarkup(
    <CampaignMessageFields
      templates={templates}
      templateId={draft.template}
      subject={draft.subject}
      onTemplateChange={() => {}}
      onSubjectChange={() => {}}
    />,
  );
  expect(html).toContain("Bisherige Vorlage nicht verfügbar");
  expect(html).toContain("My carefully written subject");
  expect(html).toContain("Wähle eine andere Vorlage");
});

test("only a pristine message receives an initial default template", () => {
  const templates = [{ id: 6, subject: "Default subject" }];
  const empty = { template: "", subject: "", texts: {} };
  expect(initializeCampaignTemplate(empty, templates)).toEqual({
    template: "6",
    subject: "Default subject",
    texts: {},
  });
  for (const draft of [
    { ...empty, subject: "My subject" },
    { ...empty, texts: { de: "Mein Betreff" } },
  ])
    expect(initializeCampaignTemplate(draft, templates)).toBe(draft);
  expect(initializeCampaignTemplate(empty, [])).toBe(empty);
});

test("missing language-specific templates block delivery until an available choice or fallback is selected", () => {
  const templates = [{ id: 5, name: "Default", subject: "Default subject" }];
  const texts = {
    de: { templateId: "6", subject: "Meine erhaltene Übersetzung" },
  };
  expect(campaignTemplatesAvailable("5", texts, templates)).toBe(false);
  expect(
    campaignTemplatesAvailable(
      "5",
      { de: { ...texts.de, templateId: "" } },
      templates,
    ),
  ).toBe(true);
  const html = renderToStaticMarkup(
    <CampaignMessageFields
      templates={templates}
      templateId="6"
      subject={texts.de.subject}
      labelSuffix=" (DE)"
      allowFallback
      onTemplateChange={() => {}}
      onSubjectChange={() => {}}
    />,
  );
  expect(html).toContain("Vorlage (DE)");
  expect(html).toContain("Meine erhaltene Übersetzung");
  expect(html).toContain("Bisherige Vorlage nicht verfügbar");
});

test("email conflict review exposes saved and local SMTP differences without exposing secrets", () => {
  const saved = {
    provider: "smtp",
    host: "new.smtp.example.invalid",
    user: "new-login@example.invalid",
    from: "organizer@example.invalid",
    port: 465,
    secure: true,
    hasCredential: true,
  };
  const local = {
    ...saved,
    host: "old.smtp.example.invalid",
    user: "my-login@example.invalid",
    secret: "must-never-appear-in-comparison",
  };
  const html = renderToStaticMarkup(
    <EmailProfileReview
      saved={saved}
      local={local}
      revision={4}
      onContinue={() => {}}
    />,
  );
  for (const text of [
    saved.host,
    saved.user,
    local.host,
    local.user,
    "Aktuell gespeichert",
    "Deine Eingabe",
    "Mit meinen Eingaben weiterarbeiten",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Revision");
  expect(html).not.toContain(local.secret);
  expect(html).toContain("neu eingegebenen Zugangsdaten bleiben");
});

test("preview failures give German recovery guidance and keep server details separate", async () => {
  const request = { document: {}, lang: "en", pageState: "campaign" };
  for (const api of [
    async () =>
      Response.json({ error: "Internal server error" }, { status: 500 }),
    async () => {
      throw new TypeError("Failed to fetch");
    },
  ]) {
    const failure = await readPublicationPreview(api, request).catch(
      (error) => error,
    );
    expect(failure.message).toContain("Dein lokaler Entwurf bleibt erhalten");
    expect(failure.message).not.toContain("Internal server error");
    expect(failure.message).not.toContain("Failed to fetch");
    expect(failure.detail).toBeTruthy();
  }
  expect(
    await readPublicationPreview(
      async () => new Response("<html>Preview</html>"),
      request,
    ),
  ).toBe("<html>Preview</html>");
});
