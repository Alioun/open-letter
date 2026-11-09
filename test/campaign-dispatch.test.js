import { test, expect, beforeEach } from "bun:test";
import { resetDb, addVerifiedSigner, addTemplate, db } from "./helpers.js";
import * as repository from "../server/db.js";
import { createCampaignDelivery } from "../server/campaign-delivery.js";
import { createEmailManager } from "../server/email-setup.js";
import { installEmailManager, campaignVersion } from "../server/email.js";
import { installTemplates } from "../server/template-snapshot.js";
import cfg from "../config/letter.config.js";

beforeEach(async () => {
  await resetDb();
  await db.run(await Bun.file("db/publishing.sql").text());
  await db.run(
    "DELETE FROM email_attempts; DELETE FROM email_quota; DELETE FROM email_configuration;",
  );
});
const profile = {
  provider: "smtp",
  from: "sender@example.org",
  host: "smtp.example.org",
  port: 587,
  secure: false,
  user: "sender@example.org",
  secret: "fixture-password",
  processor: "Fixture",
  region: "EU",
};
async function setup(sendMail) {
  const manager = await createEmailManager(db, cfg, {
    createTransport: () => ({ verify: async () => {}, sendMail }),
    sleep: async () => {
      await db.query("UPDATE email_quota SET next_at=0").run();
    },
  });
  await manager.save(null, 0, true);
  await manager.save(profile, 1);
  await manager.test(2, "admin@example.org");
  await manager.confirmReceipt(2, manager.status.validation.id);
  await manager.activate(2);
  installEmailManager(manager);
  const template = await addTemplate({
    slug: "newsletter-dispatch",
    html_body: '<p>{{name}}</p><a href="{{unsubscribeUrl}}">Preferences</a>',
  });
  installTemplates([template]);
  const service = createCampaignDelivery({
    baseUrl: "https://example.org",
    getZoomConfig: async () => null,
    zoomIn: (z) => z,
    buildMeetingInfo: () => "",
    treffenSignupUrls: () => ({}),
  });
  return { manager, template, service };
}
async function campaign(template) {
  return repository.createCampaign({
    templateId: template.id,
    subject: "Fixture",
    scheduledAt: new Date(),
  });
}

test("campaign language versions retain retired translation identities", async () => {
  const { template } = await setup(async () => {});
  const translation = await addTemplate({
    slug: "newsletter-retired-de",
    subject: "Gespeicherte Übersetzung",
  });
  installTemplates([]);
  const features = cfg.features,
    languages = cfg.languages;
  try {
    cfg.features = { ...features, multiLanguage: true };
    cfg.languages = ["en", "de"];
    const resolved = await campaignVersion(
      { subject: "Default", i18n: { de: { templateId: translation.id } } },
      template,
      "de",
    );
    expect(resolved.template.id).toBe(translation.id);
    expect(resolved.subject).toBe("Gespeicherte Übersetzung");
  } finally {
    cfg.features = features;
    cfg.languages = languages;
  }
});

test("replaying an accepted logical message preserves its original credentials", async () => {
  const accepted = [];
  const { manager } = await setup(async (payload) => accepted.push(payload));
  let credentialsIssued = 0;
  const prepare = async () => ({
    to: "replay@example.org",
    subject: "Private link",
    html: `<a href="https://example.org/private/${++credentialsIssued}">Statistics</a>`,
  });
  await manager.send(prepare, { scope: "stable-logical-message" });
  await manager.send(prepare, { scope: "stable-logical-message" });
  expect(credentialsIssued).toBe(1);
  expect(
    accepted.filter((payload) => payload.to === "replay@example.org"),
  ).toHaveLength(1);
});

test("campaign rechecks opt-out and erasure after the first provider request", async () => {
  const calls = [];
  let release, entered;
  const started = new Promise((r) => (entered = r));
  const held = new Promise((r) => (release = r));
  const { template, service } = await setup(async (p) => {
    if (p.to === "admin@example.org") return;
    calls.push(p.to);
    if (calls.length === 1) {
      entered();
      await held;
    }
  });
  const first = await addVerifiedSigner({ email: "first@example.org" });
  const opted = await addVerifiedSigner({ email: "opted@example.org" });
  const erased = await addVerifiedSigner({ email: "erased@example.org" });
  const c = await campaign(template);
  const work = service.handle({ campaignId: c.id });
  await started;
  try {
    await repository.optOutNewsletterByEmail(opted.email);
    await repository.eraseEmail(erased.email);
  } finally {
    release();
  }
  await work;
  expect(calls).toEqual([first.email]);
  expect((await repository.getCampaignById(c.id)).status).toBe("sent");
  expect(await repository.getDeliveredEmails(`campaign:${c.id}`)).toEqual(
    new Set([first.email]),
  );
});

test("erasing a person while their own provider request is in flight leaves no attempts or delivery address", async () => {
  let entered, release;
  const started = new Promise((r) => (entered = r)),
    held = new Promise((r) => (release = r));
  const { template, service } = await setup(async (p) => {
    if (p.to === "admin@example.org") return;
    entered();
    await held;
  });
  const person = await addVerifiedSigner();
  const c = await campaign(template);
  const work = service.handle({ campaignId: c.id });
  await started;
  try {
    await repository.eraseEmail(person.email);
  } finally {
    release();
  }
  await work;
  expect(await repository.getDeliveredEmails(`campaign:${c.id}`)).toEqual(
    new Set(),
  );
  expect(
    (await db.query("SELECT COUNT(*) n FROM email_attempts").get()).n,
  ).toBe(0);
});

test("uncertain SMTP recipient remains pending while later recipients are accepted once", async () => {
  const calls = [];
  const { template, service } = await setup(async (p) => {
    if (p.to === "admin@example.org") return;
    calls.push(p.to);
    if (p.to === "uncertain@example.org")
      throw new Error("socket closed after DATA");
  });
  await addVerifiedSigner({ email: "uncertain@example.org" });
  await addVerifiedSigner({ email: "later@example.org" });
  const c = await campaign(template);
  await service.handle({ campaignId: c.id });
  expect(calls).toEqual(["uncertain@example.org", "later@example.org"]);
  await db
    .query(
      "UPDATE campaigns SET heartbeat_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(c.id);
  await service.handle({ campaignId: c.id });
  expect(calls).toEqual(["uncertain@example.org", "later@example.org"]);
  expect(await repository.getDeliveredEmails(`campaign:${c.id}`)).toEqual(
    new Set(["later@example.org"]),
  );
  expect((await repository.getCampaignById(c.id)).status).toBe("failed");
});

test("one paced run renders and accepts every recipient without restarting its audience", async () => {
  const calls = [];
  const { template, service } = await setup(async (p) => {
    if (p.to !== "admin@example.org") calls.push(p.to);
  });
  for (let i = 0; i < 5; i++) await addVerifiedSigner();
  const c = await campaign(template);
  await service.handle({ campaignId: c.id });
  expect(calls).toHaveLength(5);
  expect(new Set(calls).size).toBe(5);
  expect(
    (await db.query("SELECT attempts FROM campaigns WHERE id=?").get(c.id))
      .attempts,
  ).toBe(1);
  expect(
    (
      await db
        .query("SELECT COUNT(*) n FROM email_attempts WHERE status='delivered'")
        .get()
    ).n,
  ).toBe(5);
});
