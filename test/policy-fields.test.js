// A stored privacy policy and the optional fields of the form: a policy
// published before the letter asked for a field gains what the letter now
// stores and shows of it.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import example from "../config/letters/example/index.js";
import {
  AFTER_FIELD_STATEMENTS,
  DefaultPrivacyBody,
} from "../config/privacy-content.jsx";
import {
  initialDocument,
  upgradeStoredDocument,
} from "../server/publications.js";
import { withFieldStatements } from "../server/stored-copy.js";
import { sanitizeRich } from "../server/rich-content.js";
import { DEFAULT_LANG } from "../config/letter.config.js";

// The example letter with other fields and public details.
function letter({ role = false, ...features }) {
  const config = structuredClone(example);
  config.features = {
    ...config.features,
    kreisverbandField: false,
    stateResolution: false,
    occupationField: false,
    publicSignerDetails: false,
    publicFirstSignerDetails: false,
    ...features,
  };
  config.sign.fields.occupation.label = "Beruf";
  if (role) config.sign.fields.signerFunction.label = "Funktion";
  else delete config.sign.fields.signerFunction;
  return config;
}
// The default policy as a site stores it. The section on the map service
// that resolves a region's state is not a statement about a field. A stored
// policy does not gain it here.
const defaultPolicy = (config) =>
  sanitizeRich(
    renderToStaticMarkup(createElement(DefaultPrivacyBody, { config })),
  ).replace(
    /<p><strong>\w\) Ermittlung des Bundeslandes<\/strong>.*?<\/p>/,
    "",
  );
// A policy that was never given a statement gains the ones the letter asks
// for.
const reconcileFieldDisclosures = (html, config, language) =>
  withFieldStatements(html, config, language).html;

const plain = letter({});
const LETTERS = {
  "a region": letter({ kreisverbandField: true }),
  "a region with its state": letter({
    kreisverbandField: true,
    stateResolution: true,
  }),
  "an occupation": letter({ occupationField: true }),
  "an occupation and a role": letter({ occupationField: true, role: true }),
  "an occupation and a role that signers may show": letter({
    occupationField: true,
    role: true,
    publicSignerDetails: true,
  }),
  "a region, an occupation and a role that signers may show": letter({
    kreisverbandField: true,
    stateResolution: true,
    occupationField: true,
    role: true,
    publicSignerDetails: true,
  }),
  "a role that first signers may show": letter({
    role: true,
    publicFirstSignerDetails: true,
  }),
};

describe("the default policy of a letter that asked for no optional field", () => {
  for (const [fields, config] of Object.entries(LETTERS))
    test(`says what today's default says once the letter asks for ${fields}`, () => {
      const upgraded = reconcileFieldDisclosures(
        defaultPolicy(plain),
        config,
        "de",
      );
      expect(upgraded).toBe(defaultPolicy(config));
      expect(reconcileFieldDisclosures(upgraded, config, "de")).toBe(upgraded);
    });

  test("stays as it is while the letter asks for none", () => {
    expect(reconcileFieldDisclosures(defaultPolicy(plain), plain, "de")).toBe(
      defaultPolicy(plain),
    );
  });
});

// The form changes after the policy was given its statements: every pair of
// letters, in both directions.
describe("when the form asks for other fields, the default policy of the letter before becomes the default policy of the letter now", () => {
  const letters = { "no optional field": plain, ...LETTERS };
  for (const [from, before] of Object.entries(letters))
    for (const [to, now] of Object.entries(letters)) {
      if (from === to) continue;
      test(`from ${from} to ${to}`, () => {
        const given = withFieldStatements(
          defaultPolicy(before),
          before,
          "de",
        ).statements;
        const upgraded = withFieldStatements(
          defaultPolicy(before),
          now,
          "de",
          given,
        );
        expect(upgraded.html).toBe(defaultPolicy(now));
        expect(
          withFieldStatements(upgraded.html, now, "de", upgraded.statements)
            .html,
        ).toBe(upgraded.html);
      });
    }
});

