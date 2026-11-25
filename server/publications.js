import { ValidationError } from "../config/validation.js";
import { themeIssues } from "../config/theme-validation.js";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  DefaultPrivacyBody,
  adminLogPrivacy,
  blockedAddressPrivacy,
  handEntryPrivacy,
  newsletterConsentPrivacy,
} from "../config/privacy-content.jsx";
import { contentFor } from "../config/content.jsx";
import { migrateFaq } from "../config/faq.js";
import cfg, {
  LANGUAGES,
  DEFAULT_LANG,
  configFor,
} from "../config/letter.config.js";
import {
  editableFields,
  getPath,
  setPath,
  cleanValue,
} from "../config/editable.js";
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
import { sanitizeRich, preservePlaceholders } from "./rich-content.js";
import { assetPath, publicationAssetPaths } from "./assets.js";
import { createAssetLifecycle } from "./asset-lifecycle.js";
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

for (const lang of LANGUAGES)
  configFor(lang).legal.privacyHtml ||= renderToStaticMarkup(
    createElement(DefaultPrivacyBody, { config: configFor(lang) }),
  );
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
      !["brand.lang", "brand.locale"].includes(f.path) &&
      !/eventAt|mapsUrl|joinLink|meetingUrl/.test(f.path),
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

// A published policy predates blocked addresses, the Protokoll, the
// newsletter consent mail and hand-added first signers: state all four. The
// block paragraph goes after the one about storing signatures, and the
// Protokoll paragraph after the block paragraph; each goes at the end when
// the team rewrote the one before it. The Protokoll has to be there somewhere,
// since publishing requires its {{adminLogDays}}. A policy that already names
// {{adminLogDays}} is left as the team wrote it.
const SIGNATURES_PARAGRAPH_END = "Bestätigungslink abgelaufen ist.</p>";
const BLOCK_PARAGRAPH_END =
  "deine Adresse zu Unrecht gesperrt ist, schreib uns.</p>";
function reconcileAdminPrivacy(copy) {
  let html = copy["legal.privacyHtml"];
  if (typeof html !== "string") return;
  html = html.replace(
    `<strong>${newsletterConsentPrivacy.before}</strong>`,
    `<strong>${newsletterConsentPrivacy.after}</strong>`,
  );
  if (!html.includes("Prüfsumme")) {
    const paragraph = `<p>${blockedAddressPrivacy("{{signerRetentionYears}}")}</p>`;
    html = html.includes(SIGNATURES_PARAGRAPH_END)
      ? html.replace(
          SIGNATURES_PARAGRAPH_END,
          SIGNATURES_PARAGRAPH_END + paragraph,
        )
      : html + paragraph;
  }
  if (!html.includes("{{adminLogDays}}")) {
    const paragraph = `<p>${adminLogPrivacy("{{adminLogDays}}")}</p>`;
    html = html.includes(BLOCK_PARAGRAPH_END)
      ? html.replace(BLOCK_PARAGRAPH_END, BLOCK_PARAGRAPH_END + paragraph)
      : html + paragraph;
  }
  // Hand-added first signers: after the Protokoll paragraph, or at the end.
  // A policy that mentions entries "von Hand" already is left alone.
  if (!html.includes("von Hand ein")) {
    const logParagraph = `<p>${adminLogPrivacy("{{adminLogDays}}")}</p>`;
    const paragraph = `<p>${handEntryPrivacy}</p>`;
    html = html.includes(logParagraph)
      ? html.replace(logParagraph, logParagraph + paragraph)
      : html + paragraph;
  }
  copy["legal.privacyHtml"] = html;
}

export function reconcileStoredDocument(input) {
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
    reconcileAdminPrivacy(locale.copy);
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
      if (
        field.type === "html" &&
        typeof locale.copy[field.path] === "string"
      ) {
        const missing = (
          String(field.default).match(/\{\{?\w+\}?\}/g) || []
        ).filter((token) => !locale.copy[field.path].includes(token));
        if (missing.length)
          locale.copy[field.path] += (
            String(field.default).match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []
          )
            .filter((paragraph) =>
              missing.some((token) => paragraph.includes(token)),
            )
            .join("");
      }
    }
  }
  return doc;
}

function validateTheme(theme) {
  const issue = themeIssues(theme)[0];
  if (issue) throw new ValidationError(issue.message);
  const base = structuredClone(pristine[DEFAULT_LANG].theme);
  for (const group of ["colors", "fonts", "style"])
    base[group] = { ...base[group], ...theme?.[group] };
  return base;
}

export function cleanDocument(input, knownAssets = []) {
  if (
    !input ||
    input.schemaVersion !== PUBLICATION_VERSION ||
    input.puckVersion !== PUCK_VERSION
  )
    throw new ValidationError("A publication migration is required");
  if (JSON.stringify(input).length > 2000000)
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
      let cleaned =
        field.type === "html" &&
        typeof value === "string" &&
        value.length <= 120000
          ? value
          : cleanValue(field, value);
      if (field.type === "html") cleaned = sanitizeRich(cleaned);
      if (typeof cleaned === "string")
        preservePlaceholders(field.default, cleaned);
      locale.copy[path] = cleaned;
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
  async function validateAgainstStorage(input) {
    const rows = await connection
      .query("SELECT hash FROM publication_assets")
      .all();
    const document = cleanDocument(
      input,
      rows.map((r) => assetPath(r.hash)),
    );
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
    const document = await validateAgainstStorage(input);
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
    async load(seed) {
      const rows = await connection
        .query("SELECT * FROM publications ORDER BY revision DESC LIMIT 2")
        .all();
      if (!rows.length) return this.publish(seed, 0);
      const prepared = [];
      for (const row of rows) {
        prepared.push({
          row,
          output: await prepareDocument(
            reconcileStoredDocument(JSON.parse(row.document)),
            "load",
          ),
        });
      }
      await connection.transaction(
        async () => {
          for (const { row, output } of prepared) {
            await connection
              .query(
                "UPDATE publications /* public-neutral */ SET document=? WHERE revision=?",
              )
              .run(JSON.stringify(output.document), row.revision);
            await assets.retain(
              connection,
              row.revision,
              output.document,
              output.generatedAssets,
            );
          }
          await assets.collect(connection);
        },
        { immediate: true },
      );
      const { row, output } = prepared[0];
      snapshot = {
        ...visibleOutput(output),
        revision: row.revision,
        publishedAt: row.published_at,
      };
      onSwap(snapshot);
      return snapshot;
    },
    publish(input, expectedRevision) {
      const run = serial.then(async () => {
        if (
          !Number.isInteger(expectedRevision) ||
          expectedRevision !== (snapshot?.revision || 0)
        )
          throw new RevisionConflict(snapshot?.revision || 0);
        const output = await prepareDocument(input, "publish");
        const publishedAt = new Date().toISOString();
        const revision = expectedRevision + 1;
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
              .run(revision, JSON.stringify(output.document), publishedAt);
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
        snapshot = { ...visibleOutput(output), revision, publishedAt };
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
    async previous() {
      const row = await connection
        .query(
          "SELECT document FROM publications ORDER BY revision DESC LIMIT 1 OFFSET 1",
        )
        .get();
      return row ? reconcileStoredDocument(JSON.parse(row.document)) : null;
    },
  };
}
