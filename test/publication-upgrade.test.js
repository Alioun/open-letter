// A stored publication across starts of the server. Each start is a process
// of its own, so the letter's config can change in between, as it does when a
// site is upgraded or its operator changes the letter.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  adminLogPrivacy,
  blockedAddressPrivacy,
  handEntryPrivacy,
  newsletterConsentPrivacy,
} from "../config/privacy-content.jsx";
import { publicationFields } from "../server/publications.js";
import { sanitizeRich } from "../server/rich-content.js";

const root = resolve(import.meta.dir, "..");
const open = [];
afterEach(() => {
  for (const dir of open.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// A deployment of the example letter with a database of its own, or with the
// database of the deployment it is `sharing`. `configure` takes JavaScript
// that changes `letter`, in effect from the next step on.
function deployment(changes = "", { sharing } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "publication-upgrade-"));
  open.push(dir);
  for (const directory of ["config", "server", "db"])
    cpSync(join(root, directory), join(dir, directory), { recursive: true });
  cpSync(
    join(root, "test/fixtures/publication-upgrade-process.js"),
    join(dir, "worker.js"),
  );
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  const letterPath = join(dir, "config/letters/example/index.js");
  const letter = readFileSync(letterPath, "utf8").replace(
    "export default {",
    "const letter = {",
  );
  const env = {
    ...process.env,
    DATABASE_PATH: sharing?.database ?? join(dir, "fixture.db"),
    DATABASE_ENCRYPTION_KEY: "publication-upgrade-fixture",
    BACKUP_ENCRYPTION_KEY: "publication-upgrade-fixture",
    FIXTURE_BACKUP: join(dir, "fixture-backup.sqlite"),
    EMAIL_PROVIDER: "",
    RESEND_API_KEY: "",
    SMTP_HOST: "",
  };
  async function run(script, args, more = {}) {
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd: dir,
      env: { ...env, ...more },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ script, args, code, stderr: code ? stderr : "" }).toEqual({
      script,
      args,
      code: 0,
      stderr: "",
    });
    return stdout.trim();
  }
  let steps = 0;
  async function step(action, input, more) {
    const args = [action];
    const result = join(dir, `step-${++steps}-result.json`);
    if (input) {
      const file = join(dir, `step-${steps}.json`);
      writeFileSync(file, JSON.stringify(input));
      args.push(file);
    }
    await run("worker.js", args, { ...more, FIXTURE_RESULT: result });
    return JSON.parse(readFileSync(result, "utf8"));
  }
  const site = {
    database: env.DATABASE_PATH,
    configure(next) {
      writeFileSync(letterPath, `${letter}\n${next}\nexport default letter;\n`);
      return site;
    },
    start: () => step("start"),
    // A start that stops after it has read the stored publication and before
    // it writes anything. `reached` resolves when it is there, `release` lets
    // it go on, and `done` is what the start left.
    startHeld() {
      const hold = join(dir, `hold-${++steps}`);
      const done = step("start", null, { FIXTURE_HOLD: hold });
      const reached = Promise.race([
        (async () => {
          while (!existsSync(`${hold}.reached`)) await Bun.sleep(50);
        })(),
        done.then(() => {
          throw new Error("The start ended before it was held");
        }),
      ]);
      return { done, reached, release: () => writeFileSync(hold, "") };
    },
    publish: (input) => step("publish", input),
    // As a version from before this one left the database, with what that
    // version recorded in app_settings.
    storeFromBefore: (document, settings) =>
      step("store", { document, settings }),
    backup: () => step("backup"),
    restore: () => run("db/restore-backup.js", [env.FIXTURE_BACKUP]),
  };
  return site.configure(changes);
}

const policyOf = (document, lang = "en") =>
  document.locales[lang].copy["legal.privacyHtml"];
const count = (text, part) => text.split(part).length - 1;