test("a default from before, on a letter where signers now choose their details, no longer says a public name shows the region", () => {
  const before = letter({
    kreisverbandField: true,
    stateResolution: true,
    occupationField: true,
  });
  const now = letter({
    kreisverbandField: true,
    stateResolution: true,
    occupationField: true,
    publicSignerDetails: true,
  });
  // As the released version worded the counts.
  const released = defaultPolicy(before).replace(
    "Für diese Unterschriften veröffentlichen wir die Anzahl je Angabe im Feld „Beruf“, getrennt von den Namen.",
    "Berufsangaben dieser Unterschriften werden nur als Anzahl je Beruf veröffentlicht, nicht zusammen mit dem Namen.",
  );
  expect(released).toContain(
    "dein Name, dein Kreisverband und das daraus ermittelte Bundesland sowie",
  );
  expect(released).toContain("Berufsangaben dieser Unterschriften");

  expect(withFieldStatements(released, now, "de").html).toBe(
    defaultPolicy(now),
  );
});

test("a field label with a full stop is found again when the label changes", () => {
  const before = letter({ occupationField: true });
  before.sign.fields.occupation.label = "Org. unit";
  const now = letter({ occupationField: true });
  now.sign.fields.occupation.label = "Department";
  const given = withFieldStatements(defaultPolicy(before), before, "de");
  expect(given.html).toBe(defaultPolicy(before));
  expect(
    withFieldStatements(given.html, now, "de", given.statements).html,
  ).toBe(defaultPolicy(now));
});

