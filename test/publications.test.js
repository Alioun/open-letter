import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import {
  initialDocument,
  cleanDocument,
  createPublicationStore,
  configFromDocument,
  migrateDocument,
  upgradeStoredDocument,
} from "../server/publications.js";
import {
  adminLogPrivacy,
  blockedAddressPrivacy,
  handEntryPrivacy,
  newsletterConsentPrivacy,
} from "../config/privacy-content.jsx";
import {
  validateLayout,
  defaultLayout,
  escapeJson,
} from "../config/publication.js";
import { themeIssues } from "../config/theme-validation.js";
import { validateCss, cssDiagnostics } from "../config/css-policy.js";
import {
  normalizeImage,
  generateOg,
  storeAsset,
  assetPath,
} from "../server/assets.js";
import { sanitizeRich } from "../server/rich-content.js";
import { renderPrivacy } from "../config/public-privacy.js";
import cfg, { DEFAULT_LANG } from "../config/letter.config.js";
import { resetDb } from "./helpers.js";
import { updateLayout } from "../src/publishing/layout.js";
let connection;
beforeEach(async () => {
  await resetDb();
  connection = await openEncrypted(DB_PATH);
  await connection.run(await Bun.file("db/publishing.sql").text());
  await connection.run(
    "DELETE FROM publications; DELETE FROM publication_assets;",
  );
});
afterEach(async () => {
  await connection.close();
});

describe("publication layout and policy", () => {
  test("design validation blocks invalid edits and enforces the same policy at publication", () => {
    const doc = initialDocument();
    expect(themeIssues(doc.appearance.theme)).toEqual([]);
    for (const [group, key, value] of [
      ["colors", "rot", "#12345z"],
      ["colors", "rot", "red; background:url(https://example.invalid)"],
      ["fonts", "body", "Inter; color:red"],
      ["fonts", "body", "x".repeat(161)],
      ["fonts", "unknown", "Inter"],
      ["style", "radius", "8px; background:red"],
      ["style", "radius", "url(https://example.invalid)"],
      ["style", "radius", "1px 2px 3px 4px 5px"],
      ["style", "unknown", "8px"],
      ["style", "shadow", "other"],
    ]) {
      const rejected = structuredClone(doc);
      rejected.appearance.theme[group] ||= {};
      rejected.appearance.theme[group][key] = value;
      const [issue] = themeIssues(rejected.appearance.theme);
      expect(issue).toMatchObject({ group, key });
      expect(() => cleanDocument(rejected)).toThrow(issue.message);
    }
    for (const color of ["#abc", "#abcd", "#a1b2c3", "#a1b2c3ff"]) {
      const accepted = structuredClone(doc);
      accepted.appearance.theme.colors.rot = color;
      accepted.appearance.theme.fonts.body = '"Work Sans", sans-serif';
      accepted.appearance.theme.style = {
        radius: "8px 1rem",
        shadowOffset: "none",
        shadow: "soft",
      };
      expect(themeIssues(accepted.appearance.theme)).toEqual([]);
      expect(cleanDocument(accepted).appearance.theme.colors.rot).toBe(color);
    }
  });

  test("duplicating a section retains every translation under a new stable ID", () => {
    const doc = initialDocument();
    const layout = structuredClone(doc.layout);
    layout.content.splice(2, 0, {
      type: "Text",
      props: { ...layout.content[2].props, id: "Text-original" },
    });
    for (const [lang, locale] of Object.entries(doc.locales))
      locale.blocks["Text-original"] = { html: `<p>${lang} content</p>` };
    layout.content.splice(3, 0, {
      ...layout.content[2],
      props: { ...layout.content[2].props, id: "Text-copy" },
    });
    updateLayout(doc, layout, {
      sourceId: "Text-original",
      targetId: "Text-copy",
    });
    for (const locale of Object.values(doc.locales)) {
      expect(locale.blocks["Text-copy"]).toEqual(
        locale.blocks["Text-original"],
      );
      expect(locale.blocks["Text-copy"]).not.toBe(
        locale.blocks["Text-original"],
      );
    }
    expect(validateLayout(doc.layout, cfg)).toEqual(doc.layout);
  });
  test("new newsletter templates retain access to unsubscribe", () => {
    const doc = initialDocument();
    doc.templates.push({
      id: 99999,
      slug: "newsletter-new",
      subject: "Update",
      html_body: "<p>Update</p>",
    });
    expect(() => cleanDocument(doc)).toThrow("unsubscribeUrl");
    doc.templates.at(-1).html_body +=
      '<p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>';
    expect(() => cleanDocument(doc)).not.toThrow();
  });
  test("protects anchors, functional blocks, IDs and feature gates", () => {
    const layout = defaultLayout(cfg);
    expect(validateLayout(layout, cfg)).toEqual(layout);
    for (const type of ["Header", "Hero", "Sign", "Footer"])
      expect(() =>
        validateLayout(
          { ...layout, content: layout.content.filter((b) => b.type !== type) },
          cfg,
        ),
      ).toThrow();
    const duplicated = structuredClone(layout);
    duplicated.content.splice(2, 0, duplicated.content[2]);
    expect(() => validateLayout(duplicated, cfg)).toThrow();
    const moved = structuredClone(layout);
    [moved.content[0], moved.content[2]] = [moved.content[2], moved.content[0]];
    expect(() => validateLayout(moved, cfg)).toThrow();
  });
  test("parser policy rejects remote resources, imports, escapes and HTML boundaries", () => {
    for (const css of [
      '@import "https://evil.example/a.css";',
      "body { background: url(https://evil.example/a); }",
      'body{background:image-set("https://evil.example/a" 1x)}',
      "body{background:u\\72l(https://evil.example/a)}",
      "/* </style><script>bad()</script> */",
    ])
      expect(() => validateCss(css, [])).toThrow();
    expect(
      validateCss(
        '[data-section="brief"] { color: var(--rot); background: url("/assets/approved.png") }',
        ["/assets/approved.png"],
      ),
    ).toContain("--rot");
    expect(cssDiagnostics("body{color:}").length).toBeGreaterThan(0);
  });
  test("sanitizes rich content and protects operational facts", () => {
    expect(
      sanitizeRich(
        '<p onclick="bad()">Hello<script>bad()</script><a href="javascript:bad()">link</a></p>',
      ),
    ).toBe('<p>Hello<a rel="noopener noreferrer">link</a></p>');
    const document = initialDocument();
    const config = configFromDocument(document, DEFAULT_LANG, {
      provider: "smtp",
      processor: "Example Mail",
      region: "EU",
    });
    expect(renderPrivacy(config)).toContain("Example Mail");
    expect(renderPrivacy(config)).not.toContain("{{confirmationLinkHours}}");
    document.locales[DEFAULT_LANG].copy["legal.privacyHtml"] =
      "<p>removed facts</p>";
    expect(() => cleanDocument(document)).toThrow("Protected placeholder");
    expect(
      escapeJson({ text: "</script><script>bad()</script>" }),
    ).not.toContain("<");
  });
});