// The default policy as the released version stored it: without the
// paragraphs on blocked addresses, the admin log and entries made by hand,
// and with the earlier newsletter sentence.
function policyFromBefore(html) {
  const before = html
    .replace(`<p>${handEntryPrivacy()}</p>`, "")
    .replace(`<p>${adminLogPrivacy("{{adminLogDays}}")}</p>`, "")
    .replace(`<p>${blockedAddressPrivacy("{{signerRetentionYears}}")}</p>`, "")
    .replace(
      newsletterConsentPrivacy().after,
      newsletterConsentPrivacy().before,
    );
  expect(before).not.toContain("{{adminLogDays}}");
  expect(before).not.toContain("Prüfsumme");
  return before;
}
function fromBefore(document, texts = {}) {
  const earlier = structuredClone(document);
  for (const locale of Object.values(earlier.locales)) {
    locale.copy["legal.privacyHtml"] = policyFromBefore(
      locale.copy["legal.privacyHtml"],
    );
    Object.assign(locale.copy, texts);
  }
  return earlier;
}

const HINT_BEFORE =
  "Du musst nichts weiter tun. Die E-Mail kommt automatisch, sobald der Versand wieder läuft, und der Link ist ab dann {hours} Stunden gültig.";

test("a text the team wrote before its default gained a placeholder does not stop the start", async () => {
  const site = deployment();
  const fresh = await site.start();
  const own = "Nothing to do. Your link will work for {hours} hours.";
  await site.storeFromBefore(
    fromBefore(fresh.document, { "ui.emailModal.delayedHint": own }),
  );

  const started = await site.start();
  expect(started).toMatchObject({ started: true });
  const hint = started.document.locales.en.copy["ui.emailModal.delayedHint"];
  expect(hint).toStartWith(own);
  expect(hint).toContain("{waitHours}");
  // The team is told which text was changed.
  expect(JSON.stringify(started.log)).toContain("ui.emailModal.delayedHint");
  // What the start left can be published again as it is.
  expect(
    await site.publish({ copy: { en: { navCta: "Sign here" } } }),
  ).not.toHaveProperty("refused");
}, 120000);

test("an English letter that gains a second language starts, and its untouched texts take the English defaults", async () => {
  const site = deployment();
  const fresh = await site.start();
  // As a version before the wait period stored the hint: in the platform's
  // German wording, which a letter in one language starts from.
  await site.storeFromBefore(
    fromBefore(fresh.document, { "ui.emailModal.delayedHint": HINT_BEFORE }),
  );
  site.configure(`
    letter.features.multiLanguage = true;
    letter.languages = ["en", "de"];
  `);

  const started = await site.start();
  expect(started).toMatchObject({ started: true });
  expect(
    started.document.locales.en.copy["ui.emailModal.delayedHint"],
  ).toStartWith("There's nothing else to do.");
  expect(started.document.locales.de).toBeDefined();
}, 120000);

test("starting again changes nothing: the stored document and its revision stay as the first start left them", async () => {
  // A label with an apostrophe, which HTML can write in two ways.
  const site = deployment(
    `letter.sign.fields.occupation.label = "Organisation d'origine";`,
  );
  const fresh = await site.start();
  await site.storeFromBefore(
    fromBefore(fresh.document, {
      "ui.emailModal.delayedHint": HINT_BEFORE,
      "sign.formTitle": "Our own title",
    }),
  );

  const first = await site.start();
  expect(first.document.locales.en.copy["sign.formTitle"]).toBe(
    "Our own title",
  );
  expect(policyOf(first.document)).toBe(policyOf(fresh.document));
  for (let again = 0; again < 3; again++) {
    const next = await site.start();
    expect(next.revision).toBe(first.revision);
    expect(next.revisions).toEqual(first.revisions);
    expect(next.document).toEqual(first.document);
    expect(next.log).toEqual(first.log);
  }
  expect(
    count(
      policyOf(first.document),
      "Die Anzahl je Angabe in den Feldern „Organisation d'origine“ und „Role“",
    ),
  ).toBe(1);
}, 120000);

test("a fresh site that starts four times keeps one copy of each statement about a field whose label has an apostrophe", async () => {
  const site = deployment(
    `letter.sign.fields.occupation.label = "Organisation d'origine";`,
  );
  const first = await site.start();
  let last;
  for (let again = 0; again < 3; again++) last = await site.start();
  expect(last.document).toEqual(first.document);
  expect(last.revision).toBe(first.revision);
  expect(
    count(policyOf(last.document), "„Organisation d'origine“ und „Role“"),
  ).toBe(
    count(policyOf(first.document), "„Organisation d'origine“ und „Role“"),
  );
}, 120000);

