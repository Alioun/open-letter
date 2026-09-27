// Person language (features.multiLanguage): a signer's or registrant's
// language picks their mails, links and link pages. The flag-on cases run in a
// child process whose letter has the flag set before the config loads
// (test/fixtures/multi-language.js); this process runs the letter as shipped,
// with the flag off.
import { describe, test, expect, beforeEach, beforeAll } from "bun:test";
import { join } from "node:path";
import { resetDb, addTemplate } from "./helpers.js";
import * as q from "../server/db.js";
import {
  renderTemplateBySlug,
  campaignVersion,
  zoomCalendarButton,
  langUrl,
  pageUrl,
} from "../server/email.js";
import { prepareQueuedEmail } from "../server/queued-email.js";
import { simplePage } from "../server/pages.js";
import { storedLang } from "../config/i18n.js";
import cfg from "../config/letter.config.js";

const root = join(import.meta.dir, "..");
const base = "https://example.org";
const future = () => new Date(Date.now() + 3600_000);

let on;
beforeAll(() => {
  const run = Bun.spawnSync(
    [
      process.execPath,
      "--preload",
      "./test/fixtures/multi-language.js",
      "./test/fixtures/person-lang-check.js",
    ],
    { cwd: root, env: { ...process.env, LETTER_CONFIG: "gehaltsdeckel" } },
  );
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  on = JSON.parse(run.stdout.toString().trim().split("\n").pop());
});

describe("flag on: person language", () => {
  test("stored from the page language, normalised; default and unknown are NULL", () => {
    expect(on.stored).toEqual({ en: "en", EN: "en", fr: null, none: null });
    expect(on.pendingLang).toBe("en");
  });

  test("queued mail carries the language and its settings link", () => {
    expect(on.queued.en.lang).toBe("en");
    expect(on.queued.en.unsubscribeUrl).toStartWith(`${base}/en/abmelden/`);
    expect(on.queued.de.lang).toBeNull();
    expect(on.queued.de.unsubscribeUrl).toStartWith(`${base}/abmelden/`);
  });

  test("mail text in the person language, default for NULL and unknown", () => {
    expect(on.mail.en.subject).toBe("Confirm your signature, Pia");
    expect(on.mail.en.html).toContain("Unsubscribe here");
    expect(on.mail.de.html).toContain("Hier abmelden");
    expect(on.mail.fr).toEqual(on.mail.de);
    // No English template: the default text, with the English footer.
    expect(on.mail.enFallback.subject).toBe(on.mail.deFallback.subject);
    expect(on.mail.enFallback.html).toContain("Unsubscribe here");
    expect(on.calendar.en).toContain("Add to calendar");
    expect(on.calendar.de).toContain("Zum Kalender hinzufügen");
    expect(on.ics).toContain("PRODID:-//Gehaltsdeckel jetzt//Treffen//EN");
  });

  test("link pages in the person language", () => {
    expect(on.page.en).toContain('<html lang="en">');
    expect(on.page.de).toContain('<html lang="de">');
    expect(on.page.enError).toBe("Error");
  });

  test("campaign: own template and subject per language, else the default", () => {
    expect(on.campaign.en).toEqual({ lang: "en", subject: "News", body: "<p>en</p>" });
    expect(on.campaign.de).toEqual({ lang: null, subject: "Neuigkeiten", body: "<p>de</p>" });
    expect(on.campaign.fr).toEqual(on.campaign.de);
    expect(on.campaign.enSubjectOnly).toEqual({ lang: "en", subject: "News!", body: "<p>de</p>" });
    expect(on.campaign.enMissingTemplate.body).toBe("<p>de</p>");
    expect(on.campaign.enNone.subject).toBe("Neuigkeiten");
  });
});

describe("flag off: unchanged", () => {
  beforeEach(resetDb);

  test("any language asked for is the default: nothing stored, no prefix", async () => {
    expect(storedLang(cfg, "en")).toBeNull();
    expect(langUrl(`${base}/api/confirm/t`, "en")).toBe(`${base}/api/confirm/t`);
    expect(pageUrl(base, "/abmelden/t", "en")).toBe(`${base}/abmelden/t`);
  });

  test("mails render as without a language", async () => {
    const vars = { name: "Ada", firstName: "Ada", unsubscribeUrl: `${base}/u` };
    for (const slug of Object.keys(cfg.email.templates)) {
      expect(await renderTemplateBySlug(slug, vars, "en")).toEqual(
        await renderTemplateBySlug(slug, vars),
      );
    }
    expect(zoomCalendarButton("https://x", "en")).toBe(zoomCalendarButton("https://x"));
    expect(simplePage("<p>x</p>", cfg)).toContain('<html lang="de">');
  });

  test("a stored language is ignored", async () => {
    await q.insertSigner({
      name: "Pia",
      email: "p@example.org",
      kv: "",
      occupation: "",
      newsletter: true,
      showPublicly: true,
      token: "t",
      expiresAt: future(),
      lang: "en",
    });
    const signerId = await q.getSignerIdByEmail("p@example.org");
    const args = await prepareQueuedEmail({ kind: "verification", signerId, baseUrl: base });
    expect(args.unsubscribeUrl).toStartWith(`${base}/abmelden/`);
    const c = { subject: "S", i18n: { en: { subject: "E" } } };
    const v = await campaignVersion(c, { html_body: "<p>d</p>" }, "en");
    expect(v).toEqual({ lang: undefined, template: { html_body: "<p>d</p>" }, subject: "S" });
  });

  test("campaigns list answers without the i18n field", async () => {
    const t = await addTemplate();
    await q.createCampaign({
      templateId: t.id,
      subject: "S",
      scheduledAt: future(),
      i18n: { en: { subject: "E" } },
    });
    const [row] = await q.listCampaigns();
    expect("i18n" in row).toBe(false);
  });
});
