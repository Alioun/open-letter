import { expect, test } from "bun:test";
import {
  reconcilePublication,
  reconcileImport,
  publicationChanges,
} from "../src/publishing/reconcile.js";
import {
  templatePlaceholderIssues,
  TEMPLATE_LINKS,
  appendTemplateToken,
  templateTokenContent,
  templateTokenLabel,
} from "../config/template-placeholders.js";
import { validRichLink } from "../config/rich-links.js";
import {
  createSystemTranslation,
  allocateTemplateId,
  systemTemplateBase,
} from "../config/template-localization.js";
import { campaignSchedule } from "../config/campaign-schedule.js";
import {
  futureCampaignDate,
  campaignRequest,
  submittedCampaign,
} from "../src/campaign-draft.js";
import { draftAfterPublication } from "../src/publishing/draft.js";
import { publicationScope } from "../src/publishing/scope.js";
import {
  campaignText,
  isCampaignTemplate,
} from "../config/campaign-templates.js";

const faqDocument = (items) => ({
  locales: { en: { blocks: { faq: { items } } } },
});

test("targeted email repairs retain writing and insert working personal links or values", () => {
  const body = "<p>My carefully written message</p>";
  const repaired = appendTemplateToken(body, "{{confirmUrl}}");
  expect(repaired).toStartWith(body);
  expect(repaired).toContain('href="{{confirmUrl}}"');
  expect(appendTemplateToken(repaired, "{{confirmUrl}}")).toBe(repaired);
  expect(appendTemplateToken(body, "{{linkHours}}")).toContain("{{linkHours}}");
  expect(appendTemplateToken(body, "<script>")).toBe(body);
  expect(templateTokenLabel("{{confirmUrl}}")).toBe("Anmeldung bestätigen");
  expect(templateTokenLabel("{{linkHours}}")).toContain("Stunden");
  expect(templateTokenContent("{{confirmUrl}}").marks[0].attrs.href).toBe(
    "{{confirmUrl}}",
  );
  expect(templateTokenContent("{{linkHours}}").text).toBe("{{linkHours}}");
  expect(templateTokenContent("{{unknown}}")).toBeNull();
});

test("publication scope exposes website changes while editing email templates", () => {
  const base = {
    locales: { en: { copy: { title: "Original" } } },
    templates: [{ id: 1, subject: "Original subject", updated_at: "before" }],
  };
  const edited = structuredClone(base);
  edited.locales.en.copy.title = "Website experiment";
  edited.templates[0].subject = "New subject";
  expect(publicationScope(base, edited)).toEqual({
    groups: ["Website · Texte (EN)", "E-Mail · Vorlage #1 (EN) · Betreff"],
    templateIds: ["1"],
    label: "Website & E-Mails veröffentlichen",
  });
  edited.locales.en.copy.title = "Original";
  expect(publicationScope(base, edited).label).toBe("E-Mails veröffentlichen");
  edited.templates[0].subject = "Original subject";
  edited.templates[0].updated_at = "after";
  expect(publicationScope(base, edited).groups).toEqual([]);
});

test("publication review identifies changed templates, language, fields, additions and removals", () => {
  const confirmation = {
    id: 1,
    slug: "verification",
    name: "Bestätigung",
    subject: "Hello",
    html_body: "<p>Hello</p>",
  };
  const german = {
    ...confirmation,
    id: 2,
    slug: "verification.de",
    name: "Bestätigung (DE)",
  };
  const before = {
    locales: { en: {}, de: {} },
    templates: [confirmation, german],
  };
  const after = structuredClone(before);
  after.templates[1].subject = "Hallo";
  after.templates[1].html_body = "<p>Hallo</p>";
  expect(publicationScope(before, after).groups).toEqual([
    "E-Mail · Bestätigung (DE) · Betreff, Nachricht",
  ]);
  expect(
    publicationScope({ ...before, templates: [confirmation] }, after).groups,
  ).toEqual(["E-Mail · Bestätigung (DE) · neu angelegt"]);
  expect(
    publicationScope(before, { ...before, templates: [german] }).groups,
  ).toEqual(["E-Mail · Bestätigung (EN) · entfernt"]);
});