test("restoring a backup keeps a text the team set to what was once the default", async () => {
  const site = deployment();
  await site.start();
  // "Beruf" is the platform's wording, which the example letter replaces.
  await site.publish({
    copy: { en: { "ui.settings.occupationLabel": "Beruf" } },
  });
  await site.backup();
  await site.publish({
    copy: { en: { "ui.settings.occupationLabel": "Profession" } },
  });

  await site.restore();
  const started = await site.start();
  expect(started.document.locales.en.copy["ui.settings.occupationLabel"]).toBe(
    "Beruf",
  );
}, 120000);

test("a start that changes stored texts publishes them as a new revision, so a draft from before is refused as stale", async () => {
  const site = deployment();
  const fresh = await site.start();
  const before = fromBefore(fresh.document, {
    "ui.emailModal.delayedHint": HINT_BEFORE,
  });
  await site.storeFromBefore(before);

  const started = await site.start();
  expect(started.revision).toBe(2);
  expect(started.revisions).toEqual([1, 2]);
  const hint = started.document.locales.en.copy["ui.emailModal.delayedHint"];
  expect(hint).toContain("{waitHours}");

  // The admin had this draft open before the upgrade, on revision 1.
  const draft = structuredClone(before);
  draft.locales.en.copy.navCta = "Sign here";
  const published = await site.publish({
    document: draft,
    expectedRevision: 1,
  });
  expect(published.refused).toMatchObject({ status: 409 });
  expect(published.revision).toBe(2);
  expect(published.document.locales.en.copy["ui.emailModal.delayedHint"]).toBe(
    hint,
  );
}, 120000);

const REGION_WITH_NAME = `
  letter.features.kreisverbandField = true;
  letter.features.stateResolution = true;
  letter.features.publicSignerDetails = false;
`;
const REGION_AS_DETAIL = `
  letter.features.kreisverbandField = true;
  letter.features.stateResolution = true;
  letter.features.publicSignerDetails = true;
`;
const WITH_NAME =
  "erscheinen dein Name, dein Kreisverband und das daraus ermittelte Bundesland sowie das Datum";
const ONLY_WITH_DETAILS =
  "Nur dann erscheinen auch dein Kreisverband und das daraus ermittelte Bundesland in der Liste.";

test("when signers start to choose their details, an unedited policy becomes the new default", async () => {
  const site = deployment(REGION_WITH_NAME);
  expect(policyOf((await site.start()).document)).toContain(WITH_NAME);
  site.configure(REGION_AS_DETAIL);

  const started = await site.start();
  expect(policyOf(started.document)).toBe(
    policyOf((await deployment(REGION_AS_DETAIL).start()).document),
  );
}, 120000);

test("when signers start to choose their details, an edited policy no longer says a public name shows the region, and the team is told", async () => {
  const site = deployment(REGION_WITH_NAME);
  const first = await site.start();
  const own = "<p>We are a small team and answer every message.</p>";
  await site.publish({
    copy: { en: { "legal.privacyHtml": policyOf(first.document) + own } },
  });
  site.configure(REGION_AS_DETAIL);

  const started = await site.start();
  const policy = policyOf(started.document);
  expect(policy).not.toContain(WITH_NAME);
  expect(policy).toContain("erscheinen dein Name sowie das Datum");
  expect(count(policy, ONLY_WITH_DETAILS)).toBe(1);
  expect(policy).toContain(own);
  expect(started.revision).toBe(3);
  expect(JSON.stringify(started.log)).toContain("legal.privacyHtml");

  const again = await site.start();
  expect(again.document).toEqual(started.document);
  expect(again.revision).toBe(started.revision);
}, 120000);

