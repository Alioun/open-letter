import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import cfg, { DEFAULT_LANG } from "../config/letter.config.js";
import { resolvedMetadata } from "../config/publication.js";
import ConflictResolution from "../src/publishing/ConflictResolution.jsx";
import { richTextSummary } from "../src/publishing/rich-summary.js";

test("FAQ comparison names the question and renders its answer without implementation data", () => {
  const base = {
    locales: {
      [DEFAULT_LANG]: {
        blocks: {
          faq: {
            items: [
              {
                id: "question-a",
                questionHtml: "<p>How &amp; why?</p>",
                answerHtml: "<p>Original answer</p>",
              },
            ],
          },
        },
      },
    },
  };
  const changed = structuredClone(base);
  changed.locales[DEFAULT_LANG].blocks.faq.items[0].answerHtml =
    "<p>Restored answer</p>";
  const rendered = compare(base, changed);
  expect(rendered).toContain("FAQ · &quot;How &amp; why?&quot; · Antwort");
  expect(rendered).toContain("Original answer");
  expect(rendered).toContain("Restored answer");
  expect(rendered).toContain('sandbox=""');
  expect(rendered).not.toContain("questionHtml");
  expect(rendered).not.toContain("question-a");
});

test("FAQ order comparison lists question names in each order", () => {
  const base = {
    locales: {
      [DEFAULT_LANG]: {
        blocks: {
          faq: {
            items: [
              { id: "a", questionHtml: "First?", answerHtml: "A" },
              { id: "b", questionHtml: "Second?", answerHtml: "B" },
            ],
          },
        },
      },
    },
  };
  const changed = structuredClone(base);
  changed.locales[DEFAULT_LANG].blocks.faq.items.reverse();
  const rendered = compare(base, changed);
  expect(rendered).toContain("FAQ · Reihenfolge der Fragen");
  expect(rendered).toContain("<li>First?</li><li>Second?</li>");
  expect(rendered).toContain("<li>Second?</li><li>First?</li>");
  expect(rendered).not.toContain("questionHtml");
});

test("rich summaries decode question punctuation and keep unsafe markup as text", () => {
  expect(
    richTextSummary("<p>How &amp; <strong>why</strong> &#x1f680;?</p>"),
  ).toBe("How & why 🚀?");
  expect(richTextSummary("&lt;script&gt; &quot;x&quot; &#99999999999;")).toBe(
    '<script> "x" �',
  );
});

function compare(base, document) {
  return renderToStaticMarkup(
    createElement(ConflictResolution, {
      draft: { base, document },
      current: { revision: 1, document: base },
      defaults: { [DEFAULT_LANG]: cfg },
      onAccept() {},
      onCancel() {},
      exportDraft() {},
    }),
  );
}

test("headline comparisons show line text and German formatting names instead of JSON", () => {
  const base = {
    locales: {
      [DEFAULT_LANG]: {
        copy: {
          "hero.headlineLines": [
            { text: "Published headline", style: "banner" },
            { text: "A lighter line", style: "light" },
          ],
        },
      },
    },
  };
  const changed = structuredClone(base);
  changed.locales[DEFAULT_LANG].copy["hero.headlineLines"][0].text =
    "My revised headline";
  const rendered = compare(base, changed);
  for (const text of [
    "Published headline",
    "My revised headline",
    "Farbfläche",
    "Leicht",
  ])
    expect(rendered).toContain(text);
  expect(rendered).not.toContain("&quot;style&quot;");
  expect(rendered).not.toContain("&quot;text&quot;");
});

test("copy comparisons render lists, booleans and inherited default headlines readably", () => {
  const base = { locales: { [DEFAULT_LANG]: { copy: {} } } };
  const changed = structuredClone(base);
  changed.locales[DEFAULT_LANG].copy = {
    "hero.headlineLines": [{ text: "New title", style: "" }],
    "features.successMode": true,
    "sign.criteria": ["One requirement", "Another requirement"],
  };
  const rendered = compare(base, changed);
  expect(rendered).toContain("Vorgabe aus den Servereinstellungen");
  expect(rendered).toContain(cfg.hero.headlineLines[0].text);
  expect(rendered).toContain('<p class="publication-diff-text">Ja</p>');
  expect(rendered).toContain(
    "<li>One requirement</li><li>Another requirement</li>",
  );
  expect(rendered).not.toContain("&quot;style&quot;");
});

test("metadata comparisons name the field and show the resolved automatic title", () => {
  const base = {
    locales: { [DEFAULT_LANG]: { copy: {} } },
    metadata: { [DEFAULT_LANG]: {} },
  };
  const changed = structuredClone(base);
  changed.metadata[DEFAULT_LANG].title = "Imported explicit title";
  const rendered = compare(base, changed);
  expect(rendered).toContain(`${DEFAULT_LANG.toUpperCase()} · Seitentitel`);
  expect(rendered).toContain("Automatisch:");
  expect(rendered).toContain(resolvedMetadata(cfg).title);
  expect(rendered).toContain("Imported explicit title");
  expect(rendered).not.toContain("Entfernt");
});

test("one changed email subject is shown under its name without dumping template records", () => {
  const base = {
    templates: [
      {
        id: 1,
        slug: "verification",
        name: "Confirmation message",
        subject: "Original subject",
        html_body: "Unchanged body",
        updated_at: "Timestamp",
      },
    ],
  };
  const changed = structuredClone(base);
  changed.templates[0].subject = "New subject";
  const rendered = compare(base, changed);
  expect(rendered).toContain("Confirmation message · Betreff");
  expect(rendered).toContain("Original subject");
  expect(rendered).toContain("New subject");
  expect(rendered).not.toContain("Unchanged body");
  expect(rendered).not.toContain("updated_at");
});