test("email editors accept approved personal links while rejecting unknown tokens and unsafe addresses", () => {
  for (const [target] of TEMPLATE_LINKS) {
    expect(validRichLink(target, TEMPLATE_LINKS)).toBe(true);
    expect(validRichLink(target)).toBe(false);
  }
  for (const target of [
    "https://example.org/path",
    "/privacy",
    "#sign",
    "mailto:help@example.org",
    "tel:+4912345",
  ])
    expect(validRichLink(target, TEMPLATE_LINKS)).toBe(true);
  for (const target of [
    "{{unknownUrl}}",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "//evil.invalid",
    "https://example.org\\evil",
    "example.invalid",
  ])
    expect(validRichLink(target, TEMPLATE_LINKS)).toBe(false);
});

test("publication completion preserves edits made after the submitted snapshot and advances their baseline", () => {
  const submitted = { subject: "Draft A" };
  const current = {
    document: { subject: "Draft B" },
    base: { subject: "Original" },
    revision: 3,
  };
  const published = { document: submitted, revision: 4 };
  expect(draftAfterPublication(current, published, submitted)).toEqual({
    newerChanges: true,
    state: { document: { subject: "Draft B" }, base: submitted, revision: 4 },
  });
  expect(current.document.subject).toBe("Draft B");
  expect(
    draftAfterPublication(
      { ...current, document: submitted },
      published,
      submitted,
    ),
  ).toEqual({
    newerChanges: false,
    state: { document: submitted, base: submitted, revision: 4 },
  });
});
const faqItems = (document) => document.locales.en.blocks.faq.items;
const faqBase = () =>
  faqDocument([
    {
      id: "first",
      questionHtml: "<p>First question?</p>",
      answerHtml: "<p>First answer</p>",
    },
    {
      id: "second",
      questionHtml: "<p>Second question?</p>",
      answerHtml: "<p>Second answer</p>",
    },
    {
      id: "third",
      questionHtml: "<p>Third question?</p>",
      answerHtml: "<p>Third answer</p>",
    },
  ]);

test("independent FAQ answers, questions and ordering survive publication and import reconciliation", () => {
  const base = faqBase();
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  faqItems(mine)[0].answerHtml = "<p>My answer</p>";
  faqItems(theirs)[1].answerHtml = "<p>Published answer</p>";
  faqItems(theirs)[0].questionHtml = "<p>Published first question?</p>";
  faqItems(mine).reverse();
  const result = reconcilePublication(base, mine, theirs);
  expect(result.conflicts).toEqual([]);
  expect(faqItems(result.document).map((q) => q.id)).toEqual([
    "third",
    "second",
    "first",
  ]);
  expect(faqItems(result.document)[1].answerHtml).toBe(
    "<p>Published answer</p>",
  );
  expect(faqItems(result.document)[2]).toMatchObject({
    questionHtml: "<p>Published first question?</p>",
    answerHtml: "<p>My answer</p>",
  });
  const imported = reconcileImport(
    { base, document: mine },
    { base, document: theirs },
    base,
  );
  expect(imported.conflicts).toEqual([]);
  expect(imported.document).toEqual(result.document);
});

test("FAQ conflicts isolate one answer and preserve independently added questions", () => {
  const base = faqBase(),
    mine = structuredClone(base),
    theirs = structuredClone(base);
  faqItems(mine)[0].answerHtml = "Local";
  faqItems(theirs)[0].answerHtml = "Published";
  faqItems(mine).splice(1, 0, {
    id: "local-new",
    questionHtml: "New local?",
    answerHtml: "Local new answer",
  });
  faqItems(theirs).push({
    id: "published-new",
    questionHtml: "New published?",
    answerHtml: "Published new answer",
  });
  const result = reconcilePublication(base, mine, theirs);
  expect(result.conflicts.map((c) => c.path)).toEqual([
    ["locales", "en", "blocks", "faq", "items", "byId", "first", "answerHtml"],
  ]);
  const chosen = reconcilePublication(base, mine, theirs, {
    [result.conflicts[0].key]: "current",
  });
  expect(faqItems(chosen.document).map((q) => q.id)).toEqual([
    "first",
    "local-new",
    "second",
    "third",
    "published-new",
  ]);
  expect(faqItems(chosen.document)[0].answerHtml).toBe("Published");
});

