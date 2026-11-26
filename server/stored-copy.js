// Stored copy. A site stores a value for every text of its letter, the
// unedited ones too, so the admin can edit each one. This module says in what
// form a value is stored, when a stored value is valid, and how a start of
// the server brings one language's stored copy in line with the letter as it
// is deployed now.
//
// A start changes a stored text only for a reason it records, so it changes
// it once:
//   - The text still is what was its default, and the default changed. Each
//     field's default is recorded as a short mark (`defaults`).
//   - The form asks for other optional fields than the privacy policy has
//     been given statements about (`statements`).
//   - The site last ran a version that recorded nothing. STEPS make up for
//     what that version's texts lack, each of them once (`steps`).
// One change needs no record, because it cannot be made twice: a sentence of
// an earlier default policy that no default says any more is taken out
// wherever it stands (earlierCountSentences).
// Text is added to a privacy policy in the language decided for it once
// (`policyLanguage`). These four make up the site's record, which is kept
// with its publications (server/publications.js), each by language: a
// language the letter was without when the others were brought in line has
// it all still to come. A site with no record is one from before.
import { createHash } from "node:crypto";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanValue, getPath } from "../config/editable.js";
import { multiLanguage } from "../config/i18n.js";
import { PREVIOUS_UI_DEFAULTS, uiDefaults } from "../config/ui.js";
import {
  AFTER_FIELD_STATEMENTS,
  COUNT_STATEMENTS,
  DefaultPrivacyBody,
  FIELD_CLAUSES,
  adminLogPrivacy,
  blockedAddressPrivacy,
  disclosureLanguages,
  earlierCountSentences,
  earlierFieldClauses,
  fieldDisclosures,
  handEntryPrivacy,
  outdatedPrivacyWording,
} from "../config/privacy-content.jsx";
import { ValidationError } from "../config/validation.js";
import {
  RICH_LIMIT,
  missingPlaceholders,
  preservePlaceholders,
  sanitizeHtml,
  sanitizeRich,
} from "./rich-content.js";

const POLICY = "legal.privacyHtml";
const PARAGRAPH = /<p\b[^>]*>[\s\S]*?<\/p>/gi;

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A copy value in the form a publication stores it: checked against its
// field's type, and with HTML sanitized, which writes "<br>" as "<br />" and
// an apostrophe as itself. A stored value is its own stored form.
function storedForm(field, value) {
  return field.type === "html" && typeof value === "string"
    ? sanitizeHtml(value)
    : cleanValue(field, value);
}

// The stored form of a value its field accepts. Throws for any other value.
//
// A formatted text may be RICH_LIMIT characters long, both as it is typed and
// as it is stored: stored, every link has an attribute more. Two texts are
// accepted at any length. One is a text from a stored publication
// (`stored`): it was accepted once, or the server made it, and refusing it
// now would stop the start. The other is the letter's own text for the
// field, which a team that never edited it cannot be asked to shorten.
export function validCopy(field, value, { stored: fromStore = false } = {}) {
  const tooLong = (text) =>
    field.type === "html" &&
    !fromStore &&
    typeof text === "string" &&
    text.length > RICH_LIMIT &&
    text !== storedForm(field, field.default);
  const refuse = () => {
    throw new ValidationError(
      `${field.path}: höchstens ${RICH_LIMIT} Zeichen. Gezählt wird der Text, wie er gespeichert wird.`,
    );
  };
  if (tooLong(value)) refuse();
  const stored = storedForm(field, value);
  if (tooLong(stored)) refuse();
  if (typeof stored === "string") preservePlaceholders(field.default, stored);
  return stored;
}

// `value` with the parts of its field's default that carry the placeholders
// it lacks: paragraphs of a formatted text, sentences of any other. Null when
// the default has no such part to add, or is nothing but such parts.
function withMissingPlaceholders(field, value) {
  const formatted = field.type === "html";
  const missing = missingPlaceholders(field.default, value);
  const parts = formatted
    ? String(field.default).match(PARAGRAPH) || []
    : String(field.default).split(/(?<=[.!?])\s+/);
  const carrying = parts.filter((part) =>
    missing.some((token) => part.includes(token)),
  );
  if (!carrying.length) return null;
  if (formatted) return value + carrying.join("");
  return carrying.length < parts.length
    ? `${value} ${carrying.join(" ")}`
    : null;
}

