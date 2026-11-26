import { ValidationError } from "../config/validation.js";
import { themeIssues } from "../config/theme-validation.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  DefaultPrivacyBody,
  disclosureLanguages,
} from "../config/privacy-content.jsx";
import { contentFor } from "../config/content.jsx";
import { migrateFaq } from "../config/faq.js";
import cfg, {
  LANGUAGES,
  DEFAULT_LANG,
  configFor,
} from "../config/letter.config.js";
import { editableFields, setPath } from "../config/editable.js";
import { pageCopy } from "./pages.js";
import {
  PUBLICATION_VERSION,
  PUCK_VERSION,
  defaultLayout,
  migrateLayout,
  validateLayout,
  resolvedMetadata,
} from "../config/publication.js";
import { validateCss } from "../config/css-policy.js";
import { sanitizeRich } from "./rich-content.js";
import {
  letterPolicy,
  recordFromDefaultMarks,
  repairedCopy,
  sameValue,
  storedOrAsItIs,
  upgradeCopy,
  validCopy,
} from "./stored-copy.js";
import { assetPath, publicationAssetPaths } from "./assets.js";
import { createAssetLifecycle } from "./asset-lifecycle.js";
import { recordAdminAction } from "../db/admin-actions.js";
import { systemTemplateBase } from "../config/template-localization.js";
import { protectedTemplateTokens } from "../config/template-placeholders.js";

export class RevisionConflict extends Error {
  constructor(revision) {
    super(
      "This has changed since you opened it. Your local changes are retained; reload the current publication to reconcile them.",
    );
    this.status = 409;
    this.revision = revision;
  }
}

for (const lang of LANGUAGES) {
  const { legal } = configFor(lang);
  if (
    legal.privacyLanguage !== undefined &&
    !disclosureLanguages.includes(legal.privacyLanguage)
  )
    throw new Error(
      `legal.privacyLanguage must be one of: ${disclosureLanguages.join(", ")}`,
    );
  // A policy the letter supplies is completed (letterPolicy).
  legal.privacyHtml = legal.privacyHtml
    ? letterPolicy(configFor(lang), lang).html
    : renderToStaticMarkup(
        createElement(DefaultPrivacyBody, { config: configFor(lang) }),
      );
}
const pristine = Object.fromEntries(
  LANGUAGES.map((lang) => [lang, structuredClone(configFor(lang))]),
);

function allCopyFields(config, lang) {
  const fields = editableFields(config, pageCopy(config, lang));
  const paths = new Set(fields.map((f) => f.path));
  function add(node, prefix) {
    for (const [key, value] of Object.entries(node || {})) {
      const path = `${prefix}.${key}`;
      if (typeof value === "string" && !paths.has(path)) {
        fields.push({
          path,
          type: /Html$/.test(key) ? "html" : "textarea",
          group: prefix,
          default: value,
        });
        paths.add(path);
      } else if (
        Array.isArray(value) &&
        value.every((v) => typeof v === "string") &&
        !paths.has(path)
      ) {
        fields.push({ path, type: "list", group: prefix, default: value });
        paths.add(path);
      } else if (value && !Array.isArray(value) && typeof value === "object")
        add(value, path);
    }
  }
  for (const key of ["brand", "legal", "zoom"]) add(config[key], key);
  return fields.filter(
    (f) =>
      !["brand.lang", "brand.locale", "legal.privacyLanguage"].includes(
        f.path,
      ) && !/eventAt|mapsUrl|joinLink|meetingUrl/.test(f.path),
  );
}

export const publicationFields = Object.fromEntries(
  LANGUAGES.map((l) => [l, allCopyFields(pristine[l], l)]),
);