test("concurrent FAQ reordering asks for an order without replacing question edits", () => {
  const base = faqBase(),
    mine = structuredClone(base),
    theirs = structuredClone(base);
  faqItems(mine).reverse();
  faqItems(theirs).push(faqItems(theirs).shift());
  faqItems(mine)[0].answerHtml = "My answer";
  faqItems(theirs)[0].answerHtml = "Published answer";
  const result = reconcilePublication(base, mine, theirs);
  expect(result.conflicts.map((c) => c.path)).toEqual([
    ["locales", "en", "blocks", "faq", "items", "order"],
  ]);
  const chosen = reconcilePublication(base, mine, theirs, {
    [result.conflicts[0].key]: "current",
  });
  expect(faqItems(chosen.document).map((q) => q.id)).toEqual([
    "second",
    "third",
    "first",
  ]);
  expect(faqItems(chosen.document)[0].answerHtml).toBe("Published answer");
  expect(faqItems(chosen.document)[1].answerHtml).toBe("My answer");
});

test("FAQ removal versus editing asks about that question and can restore its position", () => {
  const base = faqBase(),
    mine = structuredClone(base),
    theirs = structuredClone(base);
  faqItems(mine).splice(1, 1);
  faqItems(theirs)[1].answerHtml = "New published answer";
  const result = reconcilePublication(base, mine, theirs);
  expect(result.conflicts.map((c) => c.path)).toEqual([
    ["locales", "en", "blocks", "faq", "items", "byId", "second"],
  ]);
  const kept = reconcilePublication(base, mine, theirs, {
    [result.conflicts[0].key]: "current",
  });
  expect(faqItems(kept.document).map((q) => q.id)).toEqual([
    "first",
    "second",
    "third",
  ]);
  expect(faqItems(kept.document)[1].answerHtml).toBe("New published answer");
  expect(faqItems(result.document).map((q) => q.id)).toEqual([
    "first",
    "third",
  ]);
});

test("scheduled broadcasts cannot quietly turn into immediate sends", () => {
  const now = new Date("2026-11-07T21:23:00Z");
  expect(futureCampaignDate(now).getTime()).toBeGreaterThan(now.getTime());
  for (const scheduled_at of [
    "invalid",
    now.toISOString(),
    "2026-11-07T10:00:00Z",
  ])
    expect(() => campaignSchedule({ scheduled_at }, now.getTime())).toThrow(
      "zukünftigen Versandtermin",
    );
  expect(
    campaignSchedule(
      { scheduled_at: "2026-11-08T10:00:00Z" },
      now.getTime(),
    ).toISOString(),
  ).toBe("2026-11-08T10:00:00.000Z");
  expect(campaignSchedule({ send_now: true }, now.getTime()).getTime()).toBe(
    now.getTime(),
  );
});

test("stale editors retain independent changes and explicitly resolve overlapping edits", () => {
  const base = {
    copy: { title: "Old", description: "Original", optional: "Remove me" },
    layout: ["hero", "letter"],
  };
  const local = {
    copy: { title: "My title", description: "Original" },
    layout: ["hero", "letter"],
  };
  const current = {
    copy: {
      title: "Other title",
      description: "Published description",
      optional: "Remove me",
    },
    layout: ["hero", "letter"],
  };
  const result = reconcilePublication(base, local, current);
  expect(result.document.copy.description).toBe("Published description");
  expect("optional" in result.document.copy).toBe(false);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].local).toBe("My title");
  expect(result.conflicts[0].current).toBe("Other title");
  const resolved = reconcilePublication(base, local, current, {
    [result.conflicts[0].key]: "current",
  });
  expect(resolved.document.copy).toEqual({
    title: "Other title",
    description: "Published description",
  });
  expect(local.copy.title).toBe("My title");
  expect(current.copy.optional).toBe("Remove me");
});