// A stored value as its field accepts it now, in its stored form. A stored
// value was valid when it was published, so only a changed default makes it
// invalid: the default gained a placeholder, or is of another type. The value
// then gains the parts of the default that carry the placeholder. Where that
// cannot make it valid, the default takes its place.
export function repairedCopy(field, value) {
  const accepted = (candidate) => {
    try {
      return [validCopy(field, candidate, { stored: true })];
    } catch {
      return null;
    }
  };
  const completed =
    typeof value === "string" ? withMissingPlaceholders(field, value) : null;
  const [repaired] = accepted(value) ||
    (completed !== null && accepted(completed)) || [
      storedForm(field, field.default),
    ];
  return repaired;
}

// A stored value in its stored form, or as it is when it has none.
export function storedOrAsItIs(field, value) {
  try {
    return storedForm(field, value);
  } catch {
    return value;
  }
}

// A stored value that still is what was the field's default was never edited,
// and follows the default when the letter's config or the platform changes
// it. A stored value that differs from the recorded default is the team's
// text and stays. Marks are of the stored form, since that is what a stored
// value is compared with.
const markOf = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 22);

const defaultMarks = (fields) =>
  Object.fromEntries(
    fields.map((field) => [
      field.path,
      markOf(storedForm(field, field.default)),
    ]),
  );

// For a site from before: the defaults a field is known to have had. The
// letter lists its own in `previousDefaults`. An interface text had the
// platform's wording, now or earlier, until the letter set its own. That was
// the German wording while the letter had one language. A letter with several
// languages may have had one language when the text was stored, so both
// wordings count for it.
function earlierDefaults(config, lang, path) {
  const own = config.previousDefaults?.[path] || [];
  if (!path.startsWith("ui.")) return own;
  const tables = [...new Set(["de", ...(multiLanguage(config) ? [lang] : [])])];
  return [
    ...own,
    ...tables
      .filter((table) => table in PREVIOUS_UI_DEFAULTS)
      .flatMap((table) => [
        getPath({ ui: uiDefaults(table) }, path),
        ...(PREVIOUS_UI_DEFAULTS[table][path] || []),
      ]),
  ];
}

// Whether `value` would be stored as `stored`. An earlier default comes from
// a list someone keeps by hand and need not even fit the field.
function storesAs(field, value, stored) {
  try {
    return sameValue(storedForm(field, value), stored);
  } catch {
    return false;
  }
}

function followDefaults(copy, { lang, fields, config, record }, reasons) {
  const marks = record?.defaults?.[lang] || {};
  const fromBefore = !record?.steps?.[lang]?.includes("earlier-defaults");
  for (const field of fields) {
    if (!(field.path in copy)) continue;
    const stored = copy[field.path];
    if (sameValue(stored, storedForm(field, field.default))) continue;
    const wasDefault =
      field.path in marks
        ? markOf(stored) === marks[field.path]
        : fromBefore &&
          earlierDefaults(config, lang, field.path).some((earlier) =>
            storesAs(field, earlier, stored),
          );
    if (!wasDefault) continue;
    copy[field.path] = structuredClone(field.default);
    reasons[field.path] = "default";
  }
}

// Text as a stored policy holds it: escaped, then sanitized like the policy.
const storedText = (text) =>
  sanitizeRich(renderToStaticMarkup(createElement(Fragment, null, text)));

const swap = (html, from, to) => html.replace(from, () => to);

// The platform's default policy as a site stores it.
const platformPolicy = (config) =>
  sanitizeRich(
    renderToStaticMarkup(createElement(DefaultPrivacyBody, { config })),
  );