test("when signers start to choose their details, a sentence the team wrote itself stays, the new statement is added once, and the team is told", async () => {
  const site = deployment(REGION_WITH_NAME);
  const first = await site.start();
  const ownSentence =
    "Mit deiner Zustimmung zeigen wir deinen Namen, deine Region und dein Bundesland.";
  const edited = policyOf(first.document).replace(
    /Wenn du zustimmst, dass dein Name öffentlich angezeigt wird, erscheinen dein Name[^.]*\./,
    ownSentence,
  );
  expect(edited).toContain(ownSentence);
  await site.publish({ copy: { en: { "legal.privacyHtml": edited } } });
  site.configure(REGION_AS_DETAIL);

  const started = await site.start();
  const policy = policyOf(started.document);
  expect(policy).toContain(ownSentence);
  expect(count(policy, ONLY_WITH_DETAILS)).toBe(1);
  expect(JSON.stringify(started.log)).toContain("legal.privacyHtml");
  for (let again = 0; again < 2; again++) {
    const next = await site.start();
    expect(next.document).toEqual(started.document);
    expect(next.revision).toBe(started.revision);
  }
}, 120000);

// A policy the team wrote itself, in German, on the English example letter.
// It has none of the default's paragraphs and none of its phrases.
const OWN_GERMAN_POLICY = (placeholders) =>
  `<h4>Datenschutz</h4><p>Wir speichern deine Unterschrift. ${placeholders.join(" ")}</p>`;

test("a policy the team wrote in German on an English letter gains its paragraphs in German when the letter says so", async () => {
  const site = deployment(`letter.legal.privacyLanguage = "de";`);
  const fresh = await site.start();
  const placeholders = [
    ...new Set(policyOf(fresh.document).match(/\{\{\w+\}\}/g)),
  ].filter((token) => token !== "{{adminLogDays}}");
  const before = structuredClone(fresh.document);
  before.locales.en.copy["legal.privacyHtml"] = OWN_GERMAN_POLICY(placeholders);
  await site.storeFromBefore(before);

  const started = await site.start();
  const added = policyOf(started.document).slice(
    OWN_GERMAN_POLICY(placeholders).length,
  );
  expect(added).toContain(
    `<p>${adminLogPrivacy("{{adminLogDays}}")}</p><p>${handEntryPrivacy()}</p>`,
  );
  expect(added).toContain("Zu deiner Unterschrift speichern wir außerdem");
  expect(added).not.toMatch(/internal log|by hand|With your signature/);
}, 120000);

test("a policy the team rewrote in German on an English letter keeps gaining German text", async () => {
  const withoutFields = `
    letter.features.occupationField = false;
    letter.features.publicSignerDetails = false;
    delete letter.sign.fields.signerFunction;
  `;
  const site = deployment(withoutFields);
  const first = await site.start();
  const placeholders = [
    ...new Set(policyOf(first.document).match(/\{\{\w+\}\}/g)),
  ];
  // The default, rewritten until none of its paragraphs is left.
  const own = `<h4>Datenschutz</h4><p>Wir speichern deine Unterschrift und löschen sie auf Wunsch. ${placeholders.join(" ")}</p>`;
  await site.publish({ copy: { en: { "legal.privacyHtml": own } } });
  site.configure(
    withoutFields.replace("occupationField = false", "occupationField = true"),
  );

  const started = await site.start();
  expect(policyOf(started.document)).toBe(
    `${own}<p>Zu deiner Unterschrift speichern wir außerdem optional Organisation. Für Unterschriften, deren Name öffentlich angezeigt wird, veröffentlichen wir die Anzahl je Angabe im Feld „Organisation“, getrennt von den Namen.</p>`,
  );
}, 120000);

test("a start does not overwrite a publication made while it was preparing", async () => {
  const admin = deployment(`letter.navCta = "Sign the letter";`);
  await admin.start();
  // A second server process on the same database, with the letter changed.
  const upgrade = deployment(`letter.navCta = "Add your name";`, {
    sharing: admin,
  });
  const held = upgrade.startHeld();
  await held.reached;
  const published = await admin.publish({
    copy: { en: { "sign.formTitle": "Published during the start" } },
  });
  expect(published).not.toHaveProperty("refused");
  expect(published.revision).toBe(2);
  held.release();

  const started = await held.done;
  expect(started).toMatchObject({ started: true, revision: 3 });
  expect(started.document.locales.en.copy).toMatchObject({
    "sign.formTitle": "Published during the start",
    navCta: "Add your name",
  });
  // What the admin published is the publication before, as it was.
  expect(started.stored[2].locales.en.copy).toMatchObject({
    "sign.formTitle": "Published during the start",
    navCta: "Sign the letter",
  });
}, 120000);