test("older drafts without a base require explicit choices for every difference", () => {
  const result = reconcilePublication(
    undefined,
    { copy: { title: "Local", body: "Same" } },
    { copy: { title: "Live", body: "Same" } },
  );
  expect(result.conflicts).toHaveLength(1);
  expect(result.document.copy.body).toBe("Same");
});

test("import review exposes independent incoming values and removals before acceptance", () => {
  const base = {
    locales: { en: { copy: { navCta: "Sign", optional: "Remove" } } },
  };
  const incoming = structuredClone(base);
  incoming.locales.en.copy.navCta = "Restored local draft";
  delete incoming.locales.en.copy.optional;
  const result = reconcilePublication(base, incoming, base);
  expect(result.conflicts).toEqual([]);
  expect(publicationChanges(base, result.document)).toEqual([
    {
      key: JSON.stringify(["locales", "en", "copy", "navCta"]),
      path: ["locales", "en", "copy", "navCta"],
      current: "Sign",
      local: "Restored local draft",
    },
    {
      key: JSON.stringify(["locales", "en", "copy", "optional"]),
      path: ["locales", "en", "copy", "optional"],
      current: "Remove",
      local: undefined,
    },
  ]);
  expect(publicationChanges(base, base)).toEqual([]);
});

test("system translations use delivery slugs and preserve the source without becoming broadcasts", () => {
  const source = {
    id: 1,
    slug: "verification",
    name: "Confirm",
    subject: "Confirm signature",
    html_body:
      '<p>{{firstName}}</p><a href="{{confirmUrl}}">Confirm</a><p>{{linkHours}}</p>',
  };
  const templates = [source];
  const translation = createSystemTranslation(
    templates,
    "verification",
    "de",
    ["en", "de"],
    2,
  );
  expect(translation).toEqual({
    ...source,
    id: 2,
    slug: "verification.de",
    name: "Confirm (DE)",
  });
  expect(systemTemplateBase(translation.slug, ["en", "de"])).toBe(
    "verification",
  );
  expect(isCampaignTemplate(translation)).toBe(false);
  expect(templates).toEqual([source]);
  expect(() =>
    createSystemTranslation(
      [...templates, translation],
      "verification",
      "de",
      ["en", "de"],
      3,
    ),
  ).toThrow("bereits");
  expect(() =>
    createSystemTranslation(templates, "verification", "fr", ["en", "de"], 2),
  ).toThrow();
});

test("broadcast tests use the same template and subject fallback as delivery", () => {
  const templates = [
    { id: 1, slug: "open-letter-update", subject: "Default" },
    { id: 2, slug: "open-letter-update.de", subject: "German template" },
  ];
  expect(campaignText(1, "Custom default", {}, "de", templates).subject).toBe(
    "Custom default",
  );
  expect(
    campaignText(
      1,
      "Custom default",
      { de: { templateId: 2 } },
      "de",
      templates,
    ).subject,
  ).toBe("German template");
  expect(
    campaignText(
      1,
      "Custom default",
      { de: { templateId: 2, subject: "Own subject" } },
      "de",
      templates,
    ).subject,
  ).toBe("Own subject");
  for (const slug of [
    "verification",
    "verification.de",
    "deletion",
    "invite.en",
    "zoom_link",
    "treffen-confirmation",
  ])
    expect(isCampaignTemplate({ slug })).toBe(false);
  expect(isCampaignTemplate(templates[0])).toBe(true);
  expect(isCampaignTemplate({ slug: "newsletter-my-update" })).toBe(true);
});