// The language of a privacy policy, for text the server adds to it. It is
// decided once, when the server first sees the policy, and then kept in the
// record. A policy that still has a whole paragraph of the platform's default
// is in that default's language, which is German for every letter. Any other
// policy is taken to be in the language of its page, or in German where the
// added text has no translation. A paragraph that only carries a placeholder
// does not count as the default's: a policy of the team's own has to carry it
// too. The letter can state the language as `legal.privacyLanguage`, and what
// it states always holds. A policy that is the letter's own default is in
// that default's language (letterPolicy).
function policyLanguage(html, { lang, config, record }) {
  const decided =
    config.legal?.privacyLanguage || record?.policyLanguage?.[lang];
  if (decided) return decided;
  const itsOwn = (paragraph) =>
    paragraph.replace(/<[^>]+>|\{\{\w+\}\}/g, "").trim().length > 40;
  if (
    platformPolicy(config)
      .match(PARAGRAPH)
      .some((paragraph) => itsOwn(paragraph) && html.includes(paragraph))
  )
    return "de";
  return disclosureLanguages.includes(lang) ? lang : "de";
}

// Per language: where the default's paragraph about storing signatures ends,
// where the block paragraph ends, and the words that show a policy already
// has the block and the hand-entry paragraph.
const POLICY_MARKS = {
  de: {
    signaturesEnd: "Bestätigungslink abgelaufen ist.</p>",
    blockEnd: "deine Adresse zu Unrecht gesperrt ist, schreib uns.</p>",
    block: "Prüfsumme",
    handEntry: "von Hand ein",
  },
  // No English default exists, so there is no signatures paragraph to find.
  en: {
    signaturesEnd: null,
    blockEnd: "blocked by mistake, write to us.</p>",
    block: "fingerprint of the address",
    handEntry: "added by us by hand",
  },
};

// The step "admin-disclosures": a policy from before predates blocked
// addresses, the admin log, the newsletter consent mail and first signers
// added by hand, and gains all four. The block paragraph goes after the one
// about storing signatures, and the log paragraph after the block paragraph.
// Each goes at the end when the team rewrote the one before it. A paragraph
// the policy already has is left as the team wrote it.
function withAdminDisclosures(html, language) {
  // A sentence is replaced only where it still is an earlier default's, in
  // whichever language. The team's own wording stays; docs/publishing.md
  // tells them what its newsletter sentence has to say.
  for (const wording of disclosureLanguages)
    for (const [before, after] of outdatedPrivacyWording(wording))
      html = swap(html, before, after);
  const marks = POLICY_MARKS[language];
  const paragraph = (text) => `<p>${storedText(text)}</p>`;
  if (!html.includes(marks.block)) {
    const block = paragraph(
      blockedAddressPrivacy("{{signerRetentionYears}}", language),
    );
    html =
      marks.signaturesEnd && html.includes(marks.signaturesEnd)
        ? swap(html, marks.signaturesEnd, marks.signaturesEnd + block)
        : html + block;
  }
  const log = paragraph(adminLogPrivacy("{{adminLogDays}}", language));
  if (!html.includes("{{adminLogDays}}"))
    html = html.includes(marks.blockEnd)
      ? swap(html, marks.blockEnd, marks.blockEnd + log)
      : html + log;
  if (!html.includes(marks.handEntry)) {
    const handEntry = paragraph(handEntryPrivacy(language));
    html = html.includes(log)
      ? swap(html, log, log + handEntry)
      : html + handEntry;
  }
  return html;
}

// What a policy has been given about the form's optional fields, as the
// record keeps it per statement: `asked` says what the form asked for then,
// and `clause`, `sentence` and `text` are the wordings the statement was
// written in.
const givenStatements = (statements) =>
  Object.fromEntries(
    statements.map(({ id, asked, clause = null, sentence = null, text }) => [
      id,
      { asked, clause, sentence, text },
    ]),
  );

// `html` without one sentence: without the paragraph it had to itself, or
// without the space that set it apart.
const without = (html, sentence) =>
  [`<p>${sentence}</p>`, `${sentence} `, ` ${sentence}`, sentence].reduce(
    (result, part) => (result === html ? swap(html, part, "") : result),
    html,
  );

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The default's sentence at FIELD_CLAUSES[id] with a clause, or with none
// for null.
function clauseSentence(id, clause) {
  const [before, after] = FIELD_CLAUSES[id];
  return before + storedText(clause || "") + after;
}

// That sentence with the clause `next` in place of the clause `was`. Returns
// `html` as it is when the sentence does not stand there with `was`.
const withClause = (html, id, was, next) =>
  swap(html, clauseSentence(id, was), clauseSentence(id, next));