test("two servers that start on an empty database at once both start", async () => {
  const first = deployment();
  const second = deployment("", { sharing: first });
  const held = first.startHeld();
  await held.reached;
  expect(await second.start()).toMatchObject({ started: true, revision: 1 });
  held.release();
  expect(await held.done).toMatchObject({
    started: true,
    revision: 1,
    revisions: [1],
  });
}, 120000);

const markOf = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value))
    .digest("base64url")
    .slice(0, 22);
// What the unreleased version before the site's record kept in app_settings:
// a mark of every field's default. `defaults` are the ones that differed from
// the example letter's.
const earlierRecord = (defaults) => ({
  "publication:copy-defaults": {
    en: Object.fromEntries(
      publicationFields.en.map((field) => [
        field.path,
        markOf(
          field.path in defaults
            ? defaults[field.path]
            : field.type === "html"
              ? sanitizeRich(field.default)
              : field.default,
        ),
      ]),
    ),
  },
});

test("a site with the earlier record of its defaults keeps a text the team set to an earlier default, and its untouched texts follow theirs", async () => {
  const site = deployment(`letter.navCta = "Sign the letter";`);
  const fresh = await site.start();
  const stored = structuredClone(fresh.document);
  // "Beruf" is the platform's wording, which the example letter replaces.
  stored.locales.en.copy["ui.settings.occupationLabel"] = "Beruf";
  await site.storeFromBefore(
    stored,
    earlierRecord({ navCta: "Sign the letter" }),
  );
  site.configure(`letter.navCta = "Add your name";`);

  const started = await site.start();
  expect(started.document.locales.en.copy).toMatchObject({
    "ui.settings.occupationLabel": "Beruf",
    navCta: "Add your name",
  });
  const again = await site.start();
  expect(again.document).toEqual(started.document);
  expect(again.revision).toBe(started.revision);
}, 120000);

test("a publication that the upgrade takes over the size limit still starts, and has to be shortened before the next publication", async () => {
  const site = deployment();
  const fresh = await site.start();
  const before = fromBefore(fresh.document);
  const faq = before.locales.en.blocks.faq;
  faq.items = Array.from({ length: 20 }, (_, index) => ({
    id: `q${index}`,
    questionHtml: `<p>Question ${index}</p>`,
    answerHtml: "<p></p>",
  }));
  const room = 1999900 - JSON.stringify(before).length;
  for (const item of faq.items)
    item.answerHtml = `<p>${"x".repeat(Math.floor(room / 20))}</p>`;
  expect(JSON.stringify(before).length).toBeLessThanOrEqual(2000000);
  await site.storeFromBefore(before);

  const started = await site.start();
  expect(started).toMatchObject({ started: true });
  expect(policyOf(started.document)).toContain("Prüfsumme");
  expect(JSON.stringify(started.document).length).toBeGreaterThan(2000000);

  const published = await site.publish({
    copy: { en: { navCta: "Sign here" } },
  });
  expect(published.refused).toMatchObject({ status: 400 });
  expect(published.refused.message).toContain("2 MB");
}, 120000);

test("a start that replaces a text leaves the publication before as it was published, and the admin log holds the whole text", async () => {
  const site = deployment(`letter.navCta = "Sign the letter";`);
  await site.start();
  const own = `Our own words. ${"x".repeat(700)} The end of our own words`;
  await site.publish({ copy: { en: { navCta: own } } });
  // A default of one sentence, with a placeholder the team's text lacks.
  site.configure(`letter.navCta = "Sign with {count} others.";`);

  const started = await site.start();
  expect(started.revision).toBe(3);
  expect(started.document.locales.en.copy.navCta).toBe(
    "Sign with {count} others.",
  );
  expect(started.stored[2].locales.en.copy.navCta).toBe(own);
  expect(JSON.stringify(started.log)).toContain("The end of our own words");
  // Loaded as a draft, the publication before is one the letter accepts.
  expect(started.previous.locales.en.copy.navCta).toBe(
    "Sign with {count} others.",
  );
  const published = await site.publish({ document: started.previous });
  expect(published).not.toHaveProperty("refused");
  expect(published.stored[3]).toEqual(started.stored[3]);
}, 120000);

