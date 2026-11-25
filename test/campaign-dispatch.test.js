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

test("a retry counts people reached before they left the audience", async () => {
  let failing = true;
  const { template, service } = await setup(async (p) => {
    if (failing && p.to === "late@example.org")
      throw new Error("socket closed after DATA");
  });
  const left = await addVerifiedSigner({ email: "left@example.org" });
  await addVerifiedSigner({ email: "stays@example.org" });
  await addVerifiedSigner({ email: "late@example.org" });
  const c = await campaign(template);
  await service.handle({ campaignId: c.id });
  await db.query("UPDATE signers SET newsletter = 0 WHERE id = ?").run(left.id);
  await db
    .query(
      "UPDATE campaigns SET heartbeat_at='2000-01-01T00:00:00.000Z' WHERE id=?",
    )
    .run(c.id);
  failing = false;
  await service.handle({ campaignId: c.id });
  const listed = (await repository.listCampaigns()).find(
    (row) => row.id === c.id,
  );
  expect(listed.sent_offset).toBeLessThanOrEqual(listed.audience_size);
  expect(listed.audience_size).toBe(3);
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
  const [listed] = await repository.listCampaigns();
  expect(listed).toMatchObject({ audience_size: 5, sent_offset: 5 });
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

// A send held inside the provider request for its first recipient.
async function heldSend({ failing = () => false } = {}) {
  const calls = [];
  let entered, release;
  const started = new Promise((r) => (entered = r));
  const held = new Promise((r) => (release = r));
  const fixture = await setup(async (p) => {
    if (p.to === "admin@example.org") return;
    calls.push(p.to);
    if (calls.length === 1) {
      entered();
      await held;
    }
    if (failing(p.to)) throw new Error("socket closed after DATA");
  });
  return { ...fixture, calls, started, release };
}

test("a stopped send finishes the mail in flight, mails nobody else, and resumes without repeats", async () => {
  const { template, service, calls, started, release } = await heldSend();
  for (const name of ["first", "second", "third"])
    await addVerifiedSigner({ email: `${name}@example.org` });
  const c = await campaign(template);
  const work = service.handle({ campaignId: c.id });
  await started;
  let reachedAtStop;
  try {
    reachedAtStop = await repository.stopCampaign(c.id);
  } finally {
    release();
  }
  await work;
  expect(reachedAtStop).toBe(0);
  expect(calls).toEqual(["first@example.org"]);
  const [stopped] = await repository.listCampaigns();
  expect(stopped).toMatchObject({
    status: "aborted",
    sent_offset: 1,
    failure: { category: "stopped-by-admin" },
  });

  expect(await repository.retryAbortedCampaign(c.id)).toBe(true);
  await service.handle({ campaignId: c.id });
  expect(calls.toSorted()).toEqual([
    "first@example.org",
    "second@example.org",
    "third@example.org",
  ]);
  expect((await repository.getCampaignById(c.id)).status).toBe("sent");
});

test("a send stopped while its mail in flight fails stays stopped", async () => {
  const { template, service, started, release } = await heldSend({
    failing: () => true,
  });
  await addVerifiedSigner();
  const c = await campaign(template);
  const work = service.handle({ campaignId: c.id });
  await started;
  try {
    await repository.stopCampaign(c.id);
  } finally {
    release();
  }
  await work;
  expect((await repository.getCampaignById(c.id)).status).toBe("aborted");
});

test("a send stopped during its last recipient stays stopped when that mail goes out", async () => {
  const { template, service, started, release } = await heldSend({
    failing: () => false,
  });
  await addVerifiedSigner();
  const c = await campaign(template);
  const work = service.handle({ campaignId: c.id });
  await started;
  try {
    await repository.stopCampaign(c.id);
  } finally {
    release();
  }
  await work;
  expect(await repository.getCampaignById(c.id)).toMatchObject({
    status: "aborted",
    sent_offset: 1,
  });
});

test("a send waiting for the mail service can be stopped, one that never began cannot", async () => {
  const { template } = await setup(async () => {});
  await addVerifiedSigner();
  const begun = await campaign(template);
  await repository.claimCampaignById(begun.id);
  await repository.deferCampaign(begun.id, 300);
  expect((await repository.getCampaignById(begun.id)).status).toBe("scheduled");
  expect(await repository.stopCampaign(begun.id)).toBe(0);
  expect(await repository.claimCampaignById(begun.id)).toBeNull();

  const untouched = await repository.createCampaign({
    templateId: template.id,
    subject: "Later",
    scheduledAt: new Date(Date.now() + 3600_000),
  });
  expect(await repository.stopCampaign(untouched.id)).toBeNull();
  expect((await repository.getCampaignById(untouched.id)).status).toBe(
    "scheduled",
  );
  const listed = await repository.listCampaigns();
  expect(
    listed.map((row) => [row.id, row.started]).toSorted((a, b) => a[0] - b[0]),
  ).toEqual([
    [begun.id, true],
    [untouched.id, false],
  ]);
});