// Whether the two parts of that sentence stand in `html` with anything
// between them.
function hasClausePlace(html, id) {
  const [before, after] = FIELD_CLAUSES[id].map(literal);
  return new RegExp(`${before}[^.<]*${after}`).test(html);
}

// Where the default policy makes a statement: in its clause, or as a sentence
// before the next statement the policy holds, or before the sentence that
// follows them all. Returns `html` as it is when the team rewrote that place.
function placedInDefault(html, statement, later) {
  if (statement.clause)
    return withClause(html, statement.id, null, statement.clause);
  const next = [
    ...later.filter((other) => other.sentence).map((other) => other.sentence),
    AFTER_FIELD_STATEMENTS,
  ]
    .map(storedText)
    .find((sentence) => html.includes(sentence));
  return next
    ? swap(html, next, `${storedText(statement.sentence)} ${next}`)
    : html;
}

// A policy states what the letter stores and shows of the form's optional
// fields (fieldDisclosures). When the form asks for other fields than
// `given` says the policy was given statements about, the policy follows:
//   - A wording it was given for a statement that changed goes, and the
//     statement's wording of today takes its place when the form still asks
//     for it.
//   - A new statement goes where the default policy makes it while the
//     sentence around that place is still the default's, so an unedited
//     default becomes today's default. Otherwise the new statements go in
//     one paragraph at the end.
// A statement the policy already makes is left as it is, and so is one that
// did not change: the team may have put it in its own words since. `given`
// is null for a policy that was never given any, which is one from before:
// every statement is new to it. Where the default has a clause, such a policy
// may hold an earlier default's. That clause goes only when it is one a
// default wrote, word for word. A clause with other words in it has the
// team's wording, so it stays, and `unclear` says the team has to read the
// policy: the sentence may say what the form no longer does.
//
// A sentence an earlier default had about the counts, which no default says
// of this form, goes wherever it stands and whatever `given` says: the policy
// may be from before, or an old draft may have brought the sentence back. The
// statements that took its place are then made where the policy lacks them.
// Returns the policy, what it has been given now, and `unclear`.
export function withFieldStatements(html, config, language, given = null) {
  const german = language === "de";
  const asked = fieldDisclosures(config, language);
  const now = givenStatements(asked);
  const asksOther = (id) => !given || given[id]?.asked !== now[id]?.asked;
  const makes = (id) =>
    asked.some(
      (statement) =>
        statement.id === id && html.includes(storedText(statement.mark)),
    );
  let unclear = false;
  const ids = [
    ...new Set([
      ...Object.keys(FIELD_CLAUSES),
      ...Object.keys(given || {}),
      ...Object.keys(now),
    ]),
  ];
  for (const id of ids.filter(asksOther)) {
    const before = given?.[id];
    if (id in FIELD_CLAUSES && given)
      // A clause the policy was given goes in the words it was given in,
      // whatever language text is added in now.
      html = withClause(html, id, before?.clause ?? null, null);
    else if (id in FIELD_CLAUSES && !makes(id)) {
      const earlier = earlierFieldClauses(id, config).find((clause) =>
        html.includes(clauseSentence(id, clause)),
      );
      if (earlier !== undefined) html = withClause(html, id, earlier, null);
      else unclear ||= hasClausePlace(html, id);
    }
    for (const form of ["sentence", "text"]) {
      if (!before?.[form]) continue;
      if (form === "text" && before.text === before.sentence) continue;
      const was = storedText(before[form]);
      html = now[id]?.[form]
        ? swap(html, was, storedText(now[id][form]))
        : without(html, was);
    }
  }
  const withoutEarlier = earlierCountSentences(config).reduce(
    (result, sentence) => without(result, storedText(sentence)),
    html,
  );
  const hadEarlier = withoutEarlier !== html;
  html = withoutEarlier;
  const changed = (id) =>
    asksOther(id) || (hadEarlier && COUNT_STATEMENTS.includes(id));

  const added = [];
  asked.forEach((statement, index) => {
    if (!changed(statement.id) || html.includes(storedText(statement.mark)))
      return;
    const placed = german
      ? placedInDefault(html, statement, asked.slice(index + 1))
      : html;
    if (placed === html) added.push(statement.text);
    else html = placed;
  });
  if (added.length) html += `<p>${added.map(storedText).join(" ")}</p>`;
  return {
    html,
    statements: Object.fromEntries(
      Object.keys(now).map((id) => [id, changed(id) ? now[id] : given[id]]),
    ),
    unclear,
  };
}