test("after a backup is restored, a draft from the publication the restore discarded is refused, also when a start has used its revision number again", async () => {
  const site = deployment(`letter.navCta = "Sign the letter";`);
  await site.backup();
  const discarded = await site.publish({
    copy: { en: { "sign.formTitle": "Published after the backup" } },
  });
  expect(discarded.revision).toBe(2);
  await site.restore();
  site.configure(`letter.navCta = "Add your name";`);

  const started = await site.start();
  expect(started.revision).toBe(2);
  expect(started.document.locales.en.copy.navCta).toBe("Add your name");

  const draft = structuredClone(discarded.document);
  draft.locales.en.copy["sign.formSubtitle"] = "An edit nobody published";
  const submitted = await site.publish({
    document: draft,
    expectedRevision: discarded.revision,
    expectedId: discarded.id,
  });
  expect(submitted.refused).toMatchObject({ status: 409 });
  expect(submitted.revision).toBe(2);
  expect(submitted.document.locales.en.copy.navCta).toBe("Add your name");
}, 120000);

const ENGLISH_ONLY = `
  letter.features.multiLanguage = true;
  letter.languages = ["en"];
`;
const WITH_GERMAN = (changes = "") => `
  letter.features.multiLanguage = true;
  letter.languages = ["en", "de"];
  letter.i18n ??= {};
  letter.i18n.de ??= {};
  ${changes}
`;

test("a draft from before a language was switched off is refused once the language is back with a changed default", async () => {
  const site = deployment(
    WITH_GERMAN(`letter.i18n.de.navCta = "Jetzt unterzeichnen";`),
  );
  const first = await site.start();
  expect(first.document.locales.de.copy.navCta).toBe("Jetzt unterzeichnen");
  site.configure(ENGLISH_ONLY);
  expect((await site.start()).document.locales.de).toBeUndefined();
  site.configure(WITH_GERMAN(`letter.i18n.de.navCta = "Unterschreib mit";`));

  const back = await site.start();
  expect(back.document.locales.de.copy.navCta).toBe("Unterschreib mit");
  expect(JSON.stringify(back.log)).toContain("navCta");

  const draft = structuredClone(first.document);
  draft.locales.en.copy.navCta = "An edit from before";
  const submitted = await site.publish({
    document: draft,
    expectedRevision: first.revision,
    expectedId: first.id,
  });
  expect(submitted.refused).toMatchObject({ status: 409 });
  expect(submitted.document.locales.de.copy.navCta).toBe("Unterschreib mit");
}, 120000);

test("a language that comes back from a publication's archive follows its changed default as a new revision", async () => {
  const site = deployment(
    WITH_GERMAN(`letter.i18n.de.navCta = "Jetzt unterzeichnen";`),
  );
  await site.start();
  site.configure(ENGLISH_ONLY);
  const without = await site.publish({
    copy: { en: { "sign.formTitle": "Published in English only" } },
  });
  expect(without.revision).toBe(2);
  expect(without.stored[2].archive.locales.de.copy.navCta).toBe(
    "Jetzt unterzeichnen",
  );
  site.configure(WITH_GERMAN(`letter.i18n.de.navCta = "Unterschreib mit";`));

  const back = await site.start();
  expect(back.revision).toBe(3);
  expect(back.document.locales.de.copy.navCta).toBe("Unterschreib mit");
  expect(JSON.stringify(back.log)).toContain("navCta");
  const again = await site.start();
  expect(again.revision).toBe(3);
  expect(again.document).toEqual(back.document);
  expect(again.log).toEqual(back.log);
}, 120000);

