import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import {
  initialDocument,
  cleanDocument,
  createPublicationStore,
  configFromDocument,
  migrateDocument,
} from "../server/publications.js";
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
