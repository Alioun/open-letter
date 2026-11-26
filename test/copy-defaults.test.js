// Stored copy and the defaults it was stored under: a text nobody edited
// follows a default that changes, and a text the team wrote stays.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import { resetDb } from "./helpers.js";
import {
  createPublicationStore,
  initialDocument,
  publicationFields,
  upgradeStoredDocument,
} from "../server/publications.js";
import { DEFAULT_LANG } from "../config/letter.config.js";
import { changeLines } from "../src/admin-log-format.js";
import { sanitizeRich } from "../server/rich-content.js";

const copyOf = (document) => document.locales[DEFAULT_LANG].copy;
const pick = (copy, paths) =>
  Object.fromEntries(paths.map((path) => [path, copy[path]]));

// What the example letter showed before it asked for an organisation and a
// role, and the interface defaults as two earlier versions had them.
const EARLIER = {
  "sign.fields.occupation.label": "Occupation",
  "ui.settings.occupationLabel": "Beruf",
  "ui.list.filterOccupations": "Berufe",
  "ui.signForm.pausedTitle": "Unterzeichnen pausiert",
  "ui.signForm.pausedMessage":
    "Der Versand der Bestätigungs-E-Mails ist vorübergehend gestört. Wir arbeiten daran, damit du bald wieder unterzeichnen kannst. Wir bitten um etwas Geduld und danken für dein Verständnis!",
  "ui.emailModal.delayedHint":
    "Du musst nichts weiter tun. Die E-Mail kommt automatisch, sobald der Versand wieder läuft, und der Link ist ab dann {hours} Stunden gültig.",
};
const CURRENT = {
  "sign.fields.occupation.label": "Organisation",
  "ui.settings.occupationLabel": "Organisation",
  "ui.list.filterOccupations": "Organisations",
  "ui.signForm.pausedTitle": "Signing paused",
  "ui.signForm.pausedMessage":
    "We’re not taking new signatures at the moment. Please try again later.",
  "ui.emailModal.delayedHint":
    "There's nothing else to do. The email arrives automatically once delivery works again, and the link is valid for {hours} hours from then. If it can't be sent within {waitHours} hours, your signature expires. Please sign again then.",
};
const EDITED = {
  "ui.signForm.badge": "Add your name",
  "sign.formTitle": "Sign today",
};

test("a publication from before defaults were recorded: an earlier default follows the default, an edited text stays", () => {
  const stored = initialDocument();
  Object.assign(copyOf(stored), EARLIER, EDITED);

  const upgraded = copyOf(upgradeStoredDocument(stored, null).document);
  expect(pick(upgraded, Object.keys(CURRENT))).toEqual(CURRENT);
  expect(pick(upgraded, Object.keys(EDITED))).toEqual(EDITED);
});

describe("a text the team wrote before its default gained a placeholder", () => {
  const upgraded = (path, text) => {
    const stored = initialDocument();
    copyOf(stored)[path] = text;
    const { document, changes } = upgradeStoredDocument(stored, null);
    return { text: copyOf(document)[path], changes };
  };

  test("keeps its wording and gains the sentence of the default that has the placeholder", () => {
    const own = "Wait for our mail. Its link works for {hours} hours.";
    expect(upgraded("ui.emailModal.delayedHint", own)).toEqual({
      text: `${own} If it can't be sent within {waitHours} hours, your signature expires.`,
      changes: [
        {
          lang: DEFAULT_LANG,
          path: "ui.emailModal.delayedHint",
          change: "placeholder",
        },
      ],
    });
  });

  test("gives way to a default of one sentence, and what it said is kept for the team", () => {
    const { text, changes } = upgraded("ui.list.mapChipAria", "Map: {name}");
    expect(text).toBe("{name}: {count} Unterschriften, Details anzeigen");
    expect(changes).toEqual([
      {
        lang: DEFAULT_LANG,
        path: "ui.list.mapChipAria",
        change: "replaced",
        before: "Map: {name}",
      },
    ]);
    expect(changeLines({ texts: changes })).toEqual([
      'Text: "{name}: {count} Unterschriften, Details anzeigen" (EN): Der gespeicherte Text war nicht mehr gültig. An seiner Stelle steht der Standardtext. Vorher: „Map: {name}“',
    ]);
  });
});

test("the admin log names the texts a start changed, and counts the ones that only follow their default", () => {
  expect(
    changeLines({
      texts: [
        { lang: "en", path: "sign.formTitle", change: "default" },
        { lang: "en", path: "navCta", change: "default" },
        { lang: "en", path: "legal.privacyHtml", change: "policy" },
        { lang: "de", path: "legal.privacyHtml", change: "review" },
        { lang: "de", path: "legal.privacyHtml", change: "wording" },
        { lang: "de", path: "legal.privacyHtml", change: "length" },
      ],
    }),
  ).toEqual([
    "Datenschutzerklärung (EN): Auf den Stand des Briefs gebracht. Bitte prüfen.",
    "Datenschutzerklärung (DE): Der Standardtext hat sich geändert. Der bearbeitete Text ist unverändert. Bitte prüfen.",
    "Datenschutzerklärung (DE): Ein Satz über die Angaben des Formulars enthält eigene Formulierungen und ist unverändert. Bitte prüfen, ob er noch stimmt.",
    "Datenschutzerklärung (DE): Der Text müsste an das Formular angepasst werden, wäre dann aber länger als 120.000 Zeichen. Er ist unverändert. Bitte kürzen und selbst anpassen.",
    "2 unbearbeitete Texte folgen ihrem geänderten Standard.",
  ]);
  expect(
    changeLines({
      texts: [{ lang: "en", path: "legal.privacyHtml", change: "default" }],
    }),
  ).toEqual([
    "Datenschutzerklärung (EN): Der unbearbeitete Text folgt seinem geänderten Standard.",
  ]);
});