test("a language that was switched off while the site was upgraded gets the paragraphs it lacks once it is back", async () => {
  const site = deployment(WITH_GERMAN());
  const fresh = await site.start();
  await site.storeFromBefore(fromBefore(fresh.document));
  site.configure(ENGLISH_ONLY);
  expect(policyOf((await site.start()).document)).toBe(
    policyOf(fresh.document),
  );
  site.configure(WITH_GERMAN());

  const back = await site.start();
  expect(policyOf(back.document, "de")).toBe(policyOf(fresh.document, "de"));
  expect(JSON.stringify(back.log)).toContain("legal.privacyHtml");
  const again = await site.start();
  expect(again.revision).toBe(back.revision);
  expect(again.document).toEqual(back.document);
}, 120000);

test("the publication before, loaded as a draft and published again, says what the form asks for now", async () => {
  const site = deployment(REGION_WITH_NAME);
  const first = await site.start();
  const own = "<p>We are a small team and answer every message.</p>";
  await site.publish({
    copy: { en: { "legal.privacyHtml": policyOf(first.document) + own } },
  });
  site.configure(REGION_AS_DETAIL);
  const started = await site.start();
  expect(started.revision).toBe(3);
  expect(policyOf(started.stored[2])).toContain(WITH_NAME);

  const published = await site.publish({
    document: started.previous,
    expectedRevision: started.revision,
    expectedId: started.id,
  });
  expect(published).not.toHaveProperty("refused");
  const policy = policyOf((await site.start()).document);
  expect(policy).not.toContain(WITH_NAME);
  expect(count(policy, ONLY_WITH_DETAILS)).toBe(1);
  expect(policy).toContain(own);
}, 120000);

test("a privacy policy from the letter's config gains what the letter stores and shows, and follows the config while nobody edits it", async () => {
  const supplied = (text) => `
    letter.features.kreisverbandField = true;
    letter.legal.privacyLanguage = "en";
    letter.legal.privacyHtml = "<p>${text}</p>";
  `;
  const site = deployment(supplied("Our own privacy policy."));

  const first = await site.start();
  const policy = policyOf(first.document);
  expect(policy).toStartWith("<p>Our own privacy policy.</p>");
  for (const paragraph of [
    blockedAddressPrivacy("{{signerRetentionYears}}", "en"),
    adminLogPrivacy("{{adminLogDays}}", "en"),
    handEntryPrivacy("en"),
  ])
    expect(count(policy, `<p>${paragraph}</p>`)).toBe(1);
  expect(policy).toContain(
    "With your signature we also store these optional details: Kreisverband and Organisation and Role.",
  );
  expect(policy).toContain(
    "Only then does the list also show your Kreisverband.",
  );
  expect(first.revision).toBe(1);
  expect(first.log).toEqual([]);
  const again = await site.start();
  expect(again.revision).toBe(1);
  expect(again.document).toEqual(first.document);

  site.configure(supplied("Our own privacy policy, second edition."));
  expect(policyOf((await site.start()).document)).toBe(
    policy.replace(
      "Our own privacy policy.",
      "Our own privacy policy, second edition.",
    ),
  );
}, 120000);

const WITHOUT_FIELDS = `
  letter.features.occupationField = false;
  letter.features.publicSignerDetails = false;
  delete letter.sign.fields.signerFunction;
`;

test("an edited policy with no room for a new statement stays as it is, and the team is told once", async () => {
  const site = deployment(WITHOUT_FIELDS);
  const first = await site.start();
  const policy = policyOf(first.document);
  const own = (filler) => `<p>Our own long policy. ${filler}</p>${policy}`;
  const edited = own("x".repeat(119999 - own("").length));
  expect(edited).toHaveLength(119999);
  const published = await site.publish({
    copy: { en: { "legal.privacyHtml": edited } },
  });
  expect(published).not.toHaveProperty("refused");
  site.configure(`${WITHOUT_FIELDS} letter.features.kreisverbandField = true;`);

  const started = await site.start();
  expect(started).toMatchObject({ started: true, revision: 2 });
  expect(policyOf(started.document)).toBe(edited);
  expect(started.log).toHaveLength(1);
  expect(started.log[0]).toMatchObject({ action: "website.upgrade" });
  expect(started.log[0].detail).toContain("legal.privacyHtml");
  const again = await site.start();
  expect(again.revision).toBe(2);
  expect(again.log).toEqual(started.log);
}, 120000);