test("a statement the team put in its own words is not added again when another statement changes", () => {
  const before = letter({ occupationField: true });
  const now = letter({ occupationField: true, kreisverbandField: true });
  const own =
    "<p>Wir speichern deinen Namen und, wenn du magst, deinen Beruf.</p>";
  const first = withFieldStatements(own, before, "de");
  expect(first.html).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Beruf. Für Unterschriften, deren Name öffentlich angezeigt wird, veröffentlichen wir die Anzahl je Angabe im Feld „Beruf“, getrennt von den Namen.</p>`,
  );
  // The team merges the added paragraph into its own sentences.
  const merged = `${own}<p>Wie viele Menschen welchen Beruf angeben, zeigen wir ohne Namen.</p>`;

  const second = withFieldStatements(merged, now, "de", first.statements);
  expect(second.html).toBe(
    `${merged}<p>Zu deiner Unterschrift speichern wir außerdem optional Kreisverband und Beruf. Wenn dein Name öffentlich angezeigt wird, erscheint in der Liste auch dein Kreisverband.</p>`,
  );
  expect(
    withFieldStatements(second.html, now, "de", second.statements).html,
  ).toBe(second.html);
});

test("a statement that was added at the end changes there when the form changes, and goes when the form drops it", () => {
  const own = "<p>Wir speichern deinen Namen.</p>";
  const before = letter({ occupationField: true });
  const first = withFieldStatements(own, before, "de");
  expect(first.html).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Beruf. Für Unterschriften, deren Name öffentlich angezeigt wird, veröffentlichen wir die Anzahl je Angabe im Feld „Beruf“, getrennt von den Namen.</p>`,
  );

  const renamed = letter({ occupationField: true });
  renamed.sign.fields.occupation.label = "Tätigkeit";
  const second = withFieldStatements(
    first.html,
    renamed,
    "de",
    first.statements,
  );
  expect(second.html).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Tätigkeit. Für Unterschriften, deren Name öffentlich angezeigt wird, veröffentlichen wir die Anzahl je Angabe im Feld „Tätigkeit“, getrennt von den Namen.</p>`,
  );

  const third = withFieldStatements(
    second.html,
    letter({}),
    "de",
    second.statements,
  );
  expect(third.html).toBe(own);
});

test("the sentence an earlier default had about occupations becomes today's", () => {
  const config = LETTERS["an occupation"];
  const today = defaultPolicy(config);
  const counts =
    "Für diese Unterschriften veröffentlichen wir die Anzahl je Angabe im Feld „Beruf“, getrennt von den Namen.";
  expect(today).toContain(counts);
  const earlier = today.replace(
    counts,
    "Berufsangaben dieser Unterschriften werden nur als Anzahl je Beruf veröffentlicht, nicht zusammen mit dem Namen.",
  );
  expect(reconcileFieldDisclosures(earlier, config, "de")).toBe(today);
});

test("a letter where signers choose their details no longer says the counts cover every public name", () => {
  const config = LETTERS["an occupation and a role that signers may show"];
  const everyone =
    "Für diese Unterschriften veröffentlichen wir die Anzahl je Angabe in den Feldern „Beruf“ und „Funktion“, getrennt von den Namen.";
  const earlier = defaultPolicy(
    letter({ occupationField: true, role: true }),
  ).replace("Beim Mitzeichnen", "Beim Unterzeichnen");
  expect(earlier).toContain(everyone);

  const upgraded = reconcileFieldDisclosures(earlier, config, "de");
  expect(upgraded).not.toContain(everyone);
  expect(upgraded).toContain(
    "Die Anzahl je Angabe in den Feldern „Beruf“ und „Funktion“ veröffentlichen wir, getrennt von den Namen, nur für Unterschriften, bei denen der öffentlichen Anzeige dieser Angaben zugestimmt wurde.",
  );
});

test("a German policy whose sentences the team rewrote gains the statements in a paragraph at the end, once", () => {
  const config =
    LETTERS["a region, an occupation and a role that signers may show"];
  const own =
    "<h4>Datenschutz</h4><p>Wir speichern deinen Namen. Rechtsgrundlage ist deine Einwilligung.</p>";
  const upgraded = reconcileFieldDisclosures(own, config, "de");
  expect(upgraded).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Kreisverband und Beruf und Funktion. Wenn du der öffentlichen Anzeige von Funktion und Organisation zugestimmt hast, zeigen wir diese Angaben neben deinem Namen. Nur dann erscheinen auch dein Kreisverband und das daraus ermittelte Bundesland in der Liste. Die Anzahl je Angabe in den Feldern „Beruf“ und „Funktion“ veröffentlichen wir, getrennt von den Namen, nur für Unterschriften, bei denen der öffentlichen Anzeige dieser Angaben zugestimmt wurde.</p>`,
  );
  expect(reconcileFieldDisclosures(upgraded, config, "de")).toBe(upgraded);

  const withName = letter({
    kreisverbandField: true,
    occupationField: true,
  });
  expect(reconcileFieldDisclosures(own, withName, "de")).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Kreisverband und Beruf. Wenn dein Name öffentlich angezeigt wird, erscheint in der Liste auch dein Kreisverband. Für Unterschriften, deren Name öffentlich angezeigt wird, veröffentlichen wir die Anzahl je Angabe im Feld „Beruf“, getrennt von den Namen.</p>`,
  );
});

test("a policy in English gains the statements in English, once", () => {
  const own = "<h4>Privacy</h4><p>We keep your name under the GDPR.</p>";
  const details = reconcileFieldDisclosures(
    own,
    LETTERS["a region, an occupation and a role that signers may show"],
    "en",
  );
  expect(details).toBe(
    `${own}<p>With your signature we also store these optional details: Kreisverband and Beruf and Funktion. If you agreed to your role and organisation being shown publicly, we show them next to your name. Only then does the list also show your Kreisverband and the federal state derived from it. We publish how many signatures gave each entry in the fields “Beruf” and “Funktion”, separately from the names, only for signatures whose details are shown publicly.</p>`,
  );
  expect(
    reconcileFieldDisclosures(
      details,
      LETTERS["a region, an occupation and a role that signers may show"],
      "en",
    ),
  ).toBe(details);

  expect(
    reconcileFieldDisclosures(
      own,
      letter({ kreisverbandField: true, occupationField: true }),
      "en",
    ),
  ).toBe(
    `${own}<p>With your signature we also store these optional details: Kreisverband and Beruf. When your name is shown publicly, the list also shows your Kreisverband. For signatures whose name is shown publicly, we publish how many gave each entry in the field “Beruf”, separately from the names.</p>`,
  );
  expect(
    reconcileFieldDisclosures(
      own,
      LETTERS["a role that first signers may show"],
      "en",
    ),
  ).toBe(
    `${own}<p>With your signature we also store these optional details: Funktion. For first signers who agreed to publication, we also show role and organisation next to the name.</p>`,
  );
});

test("a field label with a character HTML escapes is found again on the next load", () => {
  const config = letter({ occupationField: true });
  config.sign.fields.occupation.label = "Beruf & Verband";
  const own = "<p>Wir speichern deinen Namen. Rechtsgrundlage ist …</p>";
  const upgraded = reconcileFieldDisclosures(own, config, "de");
  expect(upgraded).toContain("optional Beruf &amp; Verband.");
  expect(reconcileFieldDisclosures(upgraded, config, "de")).toBe(upgraded);
  expect(reconcileFieldDisclosures(defaultPolicy(config), config, "de")).toBe(
    defaultPolicy(config),
  );
});

test("the example letter: a policy published before it asked for an organisation and a role is today's default after loading", () => {
  const today = sanitizeRich(
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"],
  );
  expect(today).toContain("sowie optional Organisation und Role gespeichert.");
  const before = structuredClone(example);
  before.features = {
    ...before.features,
    occupationField: false,
    publicSignerDetails: false,
  };
  delete before.sign.fields.signerFunction;
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] =
    defaultPolicy(before);
  expect(stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).not.toContain(
    "Organisation und Role",
  );

  expect(
    upgradeStoredDocument(stored, null).document.locales[DEFAULT_LANG].copy[
      "legal.privacyHtml"
    ],
  ).toBe(today);
});

test("when added text is to be English from now on, the German clause the policy was given still goes", () => {
  const before = letter({ kreisverbandField: true });
  const now = letter({ kreisverbandField: true, publicSignerDetails: true });
  const own = "<p>Our additional English information.</p>";
  const given = withFieldStatements(defaultPolicy(before), before, "de");
  expect(given.html).toContain(
    "erscheinen dein Name, dein Kreisverband sowie das Datum",
  );

  const upgraded = withFieldStatements(
    given.html + own,
    now,
    "en",
    given.statements,
  ).html;
  expect(upgraded).toContain("erscheinen dein Name sowie das Datum");
  expect(upgraded).toEndWith(
    `${own}<p>If you agreed to your role and organisation being shown publicly, we show them next to your name. Only then does the list also show your Kreisverband.</p>`,
  );
});

const RELEASED_COUNTS =
  "Berufsangaben dieser Unterschriften werden nur als Anzahl je Beruf veröffentlicht, nicht zusammen mit dem Namen.";

test("the released default's sentence about occupation counts goes, also while the form asks for no occupation", () => {
  const own = "<p>The team answers all requests.</p>";
  const released =
    defaultPolicy(LETTERS["an occupation"]).replace(
      "Für diese Unterschriften veröffentlichen wir die Anzahl je Angabe im Feld „Beruf“, getrennt von den Namen.",
      RELEASED_COUNTS,
    ) + own;
  expect(released).toContain(RELEASED_COUNTS);

  const without = withFieldStatements(released, plain, "de");
  expect(without.html).toBe(defaultPolicy(plain) + own);
  // The form asks for the occupation again, and for consent to show it.
  const now = LETTERS["an occupation and a role that signers may show"];
  expect(
    withFieldStatements(without.html, now, "de", without.statements).html,
  ).toBe(defaultPolicy(now) + own);
});

test("the released sentence about occupation counts goes from a policy that is on record as up to date", () => {
  const now = LETTERS["an occupation and a role that signers may show"];
  const today = defaultPolicy(now);
  const given = withFieldStatements(today, now, "de").statements;
  // As when an old draft of the policy was published over the current one.
  const stale = today.replace(
    AFTER_FIELD_STATEMENTS,
    `${RELEASED_COUNTS} ${AFTER_FIELD_STATEMENTS}`,
  );
  expect(stale).toContain(RELEASED_COUNTS);
  expect(withFieldStatements(stale, now, "de", given).html).toBe(today);
});

const policyChanges = (changes) =>
  changes.filter(({ path }) => path === "legal.privacyHtml");

test("words the team put into the default's sentence about stored details stay when a site from before is upgraded", () => {
  const today = sanitizeRich(
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"],
  );
  const own = today.replace(
    "Role gespeichert.",
    "Role nach Prüfung durch unser Team gespeichert.",
  );
  expect(own).not.toBe(today);
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = own;

  const { document, changes } = upgradeStoredDocument(stored, null);
  expect(document.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toBe(own);
  expect(policyChanges(changes)).toEqual([]);
});

test("a sentence of the default that names other fields in the team's words stays, the statement goes to the end, and the team is asked to read the policy", () => {
  const today = sanitizeRich(
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"],
  );
  const own = today.replace(
    " sowie optional Organisation und Role gespeichert.",
    " sowie optional Kreisverband und Beruf nach Prüfung durch unser Team gespeichert.",
  );
  expect(own).not.toBe(today);
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = own;

  const { document, changes } = upgradeStoredDocument(stored, null);
  expect(document.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Organisation und Role.</p>`,
  );
  expect(policyChanges(changes)).toEqual([
    { lang: DEFAULT_LANG, path: "legal.privacyHtml", change: "policy" },
    { lang: DEFAULT_LANG, path: "legal.privacyHtml", change: "wording" },
  ]);
});