test("concurrent email edits merge by stable template identity and field", () => {
  const base = {
    templates: [
      {
        id: 1,
        slug: "verification",
        name: "Confirmation",
        subject: "Confirm",
        html_body: "Original A",
        updated_at: "old",
      },
      {
        id: 2,
        slug: "newsletter-one",
        name: "Newsletter",
        subject: "News",
        html_body: "Original B",
      },
    ],
  };
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  mine.templates[0].subject = "My confirmation subject";
  theirs.templates[1].html_body = "Published newsletter body";
  theirs.templates[0].updated_at = "new";
  const merged = reconcilePublication(base, mine, theirs);
  expect(merged.conflicts).toEqual([]);
  expect(merged.document.templates[0].subject).toBe("My confirmation subject");
  expect(merged.document.templates[1].html_body).toBe(
    "Published newsletter body",
  );
  expect(
    publicationChanges(theirs, merged.document).map((c) => c.path),
  ).toEqual([["templates", "1", "subject"]]);
  theirs.templates[0].subject = "Concurrent confirmation subject";
  const conflict = reconcilePublication(base, mine, theirs);
  expect(conflict.conflicts.map((c) => c.path)).toEqual([
    ["templates", "1", "subject"],
  ]);
  const resolved = reconcilePublication(base, mine, theirs, {
    [conflict.conflicts[0].key]: "current",
  });
  expect(resolved.document.templates[0].subject).toBe(
    "Concurrent confirmation subject",
  );
  expect(resolved.document.templates[1].html_body).toBe(
    "Published newsletter body",
  );
});

test("template additions, removals and identity collisions do not blend unrelated messages", () => {
  const first = {
    id: 1,
    slug: "newsletter-one",
    subject: "One",
    html_body: "A",
  };
  const second = {
    id: 2,
    slug: "newsletter-two",
    subject: "Two",
    html_body: "B",
  };
  const third = {
    id: 3,
    slug: "newsletter-three",
    subject: "Three",
    html_body: "C",
  };
  const base = { templates: [first, second] };
  const merged = reconcilePublication(
    base,
    { templates: [first] },
    { templates: [first, second, third] },
  );
  expect(merged.conflicts).toEqual([]);
  expect(merged.document.templates.map((t) => t.id)).toEqual([1, 3]);
  const conflicting = reconcilePublication(
    base,
    { templates: [first, second, third] },
    {
      templates: [
        first,
        second,
        { ...third, slug: "newsletter-other", subject: "Different" },
      ],
    },
  );
  expect(conflicting.conflicts.map((c) => c.path)).toEqual([
    ["templates", "3"],
  ]);
  const chosen = reconcilePublication(
    base,
    { templates: [first, second, third] },
    {
      templates: [
        first,
        second,
        { ...third, slug: "newsletter-other", subject: "Different" },
      ],
    },
    { [conflicting.conflicts[0].key]: "current" },
  );
  expect(chosen.document.templates[2].slug).toBe("newsletter-other");
  expect(chosen.document.templates[2].subject).toBe("Different");
});

test("import review preserves independent browser work and requires a choice before replacing it", () => {
  const base = {
    copy: { title: "Published", description: "Original", footer: "Old footer" },
  };
  const existing = {
    base,
    document: {
      copy: {
        ...base.copy,
        title: "My local title",
        description: "Local description",
      },
    },
  };
  const incoming = {
    base,
    document: { copy: { ...base.copy, title: "Imported title" } },
  };
  const current = { copy: { ...base.copy, footer: "New published footer" } };
  const merged = reconcileImport(existing, incoming, current);
  expect(merged.conflicts).toHaveLength(1);
  expect(merged.conflicts[0].local).toBe("Imported title");
  expect(merged.conflicts[0].current).toBe("My local title");
  expect(merged.document.copy.description).toBe("Local description");
  expect(merged.document.copy.footer).toBe("New published footer");
  const kept = reconcileImport(existing, incoming, current, {
    [merged.conflicts[0].key]: "current",
  });
  expect(kept.document.copy.title).toBe("My local title");
  expect(existing.document.copy.title).toBe("My local title");
});