test("a text of the letter that is longer than the limit once it is stored is stored once, and the site can still be published", async () => {
  const site = deployment(`letter.legal.exampleHtml = "<p>A short text.</p>";`);
  await site.start();
  // 119,992 characters as the config has it, more once the link is stored.
  site.configure(
    `letter.legal.exampleHtml = "<p>" + "x".repeat(119950) + '<a href="https://example.org">e</a></p>';`,
  );

  const first = await site.start();
  expect(first).toMatchObject({ started: true, revision: 2 });
  expect(
    first.document.locales.en.copy["legal.exampleHtml"].length,
  ).toBeGreaterThan(120000);
  for (let again = 0; again < 3; again++) {
    const next = await site.start();
    expect(next.revision).toBe(2);
    expect(next.revisions).toEqual(first.revisions);
    expect(next.document).toEqual(first.document);
    expect(next.log).toEqual(first.log);
  }
  const published = await site.publish({
    copy: { en: { navCta: "Sign here" } },
  });
  expect(published).not.toHaveProperty("refused");
}, 120000);

// Starting again leaves everything as the start before left it.
async function settled(site) {
  const first = await site.start();
  expect(first).toMatchObject({ started: true });
  for (let again = 0; again < 2; again++) {
    const next = await site.start();
    expect(next.revision).toBe(first.revision);
    expect(next.id).toBe(first.id);
    expect(next.stored).toEqual(first.stored);
    expect(next.document).toEqual(first.document);
    expect(next.previous).toEqual(first.previous);
    expect(next.log).toEqual(first.log);
  }
  return first;
}

test("a site settles after every change of its letter: a language off and back, another form, the publication before published again, and a backup restored", async () => {
  const site = deployment(WITH_GERMAN(REGION_WITH_NAME));
  const fresh = await site.start();
  await site.storeFromBefore(
    fromBefore(fresh.document, { "sign.formTitle": "Our own title" }),
  );
  const upgraded = await settled(site);
  expect(upgraded.document.locales.en.copy["sign.formTitle"]).toBe(
    "Our own title",
  );
  const own = "<p>We are a small team and answer every message.</p>";
  await site.publish({
    copy: { en: { "legal.privacyHtml": policyOf(upgraded.document) + own } },
  });

  site.configure(`${ENGLISH_ONLY} ${REGION_WITH_NAME}`);
  const english = await settled(site);
  expect(english.document.locales.de).toBeUndefined();
  await site.backup();

  site.configure(
    WITH_GERMAN(
      `${REGION_AS_DETAIL} letter.i18n.de.navCta = "Unterschreib mit";`,
    ),
  );
  const changed = await settled(site);
  expect(changed.document.locales.de.copy.navCta).toBe("Unterschreib mit");
  for (const lang of ["en", "de"]) {
    expect(policyOf(changed.document, lang)).not.toContain(WITH_NAME);
    expect(count(policyOf(changed.document, lang), ONLY_WITH_DETAILS)).toBe(1);
  }
  expect(policyOf(changed.document)).toContain(own);

  const published = await site.publish({
    document: changed.previous,
    expectedRevision: changed.revision,
    expectedId: changed.id,
  });
  expect(published).not.toHaveProperty("refused");
  const again = await settled(site);
  expect(policyOf(again.document)).toBe(policyOf(changed.document));

  await site.restore();
  const restored = await settled(site);
  expect(restored.document.locales.de.copy.navCta).toBe("Unterschreib mit");
  for (const lang of ["en", "de"]) {
    expect(policyOf(restored.document, lang)).not.toContain(WITH_NAME);
    expect(count(policyOf(restored.document, lang), ONLY_WITH_DETAILS)).toBe(1);
  }
  expect(policyOf(restored.document)).toContain(own);
  expect(restored.document.locales.en.copy["sign.formTitle"]).toBe(
    "Our own title",
  );
}, 600000);
