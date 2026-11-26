// One step in the life of a deployment, as a process of its own, so that the
// letter's config can change between steps. Writes what the step left behind
// to the file FIXTURE_RESULT, as JSON.
//
//   start            the server's start: load the stored publication. With
//                    FIXTURE_HOLD set, the start stops once, after it has
//                    read the stored publication and before it writes:
//                    it creates the file "<FIXTURE_HOLD>.reached" and goes
//                    on when the file FIXTURE_HOLD exists
//   publish <file>   start, then publish. The file holds { copy } to change
//                    texts of the current publication, or { document,
//                    expectedRevision, expectedId } to submit a draft as the
//                    admin would
//   store <file>     put { document } in place of the stored publication, as
//                    a version from before this one left it: no start, and
//                    nothing recorded about it but { settings }, by key
//   backup           start, then write an encrypted backup
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "./db/connection.js";
import {
  initialDocument,
  createPublicationStore,
} from "./server/publications.js";
import { exportEncrypted } from "./server/backup.js";

const [action, file] = process.argv.slice(2);
const input = file ? JSON.parse(readFileSync(file, "utf8")) : {};
const result = { action };
try {
  await db.run(
    readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8"),
  );
  if (action === "store") {
    await db.run(
      readFileSync(new URL("./db/publishing.sql", import.meta.url), "utf8"),
    );
    await db.run(
      "DELETE FROM publications; DELETE FROM app_settings WHERE key LIKE 'publication:%'; DELETE FROM admin_actions;",
    );
    await db
      .query(
        "INSERT INTO publications (revision, document, published_at) VALUES (1, ?, ?)",
      )
      .run(JSON.stringify(input.document), "2026-01-01T00:00:00.000Z");
    for (const [key, value] of Object.entries(input.settings || {}))
      await db
        .query("INSERT INTO app_settings (key, value) VALUES (?, ?)")
        .run(key, JSON.stringify(value));
  } else {
    let hold = process.env.FIXTURE_HOLD;
    const store = await createPublicationStore(db, {
      prepare: async () => {
        if (hold) {
          writeFileSync(`${hold}.reached`, "");
          while (!existsSync(hold)) await Bun.sleep(50);
          hold = null;
        }
        return {};
      },
    });
    try {
      await store.load(initialDocument());
      result.started = true;
    } catch (error) {
      result.started = false;
      result.error = error.message;
    }
    if (result.started && action === "publish") {
      const document =
        input.document || structuredClone(store.current.document);
      for (const [lang, copy] of Object.entries(input.copy || {}))
        Object.assign(document.locales[lang].copy, copy);
      try {
        await store.publish(
          document,
          input.expectedRevision ?? store.current.revision,
          input.expectedId,
        );
      } catch (error) {
        result.refused = { status: error.status, message: error.message };
      }
    }
    if (result.started && action === "backup")
      await exportEncrypted(process.env.FIXTURE_BACKUP);
    if (result.started) {
      result.revision = store.current.revision;
      result.id = store.current.id;
      result.document = store.current.document;
      // What the admin gets to load the publication before as a draft.
      result.previous = await store.previous();
    }
  }
  const rows = await db
    .query("SELECT revision, document FROM publications ORDER BY revision")
    .all();
  result.revisions = rows.map((row) => row.revision);
  // The publications as the database holds them.
  result.stored = Object.fromEntries(
    rows.map((row) => [row.revision, JSON.parse(row.document)]),
  );
  result.log = await db
    .query("SELECT action, target_id AS targetId, detail FROM admin_actions")
    .all();
} finally {
  await db.close();
}
writeFileSync(process.env.FIXTURE_RESULT, JSON.stringify(result));
