import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "./db/connection.js";
import {
  initialDocument,
  createPublicationStore,
} from "./server/publications.js";
import { LANGUAGES, DEFAULT_LANG } from "./config/letter.config.js";
import { exportEncrypted } from "./server/backup.js";

const action = process.argv[2];
try {
  await db.run(
    readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8"),
  );
  const store = await createPublicationStore(db);
  await store.load(initialDocument());
  if (action === "seed") {
    const doc = structuredClone(store.current.document);
    doc.locales.en.copy.navCta = "Saved English headline";
    doc.locales.en.copy["zoom.form.badge"] = "Saved optional badge";
    await store.publish(doc, store.current.revision);
    await exportEncrypted(process.env.FIXTURE_BACKUP);
  } else if (action === "added") {
    assert.ok(
      store.current.document.locales.en.copy["legal.privacyHtml"].includes(
        "{{treffenRetentionDays}}",
      ),
    );
    assert.equal(
      store.current.document.layout.content.filter((b) => b.type === "Meeting")
        .length,
      1,
    );
    assert.deepEqual(LANGUAGES, ["en", "de"]);
    assert.equal(
      store.current.document.locales.en.copy.navCta,
      "Saved English headline",
    );
    assert.equal(
      store.current.document.locales.de.copy.navCta,
      initialDocument().locales.de.copy.navCta,
    );
    assert.equal(
      store.current.document.locales.en.copy["zoom.form.badge"],
      undefined,
    );
    assert.equal(
      store.current.document.archive.fields.en["zoom.form.badge"],
      "Saved optional badge",
    );
    assert.equal(
      store.current.document.locales.en.copy["brand.newField"],
      "New default field",
    );
    const invalid = structuredClone(store.current.document);
    invalid.locales.en.copy["zoom.form.badge"] = "New invalid submission";
    await assert.rejects(
      store.publish(invalid, store.current.revision),
      /Uneditable path/,
    );
    const unknown = structuredClone(store.current.document);
    unknown.locales.fr = structuredClone(unknown.locales.en);
    await assert.rejects(
      store.publish(unknown, store.current.revision),
      /Unknown publication language/,
    );
    const draft = structuredClone(store.current.document);
    draft.layout.content.find((b) => b.type === "Meeting").props.spacing = 42;
    draft.locales.de.copy.navCta = "Saved German headline";
    draft.locales.de.blocks.brief.html = "<p>Saved German letter</p>";
    draft.metadata.de.title = "Saved German metadata";
    await store.publish(draft, store.current.revision);
  } else if (action === "removed") {
    assert.equal(
      store.current.document.layout.content.some((b) => b.type === "Meeting"),
      false,
    );
    assert.equal(
      store.current.document.archive.sections.Meeting.block.props.spacing,
      42,
    );
    assert.deepEqual(LANGUAGES, ["en"]);
    assert.equal(store.current.document.locales.de, undefined);
    assert.equal(
      store.current.document.archive.locales.de.copy.navCta,
      "Saved German headline",
    );
    assert.equal(
      store.current.document.archive.locales.de.metadata.title,
      "Saved German metadata",
    );
    await store.publish(store.current.document, store.current.revision);
  } else if (action === "returned") {
    assert.equal(
      store.current.document.layout.content.find((b) => b.type === "Meeting")
        .props.spacing,
      42,
    );
    assert.equal(store.current.document.archive.sections.Meeting, undefined);
    assert.equal(
      store.current.document.locales.de.copy.navCta,
      "Saved German headline",
    );
    assert.equal(
      store.current.document.locales.de.blocks.brief.html,
      "<p>Saved German letter</p>",
    );
    assert.equal(
      store.current.document.metadata.de.title,
      "Saved German metadata",
    );
    assert.equal(
      store.current.document.locales.en.copy["zoom.form.badge"],
      "Saved optional badge",
    );
    assert.equal(store.current.document.archive.locales.de, undefined);
  } else if (action === "restored") {
    assert.equal(
      store.current.document.layout.content.filter((b) => b.type === "Meeting")
        .length,
      1,
    );
    assert.equal(
      store.current.document.locales[DEFAULT_LANG].copy.navCta,
      "Saved English headline",
    );
    assert.equal(
      store.current.document.locales.en.copy["zoom.form.badge"],
      undefined,
    );
    assert.equal(
      store.current.document.archive.fields.en["zoom.form.badge"],
      "Saved optional badge",
    );
    assert.ok(store.current.document.locales.de);
    const stored = JSON.parse(
      (
        await db
          .query(
            "SELECT document FROM publications ORDER BY revision DESC LIMIT 1",
          )
          .get()
      ).document,
    );
    assert.deepEqual(stored, store.current.document);
  } else throw new Error(`Unknown fixture action ${action}`);
  console.log(
    JSON.stringify({
      action,
      revision: store.current.revision,
      languages: LANGUAGES,
      passed: true,
    }),
  );
} finally {
  await db.close();
}