// The privacy policy a letter starts from, as a site stores it: `html`, the
// `language` text is added to it in, and the `statements` it makes about the
// form's fields.
//
// A letter without a policy of its own has the platform's default, which is
// German and makes every statement itself. A letter that supplies one as
// `legal.privacyHtml` gets what a policy of a team's own gets: the paragraphs
// on blocked addresses, the admin log and first signers added by hand, and
// the statements about the form's fields, as far as it lacks them. The
// letter's default is its own policy with these. A site whose team never
// edited the policy therefore follows the config when the policy or the form
// changes.
export function letterPolicy(config, lang) {
  const platform = platformPolicy(config);
  const own = sanitizeHtml(config.legal?.privacyHtml || platform);
  if (own === platform)
    return {
      html: platform,
      language: config.legal?.privacyLanguage || "de",
      statements: givenStatements(fieldDisclosures(config, "de")),
    };
  const language = policyLanguage(own, { lang, config, record: null });
  const { html, statements } = withFieldStatements(
    withAdminDisclosures(own, language),
    config,
    language,
  );
  return { html, language, statements };
}

// What a site from before lacks, as steps that each run once per language.
const STEPS = ["earlier-defaults", "admin-disclosures"];

// The record of a site whose last version kept only a mark of every default,
// by language. That version went over the stored copy at each of its starts,
// so the languages it knew have had every step. It kept nothing about the
// statements of a privacy policy, which it found by their text.
export const recordFromDefaultMarks = (marks) => ({
  steps: Object.fromEntries(Object.keys(marks).map((lang) => [lang, STEPS])),
  defaults: marks,
});

// One language's stored copy, brought in line with the letter. `record` is
// the site's record, or null for a site from before. Changes `copy`. Returns
// why each changed text changed (`reasons`, by path), this language's part of
// the next record, and what the team has to look at in a privacy policy it
// edited (`notices`):
//   "review"   its default has changed since, and nothing in it was changed
//   "wording"  a sentence of the default about the form's fields holds the
//              team's words and was left as it is
//   "length"   it has no room for what the server would add, and was left as
//              it is
export function upgradeCopy(copy, { lang, fields, config, record }) {
  const reasons = {};
  const notices = [];
  followDefaults(copy, { lang, fields, config, record }, reasons);
  // A field the letter does not have for now keeps its mark for its return.
  const next = {
    steps: STEPS,
    defaults: { ...record?.defaults?.[lang], ...defaultMarks(fields) },
  };
  const policy = fields.find((field) => field.path === POLICY);
  if (policy && typeof copy[POLICY] === "string") {
    const standard = storedForm(policy, policy.default);
    const stored = copy[POLICY];
    if (sanitizeHtml(stored) === standard) {
      const letter = letterPolicy(config, lang);
      next.policyLanguage = letter.language;
      next.statements = letter.statements;
    } else {
      next.policyLanguage = policyLanguage(stored, { lang, config, record });
      const upgraded = withFieldStatements(
        record?.steps?.[lang]?.includes("admin-disclosures")
          ? stored
          : withAdminDisclosures(stored, next.policyLanguage),
        config,
        next.policyLanguage,
        record?.statements?.[lang] ?? null,
      );
      next.statements = upgraded.statements;
      const recorded = record?.defaults?.[lang]?.[POLICY];
      if (upgraded.html.length > Math.max(RICH_LIMIT, stored.length))
        // The team could not publish the longer policy either. What it was
        // to be given counts as given, so the team is told once.
        notices.push("length");
      else if (upgraded.html !== stored) {
        copy[POLICY] = upgraded.html;
        // A policy that now is today's default was the default of its day.
        reasons[POLICY] = upgraded.html === standard ? "default" : "policy";
      } else if (recorded !== undefined && recorded !== markOf(standard))
        notices.push("review");
      if (upgraded.unclear) notices.push("wording");
    }
  }
  return { reasons, notices, record: next };
}