describe("publication persistence", () => {
  test("publishing waits for an operational writer before reading its revision", async () => {
    const writer = await openEncrypted(DB_PATH);
    const store = await createPublicationStore(connection);
    await store.load(initialDocument());
    await writer.run("BEGIN IMMEDIATE");
    await writer
      .query("INSERT INTO app_settings(key,value) VALUES (?,?)")
      .run("publication-contention", "kept");
    const run = connection.run.bind(connection);
    let unlock;
    const released = new Promise((resolve, reject) => {
      unlock = { resolve, reject };
    });
    connection.run = (sql, ...args) => {
      if (/^BEGIN/.test(sql)) {
        // Keep the other write open while the publication starts its transaction.
        setTimeout(
          () => writer.run("COMMIT").then(unlock.resolve, unlock.reject),
          100,
        );
      }
      return run(sql, ...args);
    };
    try {
      const updated = structuredClone(store.current.document);
      updated.locales[DEFAULT_LANG].copy.navCta =
        "Published beside operational work";
      await store.publish(updated, 1);
      await released;
      expect(store.current.revision).toBe(2);
      expect(store.current.document.locales[DEFAULT_LANG].copy.navCta).toBe(
        "Published beside operational work",
      );
      expect(
        (
          await writer
            .query("SELECT value FROM app_settings WHERE key=?")
            .get("publication-contention")
        ).value,
      ).toBe("kept");
    } finally {
      connection.run = run;
      await released;
      await writer.close();
    }
  });
  test("serializes competing revisions, survives restart and retains previous publication", async () => {
    const store = await createPublicationStore(connection);
    await store.load(initialDocument());
    const updated = structuredClone(store.current.document);
    updated.locales[DEFAULT_LANG].copy.navCta = "Updated immediately";
    const results = await Promise.allSettled([
      store.publish(updated, 1),
      store.publish(updated, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected").reason.status).toBe(
      409,
    );
    expect(store.current.revision).toBe(2);
    expect((await store.previous()).locales[DEFAULT_LANG].copy.navCta).toBe(
      cfg.navCta,
    );
    const restarted = await createPublicationStore(connection);
    await restarted.load(initialDocument());
    expect(restarted.current.document.locales[DEFAULT_LANG].copy.navCta).toBe(
      "Updated immediately",
    );
  });
  test("failed preparation or SQL persistence keeps the current revision visible", async () => {
    let fail = false;
    const store = await createPublicationStore(connection, {
      prepare: async () => {
        if (fail) throw new Error("render failed");
        return {};
      },
    });
    await store.load(initialDocument());
    fail = true;
    await expect(store.publish(store.current.document, 1)).rejects.toThrow(
      "render failed",
    );
    expect(store.current.revision).toBe(1);
    fail = false;
    await connection.run(
      "CREATE TRIGGER reject_publication BEFORE INSERT ON publications BEGIN SELECT RAISE(ABORT,'disk fixture'); END;",
    );
    try {
      await expect(store.publish(store.current.document, 1)).rejects.toThrow(
        "disk fixture",
      );
      expect(store.current.revision).toBe(1);
    } finally {
      await connection.run("DROP TRIGGER reject_publication");
    }
  });
  test("normalizes images, strips metadata and retains their immutable source bytes", async () => {
    const generated = await generateOg(cfg, "Typography gjpqy ÄÉ Test");
    const path = await storeAsset(connection, generated);
    expect(path).toBe(assetPath(generated.hash));
    const same = await normalizeImage(generated.bytes);
    expect(same.hash).toBe(generated.hash);
    const row = await connection
      .query("SELECT * FROM publication_assets WHERE hash=?")
      .get(generated.hash);
    expect(Buffer.from(row.bytes)).toEqual(generated.bytes);
    expect(row.width).toBe(1200);
    expect(row.height).toBe(630);
  });
});

test("stored version 1 FAQs migrate explicitly and missing localized fields retain defaults", () => {
  const legacy = initialDocument();
  legacy.schemaVersion = 1;
  legacy.locales[DEFAULT_LANG].blocks.faq = {
    html: '<aside><h2>Questions</h2></aside><details><summary>First?</summary><div class="faq-answer"><p>Answer.</p></div></details>',
  };
  const migrated = cleanDocument(migrateDocument(legacy));
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.locales[DEFAULT_LANG].blocks.faq.items).toEqual([
    { id: "question-1", questionHtml: "First?", answerHtml: "<p>Answer.</p>" },
  ]);
  delete migrated.locales[DEFAULT_LANG].copy.navCta;
  expect(configFromDocument(cleanDocument(migrated), DEFAULT_LANG).navCta).toBe(
    cfg.navCta,
  );
});

test("the policy says what is kept of a blocked address: a value computed with a secret key, not an encrypted address", () => {
  const german = blockedAddressPrivacy("3");
  expect(german).not.toMatch(/verschlüsselt/);
  expect(german).toMatch(/mit einem geheimen Schlüssel berechnet/);
  expect(german).toMatch(/lässt sich die Adresse nicht ablesen/);
  const english = blockedAddressPrivacy("3", "en");
  expect(english).not.toMatch(/encrypt/);
  expect(english).toMatch(/computed with a secret key/);
  expect(english).toMatch(/cannot be read from it/);

  // A policy published with the earlier sentence gets the accurate one.
  // The default policy as a site stores it.
  const current = sanitizeRich(
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"],
  );
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = current.replace(
    `<p>${german.replace("3", "{{signerRetentionYears}}")}</p>`,
    "<p>Unterschriften, die offensichtlich nicht ernst gemeint oder unter falschem Namen abgegeben wurden, können wir entfernen. Damit dieselbe E-Mail-Adresse nicht erneut so eingetragen wird, speichern wir danach nur eine verschlüsselte Prüfsumme der Adresse, nicht die Adresse selbst. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO (berechtigtes Interesse an einer unverfälschten Unterschriftenliste). Die Prüfsumme wird nach {{signerRetentionYears}} Jahren gelöscht. Wenn du meinst, dass deine Adresse zu Unrecht gesperrt ist, schreib uns.</p>",
  );
  expect(stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toContain(
    "verschlüsselte Prüfsumme",
  );
  const upgraded = upgradeStoredDocument(stored, null).document;
  expect(upgraded.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toBe(
    current,
  );
});

test("a policy the team wrote in English gains the new paragraphs in English and keeps its own newsletter wording", () => {
  const german =
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"];
  // Every protected placeholder except the one the admin log paragraph
  // brings, as a team's own English policy would hold them.
  const placeholders = [...new Set(german.match(/\{\{\w+\}\}/g))].filter(
    (token) => token !== "{{adminLogDays}}",
  );
  const newsletter =
    "<p>We send campaign emails only if you ticked the box when you signed.</p>";
  const english = `<h4>Privacy</h4><p>We keep your signature for ${placeholders.join(" ")} under the GDPR.</p>${newsletter}`;
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = english;

  const first = upgradeStoredDocument(stored, null);
  const once = first.document;
  const html = once.locales[DEFAULT_LANG].copy["legal.privacyHtml"];
  expect(html).toStartWith(english);
  const added = html.slice(english.length);
  expect(added).toBe(
    [
      blockedAddressPrivacy("{{signerRetentionYears}}", "en"),
      adminLogPrivacy("{{adminLogDays}}", "en"),
      handEntryPrivacy("en"),
      // What the example letter stores and shows of its optional fields.
      "With your signature we also store these optional details: Organisation and Role. If you agreed to your role and organisation being shown publicly, we show them next to your name. We publish how many signatures gave each entry in the fields “Organisation” and “Role”, separately from the names, only for signatures whose details are shown publicly.",
    ]
      .map((paragraph) => `<p>${paragraph}</p>`)
      .join(""),
  );
  // English, with the facts the German paragraphs state.
  expect(added).not.toMatch(/Prüfsumme|Protokoll|von Hand|DS-GVO/);
  expect(added).toMatch(/blocked by mistake/);
  expect(added).toMatch(/internal log/);
  expect(added).toMatch(/by hand/);
  expect(added).toMatch(/GDPR/);

  const twice = upgradeStoredDocument(once, first.record).document;
  expect(twice.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toBe(html);
  expect(() => cleanDocument(twice)).not.toThrow();
  expect(renderPrivacy(configFromDocument(twice, DEFAULT_LANG))).toContain(
    "after 30 days",
  );
});

test("an English policy that names the German abbreviation of the law still gains its paragraphs in English", () => {
  const german =
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"];
  const placeholders = [...new Set(german.match(/\{\{\w+\}\}/g))].filter(
    (token) => token !== "{{adminLogDays}}",
  );
  const english = `<h4>Privacy</h4><p>We keep your signature for ${placeholders.join(" ")} under the GDPR (known in Germany as the DS-GVO).</p>`;
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = english;

  const html = upgradeStoredDocument(stored, null).document.locales[
    DEFAULT_LANG
  ].copy["legal.privacyHtml"];
  expect(html).toStartWith(english);
  const added = html.slice(english.length);
  expect(added).toContain(
    `<p>${blockedAddressPrivacy("{{signerRetentionYears}}", "en")}</p>`,
  );
  expect(added).toContain(
    `<p>${adminLogPrivacy("{{adminLogDays}}", "en")}</p>`,
  );
  expect(added).toContain(`<p>${handEntryPrivacy("en")}</p>`);
  expect(added).not.toMatch(/Prüfsumme|Protokoll|von Hand/);
});

test("the default policy counts as German on an English letter, whatever was added to it", () => {
  const german =
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"];
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = german
    .replace(`<p>${handEntryPrivacy()}</p>`, "")
    .replace("</h4>", "</h4><p>Our team works under the GDPR.</p>");

  expect(DEFAULT_LANG).toBe("en");
  expect(
    upgradeStoredDocument(stored, null).document.locales[DEFAULT_LANG].copy[
      "legal.privacyHtml"
    ],
  ).toContain(`<p>${handEntryPrivacy()}</p>`);
});

test("a published privacy policy gains the block, Protokoll and hand-entry paragraphs and the newsletter consent mail once", () => {
  const block = `<p>${blockedAddressPrivacy("{{signerRetentionYears}}")}</p>`;
  const paragraph = `<p>${adminLogPrivacy("{{adminLogDays}}")}</p>`;
  // The default policy as a site stores it.
  const current = sanitizeRich(
    initialDocument().locales[DEFAULT_LANG].copy["legal.privacyHtml"],
  );
  expect(current).toContain(`${block}${paragraph}<p>${handEntryPrivacy()}</p>`);
  const withBlock = current
    .replace(`<p>${handEntryPrivacy()}</p>`, "")
    .replace(paragraph, "")
    .replace(
      newsletterConsentPrivacy().after,
      newsletterConsentPrivacy().before,
    );
  const published = withBlock.replace(block, "");
  const stored = initialDocument();
  stored.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = published;

  const first = upgradeStoredDocument(stored, null);
  const once = first.document;
  const html = once.locales[DEFAULT_LANG].copy["legal.privacyHtml"];
  expect(html).toBe(current);
  const twice = upgradeStoredDocument(once, first.record).document;
  expect(twice.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toBe(current);
  expect(() => cleanDocument(twice)).not.toThrow();
  expect(renderPrivacy(configFromDocument(twice, DEFAULT_LANG))).toContain(
    "nach 30 Tagen",
  );

  // A policy the team rewrote still gets the paragraph, at the end, so the
  // website can be published again.
  const rewritten = initialDocument();
  rewritten.locales[DEFAULT_LANG].copy["legal.privacyHtml"] = withBlock.replace(
    "deine Adresse zu Unrecht gesperrt ist, schreib uns.",
    "melde dich bei uns.",
  );
  const fixed = upgradeStoredDocument(rewritten, null).document;
  expect(fixed.locales[DEFAULT_LANG].copy["legal.privacyHtml"]).toEndWith(
    `${paragraph}<p>${handEntryPrivacy()}</p>`,
  );
  expect(() => cleanDocument(fixed)).not.toThrow();
});