export function initialDocument(templates = [], overrides = {}) {
  return {
    schemaVersion: PUBLICATION_VERSION,
    puckVersion: PUCK_VERSION,
    layout: defaultLayout(cfg),
    appearance: { theme: structuredClone(cfg.theme), css: "" },
    locales: Object.fromEntries(
      LANGUAGES.map((lang) => [
        lang,
        {
          copy: {
            ...Object.fromEntries(
              publicationFields[lang].map((f) => [f.path, f.default]),
            ),
            ...overrides[lang],
          },
          blocks: {
            brief: {
              html: renderToStaticMarkup(
                createElement(contentFor(lang).LetterArticle, { total: 0 }),
              )
                .replace(/^<article[^>]*>/, "")
                .replace(/<\/article>$/, "")
                .replace("and 0 signatories", "and {{total}} signatories"),
            },
            faq: migrateFaq({
              html: renderToStaticMarkup(
                createElement(contentFor(lang).FaqContent),
              ),
            }),
          },
        },
      ]),
    ),
    metadata: Object.fromEntries(LANGUAGES.map((l) => [l, {}])),
    templates,
    assets: [],
    analytics: { mode: "disabled" },
  };
}

export function migrateDocument(input) {
  const doc = structuredClone(input);
  if (doc.schemaVersion === 1 && doc.puckVersion === PUCK_VERSION) {
    for (const locale of Object.values(doc.locales || {})) {
      locale.blocks.faq = migrateFaq(locale.blocks.faq);
      let html = locale.copy["legal.privacyHtml"];
      if (html) {
        for (const [token, path] of [
          ["controllerName", "legal.entityName"],
          ["controllerContact", "legal.contactName"],
          ["controllerAddress", "legal.addressInline"],
          ["controllerEmail", "legal.contactEmail"],
        ]) {
          const placeholder = `{{${token}}}`;
          const value = String(locale.copy[path] || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
          if (value) html = html.split(value).join(placeholder);
          if (!html.includes(placeholder)) html += `<p>${placeholder}</p>`;
        }
        locale.copy["legal.privacyHtml"] = html;
      }
    }
    doc.schemaVersion = 2;
  }
  return doc;
}

// A stored document as this deployment can serve it: with the letter's
// languages, fields and sections as they are configured now, and with every
// text valid. What the config no longer has goes to an archive in the
// document and comes back when the config has it again. `upgrade`, given the
// language and its copy, may change texts before they are checked.
function adaptedDocument(input, upgrade) {
  const doc = migrateDocument(input);
  if (
    doc.schemaVersion !== PUBLICATION_VERSION ||
    doc.puckVersion !== PUCK_VERSION
  )
    throw new ValidationError("A publication migration is required");
  const defaults = initialDocument();
  doc.assets = publicationAssetPaths(doc);
  const archive = (doc.archive ||= { locales: {}, fields: {} });
  archive.locales ||= {};
  archive.fields ||= {};
  archive.sections ||= {};
  for (const [type, enabled] of [
    ["Faq", cfg.features.faq !== false],
    ["Meeting", cfg.features.zoomEvent],
  ]) {
    const index = doc.layout.content.findIndex(
      (section) => section.type === type,
    );
    if (!enabled && index !== -1) {
      archive.sections[type] = {
        block: doc.layout.content.splice(index, 1)[0],
        index,
      };
    } else if (enabled && index === -1) {
      const retired = archive.sections[type];
      const block =
        retired?.block ||
        defaults.layout.content.find((section) => section.type === type);
      const position = retired?.index ?? doc.layout.content.length - 1;
      doc.layout.content.splice(
        Math.max(2, Math.min(position, doc.layout.content.length - 1)),
        0,
        structuredClone(block),
      );
      delete archive.sections[type];
    }
  }
  doc.metadata ||= {};
  for (const lang of Object.keys(doc.locales || {})) {
    if (LANGUAGES.includes(lang)) continue;
    archive.locales[lang] = {
      ...doc.locales[lang],
      metadata: doc.metadata[lang] || {},
    };
    delete doc.locales[lang];
    delete doc.metadata[lang];
  }
  for (const lang of LANGUAGES) {
    if (!doc.locales[lang]) {
      const recovered = archive.locales[lang];
      doc.locales[lang] = recovered
        ? { copy: recovered.copy, blocks: recovered.blocks }
        : structuredClone(defaults.locales[lang]);
      doc.metadata[lang] = recovered?.metadata || {};
      delete archive.locales[lang];
    }
    const locale = doc.locales[lang];
    const retired = (archive.fields[lang] ||= {});
    const allowed = new Set(publicationFields[lang].map((field) => field.path));
    for (const [path, value] of Object.entries(locale.copy)) {
      if (allowed.has(path)) continue;
      retired[path] = value;
      delete locale.copy[path];
    }
    for (const field of publicationFields[lang]) {
      if (!(field.path in locale.copy))
        locale.copy[field.path] =
          retired[field.path] ?? structuredClone(field.default);
      delete retired[field.path];
    }
    upgrade?.(lang, locale.copy);
    for (const field of publicationFields[lang])
      locale.copy[field.path] = repairedCopy(field, locale.copy[field.path]);
  }
  return doc;
}

// A document nobody has stored yet, as this deployment can serve it.
export const conformStoredDocument = (input) => adaptedDocument(input);

// A stored document as this deployment serves it, with its copy brought in
// line with the letter (server/stored-copy.js). `record` is the record that
// goes with the document, or null for a document from before. Returns the
// document, the record that goes with it now, and what the team should know
// of, as { lang, path, change }, for every text the site already had that is
// another text now:
//   "default"      a text nobody edited follows its default
//   "policy"       an edited privacy policy was brought up to date
//   "placeholder"  the text gained a placeholder it lacked
//   "replaced"     its default had to replace it; `before` is what it said
// and after those, what the team has to look at in an edited privacy policy:
// the notices of upgradeCopy as `change`. `rewritten` says whether any text
// changed.
export function upgradeStoredDocument(input, record) {
  const next = {};
  const reasons = {};
  const notices = [];
  const document = adaptedDocument(input, (lang, copy) => {
    const upgraded = upgradeCopy(copy, {
      lang,
      fields: publicationFields[lang],
      config: pristine[lang],
      record,
    });
    reasons[lang] = upgraded.reasons;
    for (const change of upgraded.notices)
      notices.push({ lang, path: "legal.privacyHtml", change });
    for (const [part, value] of Object.entries(upgraded.record))
      next[part] = { ...record?.[part], ...next[part], [lang]: value };
  });
  // The texts the site had in a language: its copy, or what the document's
  // archive kept of it while the letter was without the language or a field.
  const had = (lang) => ({
    ...input.archive?.fields?.[lang],
    ...(input.locales?.[lang] ?? input.archive?.locales?.[lang])?.copy,
  });
  const changes = [];
  for (const lang of LANGUAGES) {
    const copy = document.locales[lang].copy;
    const fields = new Map(publicationFields[lang].map((f) => [f.path, f]));
    for (const [path, was] of Object.entries(had(lang))) {
      if (!(path in copy)) continue;
      const reason = reasons[lang][path];
      // Both in the form they are stored in: a text that is only written
      // another way now is the same text.
      if (sameValue(storedOrAsItIs(fields.get(path), was), copy[path]))
        continue;
      if (reason) changes.push({ lang, path, change: reason });
      else if (typeof was === "string" && String(copy[path]).startsWith(was))
        changes.push({ lang, path, change: "placeholder" });
      else
        changes.push({
          lang,
          path,
          change: "replaced",
          before: typeof was === "string" ? was : JSON.stringify(was),
        });
    }
  }
  return {
    document,
    record: next,
    changes: [...changes, ...notices],
    rewritten: changes.length > 0,
  };
}

function validateTheme(theme) {
  const issue = themeIssues(theme)[0];
  if (issue) throw new ValidationError(issue.message);
  const base = structuredClone(pristine[DEFAULT_LANG].theme);
  for (const group of ["colors", "fonts", "style"])
    base[group] = { ...base[group], ...theme?.[group] };
  return base;
}

// A document as a publication stores it, checked. `stored` says the document
// comes from a stored publication, which is never refused for its size: the
// server may have added to a document that was just within the limit.
export function cleanDocument(
  input,
  knownAssets = [],
  { stored: fromStore = false } = {},
) {
  if (
    !input ||
    input.schemaVersion !== PUBLICATION_VERSION ||
    input.puckVersion !== PUCK_VERSION
  )
    throw new ValidationError("A publication migration is required");
  if (!fromStore && JSON.stringify(input).length > 2000000)
    throw new ValidationError("Publication exceeds 2 MB");
  const doc = structuredClone(input);
  if (doc.archive) {
    const record = (value) =>
      value && typeof value === "object" && !Array.isArray(value);
    if (
      !record(doc.archive) ||
      Object.keys(doc.archive).some(
        (key) => !["locales", "fields", "sections"].includes(key),
      ) ||
      (doc.archive.sections &&
        (!record(doc.archive.sections) ||
          Object.entries(doc.archive.sections).some(
            ([type, entry]) =>
              !["Faq", "Meeting"].includes(type) ||
              !record(entry) ||
              !record(entry.block) ||
              entry.block.type !== type ||
              !Number.isInteger(entry.index) ||
              entry.index < 0 ||
              entry.index > 80,
          ))) ||
      !record(doc.archive.locales) ||
      !record(doc.archive.fields) ||
      Object.values(doc.archive.fields).some((fields) => !record(fields)) ||
      Object.values(doc.archive.locales).some(
        (locale) =>
          !record(locale) ||
          !record(locale.copy) ||
          !record(locale.blocks) ||
          !record(locale.metadata),
      )
    )
      throw new ValidationError("Invalid publication archive");
  }
  if (!Array.isArray(doc.assets) || doc.assets.length > 300)
    throw new ValidationError("Invalid assets");
  if (!Array.isArray(doc.templates) || doc.templates.length > 200)
    throw new ValidationError("Invalid templates");
  if (Object.keys(doc.locales || {}).some((l) => !LANGUAGES.includes(l)))
    throw new ValidationError("Unknown publication language");
  doc.layout = validateLayout(migrateLayout(doc.layout), cfg);
  doc.assets = [...new Set(doc.assets || [])];
  const requiredAssets = publicationAssetPaths(doc);
  if (requiredAssets.length > 300)
    throw new ValidationError("Invalid assets, including archived references");
  if (requiredAssets.some((a) => !knownAssets.includes(a)))
    throw new ValidationError("Unknown asset");
  doc.appearance = {
    theme: validateTheme(doc.appearance?.theme),
    css: validateCss(doc.appearance?.css || "", [
      ...doc.assets,
      "/signal-beige.png",
      "/signal-white.png",
      "/signal-red.png",
    ]),
  };
  if (!["disabled", "builtin", "external"].includes(doc.analytics?.mode))
    throw new ValidationError("Invalid analytics mode");
  doc.analytics = { mode: doc.analytics.mode };
  for (const lang of LANGUAGES) {
    const locale = doc.locales?.[lang];
    if (!locale || !locale.copy || !locale.blocks)
      throw new ValidationError(`Missing language ${lang}`);
    const allowed = new Map(publicationFields[lang].map((f) => [f.path, f]));
    for (const [path, value] of Object.entries(locale.copy)) {
      const field = allowed.get(path);
      if (!field) throw new ValidationError(`Uneditable path: ${path}`);
      locale.copy[path] = validCopy(field, value, { stored: fromStore });
    }
    for (const field of allowed.values()) {
      if (!(field.path in locale.copy)) locale.copy[field.path] = field.default;
    }
    for (const [id, block] of Object.entries(locale.blocks)) {
      if (id === "faq") {
        if (
          !Array.isArray(block.items) ||
          block.items.length > 100 ||
          typeof block.introductionHtml !== "string"
        )
          throw new ValidationError("Invalid ordered FAQ");
        block.introductionHtml = sanitizeRich(block.introductionHtml);
        const ids = new Set();
        block.items = block.items.map((item) => {
          if (
            !/^[a-zA-Z][\w-]{0,99}$/.test(item.id) ||
            ids.has(item.id) ||
            typeof item.questionHtml !== "string" ||
            typeof item.answerHtml !== "string"
          )
            throw new ValidationError("Invalid FAQ question");
          ids.add(item.id);
          return {
            id: item.id,
            questionHtml: sanitizeRich(item.questionHtml),
            answerHtml: sanitizeRich(item.answerHtml),
          };
        });
        continue;
      }
      if (!doc.layout.content.some((b) => b.props.id === id)) {
        delete locale.blocks[id];
        continue;
      }
      if (
        Object.keys(block).some(
          (k) =>
            !["html", "title", "text", "href", "src", "alt", "label"].includes(
              k,
            ),
        )
      )
        throw new ValidationError("Unknown localized block field");
      for (const [key, value] of Object.entries(block)) {
        if (typeof value !== "string" || value.length > 120000)
          throw new ValidationError("Invalid localized block");
        if (key === "html") block[key] = sanitizeRich(value);
        if (key === "src" && value && !doc.assets.includes(value))
          throw new ValidationError("Images must use uploaded assets");
        if (
          key === "href" &&
          value &&
          !/^(https:\/\/|mailto:|#[a-zA-Z]|\/(?!\/))/.test(value)
        )
          throw new ValidationError("Unsafe link");
      }
    }
    const meta = doc.metadata?.[lang] || {};
    for (const [key, value] of Object.entries(meta)) {
      if (
        ![
          "title",
          "description",
          "ogDescription",
          "imageText",
          "ogImage",
        ].includes(key) ||
        typeof value !== "string" ||
        value.length > 1000
      )
        throw new ValidationError("Unsupported metadata");
      if (key === "ogImage" && value && !doc.assets.includes(value))
        throw new ValidationError("Use an uploaded social image");
    }
  }
  for (const template of doc.templates || []) {
    if (
      !Number.isSafeInteger(template.id) ||
      template.id < 1 ||
      typeof template.slug !== "string" ||
      !template.slug ||
      typeof template.subject !== "string" ||
      typeof template.html_body !== "string"
    )
      throw new ValidationError("Invalid email template");
    template.html_body = sanitizeRich(template.html_body);
    if (
      template.slug.startsWith("newsletter-") &&
      !template.html_body.includes("{{unsubscribeUrl}}")
    )
      throw new ValidationError(
        "Newsletter templates require {{unsubscribeUrl}}",
      );
    if (/[\r\n]/.test(template.subject))
      throw new ValidationError("Email subject must be one line");
  }
  for (const template of doc.templates || []) {
    const baseSlug = systemTemplateBase(template.slug, LANGUAGES);
    if (!baseSlug || baseSlug === template.slug) continue;
    const base = doc.templates.find((t) => t.slug === baseSlug);
    if (!base)
      throw new ValidationError(
        "System translations require their source template",
      );
    preserveTemplateTokens(base, template);
  }
  if (
    new Set(doc.templates.map((t) => t.id)).size !== doc.templates.length ||
    new Set(doc.templates.map((t) => t.slug)).size !== doc.templates.length
  )
    throw new ValidationError("Invalid duplicate templates");
  return doc;
}

function preserveTemplateTokens(source, target) {
  for (const token of protectedTemplateTokens(source))
    if (!target.html_body.includes(token))
      throw new ValidationError(`Protected placeholder ${token} is required`);
}

export function configFromDocument(doc, lang, emailFacts) {
  const config = structuredClone(pristine[lang] || pristine[DEFAULT_LANG]);
  const copy = {
    ...doc.locales[DEFAULT_LANG].copy,
    ...doc.locales[lang]?.copy,
  };
  for (const [path, value] of Object.entries(copy))
    setPath(config, path, value);
  config.theme = doc.appearance.theme;
  config.meta = resolvedMetadata(config, doc.metadata[lang]);
  if (doc.analytics.mode !== "external")
    config.meta.analytics = { src: "", websiteId: "" };
  config.publication = {
    layout: doc.layout,
    blocks: {
      ...doc.locales[DEFAULT_LANG].blocks,
      ...doc.locales[lang]?.blocks,
    },
    analytics: doc.analytics.mode,
  };
  if (config.features.faq === false) delete config.publication.blocks.faq;
  if (emailFacts) config.email = { ...config.email, ...emailFacts };
  return config;
}

// What tells a publication from every other one: its revision, the time it
// was published and its document, as one short mark. The revision alone does
// not. After a backup is restored, the next publication takes a number that a
// discarded publication had, and a draft made from the discarded one must not
// pass for a draft made from it.
const publicationId = (revision, publishedAt, document) =>
  createHash("sha256")
    .update(`${revision}\n${publishedAt}\n${document}`)
    .digest("base64url")
    .slice(0, 22);

const RECORD_KEY = "publication:stored-copy";
// Where an earlier version kept a mark of every default, by language, and
// nothing else. A site that still has it gets today's records at its next
// start.
const DEFAULT_MARKS_KEY = "publication:copy-defaults";

const parsed = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// What the server knows of stored copy (server/stored-copy.js) goes with a
// publication: a publication from before a start changed the copy is
// described by the record from before that start. So the site keeps its
// records by revision, newest first. Each holds for the publications from
// revision `since` on, up to the next record. A publication the team makes
// comes from the one before it and shares its record.
function storedRecords({ saved, defaultMarks }) {
  const records = parsed(saved);
  if (Array.isArray(records?.records))
    return records.records
      .filter((record) => Number.isInteger(record?.since))
      .sort((a, b) => b.since - a.since);
  // As the version before records went by revision kept it: one record, with
  // its steps not yet by language. They were taken for the languages whose
  // defaults it holds.
  if (Array.isArray(records?.steps)) {
    const steps = Object.fromEntries(
      Object.keys(records.defaults || {}).map((lang) => [lang, records.steps]),
    );
    return [{ since: 0, ...records, steps }];
  }
  const marks = parsed(defaultMarks);
  return isObject(marks) && Object.values(marks).every(isObject)
    ? [{ since: 0, ...recordFromDefaultMarks(marks) }]
    : [];
}

// The record that goes with a revision, or null for one from before.
function recordOf(records, revision) {
  const { since, ...record } =
    records.find((entry) => entry.since <= revision) ?? {};
  return since === undefined ? null : record;
}

// What a start reads: the two newest publications and the saved records.
async function storedState(connection) {
  const rows = await connection
    .query("SELECT * FROM publications ORDER BY revision DESC LIMIT 2")
    .all();
  const settings = await connection
    .query("SELECT key, value FROM app_settings WHERE key IN (?, ?)")
    .all(RECORD_KEY, DEFAULT_MARKS_KEY);
  const value = (key) =>
    settings.find((setting) => setting.key === key)?.value ?? null;
  return {
    rows,
    saved: value(RECORD_KEY),
    defaultMarks: value(DEFAULT_MARKS_KEY),
  };
}

// What a start of the server makes of the stored publications, or null when
// there are none. The newest has its copy brought in line with the letter
// (upgradeStoredDocument). When that changed a text the site already had, the
// result is a new revision: a draft from before then meets a conflict instead
// of putting the old text back. Otherwise the result has the revision of the
// stored publication, which stays as it is either way. `records` are the
// records to keep: the one of the result, and the one of the publication
// before it.
//
// `state` is what this was made from, for the start to see whether it still
// holds when it stores the result.
//
// The start stores this. Restoring a backup only checks that it can be made,
// so that both treat a stored document the same way.
export async function upgradedPublications(connection) {
  const state = await storedState(connection);
  const [latest, earlier] = state.rows;
  if (!latest) return null;
  const records = storedRecords(state);
  const upgraded = upgradeStoredDocument(
    JSON.parse(latest.document),
    recordOf(records, latest.revision),
  );
  const { rewritten } = upgraded;
  const revision = latest.revision + (rewritten ? 1 : 0);
  const before = rewritten ? latest : earlier;
  const kept =
    before && records.find((entry) => entry.since <= before.revision);
  return {
    ...upgraded,
    state,
    revision,
    publishedAt: rewritten ? new Date().toISOString() : latest.published_at,
    records:
      kept && sameValue(recordOf([kept], before.revision), upgraded.record)
        ? [kept]
        : [{ since: revision, ...upgraded.record }, ...(kept ? [kept] : [])],
  };
}

const CHANGE_LOG = {
  policy: "the privacy policy was brought up to date and needs a review",
  placeholder: "gained a placeholder it lacked",
  replaced: "was not valid any more and is the default again",
  review:
    "the default privacy policy changed, and the edited one was left as it is",
  wording:
    "a sentence about the form's fields holds the team's own words and was left as it is. Check that it still says what the form does",
  length:
    "the privacy policy has no room for what the form asks for now and was left as it is. Shorten it and bring it up to date by hand",
};

export async function createPublicationStore(
  connection,
  {
    prepare = async () => ({}),
    onSwap = () => {},
    // (next, previous, connection), inside the publish transaction: a throw
    // here refuses the publication, whichever route asked for it.
    beforeCommit = async () => {},
    assets,
  } = {},
) {
  await connection.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  assets ||= await createAssetLifecycle(connection);
  let snapshot = null;
  let serial = Promise.resolve();
  let nextId = 1;
  const knownAssets = async () =>
    (await connection.query("SELECT hash FROM publication_assets").all()).map(
      (row) => assetPath(row.hash),
    );
  async function validateAgainstStorage(input, options) {
    const document = cleanDocument(input, await knownAssets(), options);
    const identities = await connection
      .query("SELECT id,slug FROM email_templates")
      .all();
    nextId = Math.max(
      nextId,
      ...identities.map((t) => t.id + 1),
      ...document.templates.map((t) => t.id + 1),
    );
    for (const template of document.templates) {
      if (
        identities.some(
          (old) =>
            (old.id === template.id && old.slug !== template.slug) ||
            (old.slug === template.slug && old.id !== template.id),
        )
      )
        throw new ValidationError(
          "Template slugs and IDs are stable, including retired templates",
        );
    }
    for (const old of snapshot?.document.templates || []) {
      const next = document.templates.find((t) => t.id === old.id);
      const protectedTemplate = !old.slug.startsWith("newsletter-");
      if (protectedTemplate && !next)
        throw new ValidationError(
          `Required template ${old.slug} cannot be removed`,
        );
      if (next) preserveTemplateTokens(old, next);
    }
    return document;
  }
  async function prepareDocument(input, mode) {
    const document = await validateAgainstStorage(input, {
      stored: mode === "load",
    });
    return { ...(await prepare(document, { mode })), document };
  }
  function visibleOutput(output) {
    const { generatedAssets, ...visible } = output;
    return visible;
  }
  return {
    assets,
    get current() {
      if (!snapshot)
        throw new Error("Publications must load before serving requests");
      return snapshot;
    },
    get nextTemplateIdValue() {
      return nextId;
    },
    async nextTemplateId() {
      const row = await connection
        .query("SELECT MAX(id) AS id FROM email_templates")
        .get();
      return (row.id || 0) + 1;
    },
    // Another process on the same database can publish while this one
    // starts. The start therefore stores its result only if the publications
    // and records it was made from are still the stored ones, checked in the
    // transaction that stores it. Otherwise it makes the result again.
    async load(seed) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const stored = await upgradedPublications(connection);
        if (!stored) {
          await this.publish(conformStoredDocument(seed), 0).catch((error) => {
            if (!(error instanceof RevisionConflict)) throw error;
          });
          continue;
        }
        const { revision, publishedAt, changes } = stored;
        const output = await prepareDocument(stored.document, "load");
        const document = stored.rewritten
          ? JSON.stringify(output.document)
          : stored.state.rows[0].document;
        const current = await connection.transaction(
          async () => {
            if (!sameValue(await storedState(connection), stored.state))
              return false;
            await connection
              .query(
                `INSERT INTO app_settings /* public-neutral */ (key, value, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT (key) DO UPDATE
                   SET value = excluded.value, updated_at = excluded.updated_at`,
              )
              .run(
                RECORD_KEY,
                JSON.stringify({ records: stored.records }),
                new Date().toISOString(),
              );
            await connection
              .query("DELETE FROM app_settings WHERE key = ?")
              .run(DEFAULT_MARKS_KEY);
            // A stored publication is never written again. What the start
            // makes of it is stored only as a revision of its own.
            if (stored.rewritten) {
              await connection
                .query(
                  "INSERT INTO publications /* public-neutral */ (revision,document,published_at) VALUES (?,?,?)",
                )
                .run(revision, document, publishedAt);
              await connection
                .query(
                  "DELETE FROM publications /* public-neutral */ WHERE revision < ?",
                )
                .run(revision - 1);
            }
            await assets.retain(
              connection,
              revision,
              output.document,
              output.generatedAssets,
            );
            if (changes.length)
              await recordAdminAction(connection, "website.upgrade", {
                targetId: revision,
                detail: { texts: changes },
              });
            await assets.collect(connection);
            return true;
          },
          { immediate: true },
        );
        if (!current) continue;
        const followed = changes.filter(({ change }) => change === "default");
        if (followed.length)
          console.log(
            `[publication] ${followed.length} unedited text(s) follow a changed default`,
          );
        for (const { lang, path, change } of changes)
          if (CHANGE_LOG[change])
            console.warn(
              `[publication] ${lang} ${path}: ${CHANGE_LOG[change]}`,
            );
        snapshot = {
          ...visibleOutput(output),
          revision,
          publishedAt,
          id: publicationId(revision, publishedAt, document),
        };
        onSwap(snapshot);
        return snapshot;
      }
      throw new Error(
        "The stored publication kept changing while the server started",
      );
    },
    // `expectedId` is the id of the publication the document was made from,
    // where the caller holds a whole document it may have had for long: the
    // admin's draft. The current publication must be that one.
    publish(input, expectedRevision, expectedId) {
      const run = serial.then(async () => {
        if (
          !Number.isInteger(expectedRevision) ||
          expectedRevision !== (snapshot?.revision || 0) ||
          (expectedId !== undefined && expectedId !== snapshot?.id)
        )
          throw new RevisionConflict(snapshot?.revision || 0);
        const output = await prepareDocument(input, "publish");
        const publishedAt = new Date().toISOString();
        const revision = expectedRevision + 1;
        const document = JSON.stringify(output.document);
        await connection.transaction(
          async () => {
            const latest = await connection
              .query("SELECT MAX(revision) AS revision FROM publications")
              .get();
            if ((latest.revision || 0) !== expectedRevision)
              throw new RevisionConflict(latest.revision || 0);
            await validateAgainstStorage(output.document);
            await beforeCommit(output.document, snapshot?.document, connection);
            await connection
              .query(
                "INSERT INTO publications /* public-neutral */ (revision,document,published_at) VALUES (?,?,?)",
              )
              .run(revision, document, publishedAt);
            for (const t of output.document.templates)
              await connection
                .query(
                  "INSERT INTO email_templates /* public-neutral */ (id,slug,name,subject,html_body) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,subject=excluded.subject,html_body=excluded.html_body,updated_at=?",
                )
                .run(t.id, t.slug, t.name, t.subject, t.html_body, publishedAt);
            await assets.retain(
              connection,
              revision,
              output.document,
              output.generatedAssets,
            );
            await connection
              .query(
                "DELETE FROM publications /* public-neutral */ WHERE revision < ?",
              )
              .run(revision - 1);
            await assets.collect(connection);
          },
          { immediate: true },
        );
        snapshot = {
          ...visibleOutput(output),
          revision,
          publishedAt,
          id: publicationId(revision, publishedAt, document),
        };
        onSwap(snapshot);
        return snapshot;
      });
      serial = run.catch(() => {});
      return run;
    },
    async preview(input) {
      return visibleOutput(await prepareDocument(input, "preview"));
    },
    validate: validateAgainstStorage,
    // The publication before the current one, for the admin to load as a
    // draft: as the letter accepts it now, which the record that goes with it
    // decides. Stored, it stays as it was published.
    async previous() {
      const state = await storedState(connection);
      const row = state.rows[1];
      if (!row) return null;
      const { document } = upgradeStoredDocument(
        JSON.parse(row.document),
        recordOf(storedRecords(state), row.revision),
      );
      return cleanDocument(document, await knownAssets(), { stored: true });
    },
  };
}