describe("across restarts of the server", () => {
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

  async function start(seed = initialDocument()) {
    const store = await createPublicationStore(connection);
    await store.load(seed);
    return store;
  }
  async function publish(store, changes) {
    const next = structuredClone(store.current.document);
    Object.assign(copyOf(next), changes);
    await store.publish(next, store.current.revision);
  }
  // The letter's config gives a field another default before the next start.
  async function withDefault(path, value, run) {
    const field = publicationFields[DEFAULT_LANG].find((f) => f.path === path);
    const shipped = field.default;
    field.default = value;
    try {
      return await run();
    } finally {
      field.default = shipped;
    }
  }

  test("a text nobody edited follows a default the config changes", async () => {
    await start();
    await withDefault("sign.formTitle", "Sign in a minute", async () => {
      expect(copyOf((await start()).current.document)["sign.formTitle"]).toBe(
        "Sign in a minute",
      );
    });
  });

  // A formatted text is stored in another form than the config writes it in:
  // "<br>" becomes "<br />".
  test("a formatted text nobody edited follows its default too", async () => {
    const first = await start();
    expect(copyOf(first.current.document)["list.headingHtml"]).toBe(
      "{count} people<br />have signed.",
    );
    await withDefault(
      "list.headingHtml",
      "{count} people<br>signed this.",
      async () => {
        expect(
          copyOf((await start()).current.document)["list.headingHtml"],
        ).toBe("{count} people<br />signed this.");
      },
    );
  });

  test("a text the team edited stays when its default changes", async () => {
    await publish(await start(), { "sign.formTitle": "Our own title" });
    await withDefault("sign.formTitle", "Sign in a minute", async () => {
      expect(copyOf((await start()).current.document)["sign.formTitle"]).toBe(
        "Our own title",
      );
    });
  });

  test("an edited privacy policy stays when only its default changes, and the admin log says so once", async () => {
    const first = await start();
    const policy = copyOf(first.current.document)["legal.privacyHtml"];
    const edited = `${policy}<p>Our own closing words.</p>`;
    await publish(first, { "legal.privacyHtml": edited });
    const logged = async () =>
      (
        await connection
          .query(
            "SELECT target_id AS revision, detail FROM admin_actions WHERE action = 'website.upgrade'",
          )
          .all()
      ).map((row) => ({
        revision: row.revision,
        texts: JSON.parse(row.detail).texts,
      }));

    await withDefault(
      "legal.privacyHtml",
      `${policy}<p>A paragraph that a later default has.</p>`,
      async () => {
        const next = await start();
        expect(next.current.revision).toBe(2);
        expect(copyOf(next.current.document)["legal.privacyHtml"]).toBe(edited);
        expect(await logged()).toEqual([
          {
            revision: 2,
            texts: [
              {
                lang: DEFAULT_LANG,
                path: "legal.privacyHtml",
                change: "review",
              },
            ],
          },
        ]);
        expect((await start()).current.revision).toBe(2);
        expect(await logged()).toHaveLength(1);
      },
    );
  });

  // 119,993 characters as it is typed. Stored, its link has an attribute
  // more, which takes it over the limit of 120,000.
  const LONG = `{count} ${"x".repeat(119950)}<a href="https://example.org">e</a>`;

  test("a formatted text that is longer than the limit once it is stored is refused when it is published", async () => {
    const store = await start();
    expect(LONG.length).toBeLessThan(120000);
    expect(sanitizeRich(LONG).length).toBeGreaterThan(120000);
    await expect(publish(store, { "list.headingHtml": LONG })).rejects.toThrow(
      "list.headingHtml",
    );
    expect(store.current.revision).toBe(1);
  });

  test("a stored formatted text that is longer than the limit stays at a start", async () => {
    const before = initialDocument();
    copyOf(before)["list.headingHtml"] = sanitizeRich(LONG);
    await connection
      .query(
        "INSERT INTO publications (revision, document, published_at) VALUES (1, ?, ?)",
      )
      .run(JSON.stringify(before), new Date().toISOString());

    const started = await start();
    expect(copyOf(started.current.document)["list.headingHtml"]).toBe(
      sanitizeRich(LONG),
    );
    expect(started.current.revision).toBe(1);
  });

  test("a site from before gets the current defaults once, and a text the team then sets to an earlier default stays", async () => {
    // As an earlier version stored it: with that version's defaults, and
    // with no record of what they were.
    const before = initialDocument();
    Object.assign(copyOf(before), EARLIER, EDITED);
    await connection
      .query(
        "INSERT INTO publications (revision, document, published_at) VALUES (1, ?, ?)",
      )
      .run(JSON.stringify(before), new Date().toISOString());

    const upgraded = await start();
    expect(
      pick(copyOf(upgraded.current.document), Object.keys(CURRENT)),
    ).toEqual(CURRENT);
    expect(
      pick(copyOf(upgraded.current.document), Object.keys(EDITED)),
    ).toEqual(EDITED);

    await publish(upgraded, { "sign.fields.occupation.label": "Occupation" });
    expect(
      copyOf((await start()).current.document)["sign.fields.occupation.label"],
    ).toBe("Occupation");
  });
});