test("email placeholder diagnostics catch broken existing, translated, and new newsletter templates", () => {
  const original = {
    id: 1,
    slug: "verification",
    name: "Confirmation",
    html_body: '<a href="{{confirmUrl}}">Confirm</a><p>{{linkHours}}</p>',
  };
  const edited = { ...original, html_body: "<p>Replacement text</p>" };
  expect(templatePlaceholderIssues([edited], [original], ["en", "de"])).toEqual(
    [
      {
        id: 1,
        name: "Confirmation",
        missing: ["{{confirmUrl}}", "{{linkHours}}"],
      },
    ],
  );
  const translation = { ...edited, id: 2, slug: "verification.de" };
  expect(
    templatePlaceholderIssues(
      [original, translation],
      [original],
      ["en", "de"],
    )[0].missing,
  ).toContain("{{confirmUrl}}");
  expect(
    templatePlaceholderIssues([original], [original], ["en", "de"]),
  ).toEqual([]);
  expect(
    templatePlaceholderIssues(
      [{ id: 3, slug: "newsletter-new", html_body: "<p>New</p>" }],
      [],
      ["en"],
    )[0].missing,
  ).toEqual(["{{unsubscribeUrl}}"]);
});

test("a draft keeps one request key until it is reset, so it cannot become two campaigns", () => {
  const first = campaignRequest(null, () => "first-key");
  expect(first.key).toBe("first-key");
  // Reloaded from the browser: the same draft, whatever was edited meanwhile.
  const restored = JSON.parse(JSON.stringify(first));
  expect(campaignRequest(restored, () => "unwanted-key").key).toBe("first-key");
  // The sent campaign stays on the record next to its key.
  const sent = { ...restored, campaign: submittedCampaign({ id: 7 }, true) };
  expect(campaignRequest(sent, () => "unwanted-key")).toBe(sent);
  // A reset removes the record; the next draft starts with a key of its own.
  expect(campaignRequest(null, () => "second-key").key).toBe("second-key");

  expect(submittedCampaign({ id: 7, status: "scheduled" }, false)).toEqual({
    id: 7,
    outcome: "scheduled",
  });
  expect(submittedCampaign({ id: 7, status: "scheduled" }, true).outcome).toBe(
    "due",
  );
  // A repeated request can find its campaign already cancelled or sent.
  expect(submittedCampaign({ id: 7, status: "cancelled" }, true).outcome).toBe(
    "cancelled",
  );
  expect(submittedCampaign({ id: 7, status: "sent" }, false).outcome).toBe(
    "sent",
  );
});

test("new newsletter and translation IDs stay above retired publication identities and local additions", () => {
  const templates = [{ id: 2, slug: "verification", name: "Confirm" }];
  expect(allocateTemplateId(templates, 51)).toBe(51);
  expect(allocateTemplateId([...templates, { id: 51 }], 51)).toBe(52);
  expect(allocateTemplateId([], 51)).toBe(51);
  const translation = createSystemTranslation(
    templates,
    "verification",
    "de",
    ["en", "de"],
    51,
  );
  expect(translation.id).toBe(51);
  expect(translation.slug).toBe("verification.de");
  expect(allocateTemplateId([...templates, translation], 51)).toBe(52);
  expect(templates).toEqual([{ id: 2, slug: "verification", name: "Confirm" }]);
});

test("missing or invalid publication ID metadata never guesses a retired template ID", () => {
  const templates = [{ id: 2, slug: "verification", name: "Confirm" }];
  for (const nextId of [
    undefined,
    null,
    "51",
    NaN,
    Infinity,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
  ]) {
    expect(() => allocateTemplateId(templates, nextId)).toThrow();
    expect(() =>
      createSystemTranslation(
        templates,
        "verification",
        "de",
        ["en", "de"],
        nextId,
      ),
    ).toThrow();
  }
  for (const id of ["2", 0, -1, 1.5, Number.MAX_SAFE_INTEGER])
    expect(() => allocateTemplateId([{ id }], 51)).toThrow();
});
