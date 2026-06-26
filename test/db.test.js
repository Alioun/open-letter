import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
  addTemplate,
  setUnsubToken,
  db,
  isoAgoDays,
} from "./helpers.js";
import * as q from "../server/db.js";

beforeEach(resetDb);

const future = () => new Date(Date.now() + 3600_000);
const past = () => new Date(Date.now() - 1000);

describe("signers: insert / confirm / delete", () => {
  test("insertSigner inserts, re-updates while unverified, no-ops once verified", async () => {
    const email = "dup@example.org";
    const r1 = await q.insertSigner({
      name: "First",
      email,
      kv: "Berlin",
      occupation: "Lehrerin",
      newsletter: true,
      showPublicly: true,
      token: "tok-1",
      expiresAt: future(),
    });
    expect(r1.ok).toBe(true);
    expect(r1.alreadyVerified).toBe(false);

    // Same email, still unverified -> updates name.
    const r2 = await q.insertSigner({
      name: "Second",
      email,
      kv: "Hamburg",
      occupation: "",
      newsletter: false,
      showPublicly: true,
      token: "tok-2",
      expiresAt: future(),
    });
    expect(r2.ok).toBe(true);
    expect((await db.query("SELECT name FROM signers WHERE email=?").get(email)).name).toBe("Second");

    // Verify, then a further insert is a no-op (already verified).
    await q.confirmSigner("tok-2");
    const r3 = await q.insertSigner({
      name: "Third",
      email,
      kv: "X",
      occupation: "",
      newsletter: false,
      showPublicly: true,
      token: "tok-3",
      expiresAt: future(),
    });
    expect(r3.ok).toBe(false);
    expect(r3.alreadyVerified).toBe(true);
  });

  test("confirmSigner rejects expired tokens", async () => {
    await q.insertSigner({
      name: "Exp",
      email: "exp@example.org",
      kv: "",
      occupation: "",
      newsletter: false,
      showPublicly: true,
      token: "tok-exp",
      expiresAt: past(),
    });
    expect(await q.confirmSigner("tok-exp")).toBeNull();
  });

  test("deletion token flow deletes the signer", async () => {
    const s = await addVerifiedSigner();
    expect(await q.createDeletionToken(s.email, "del-tok", future())).toBe(true);
    expect(await q.deleteSigner("del-tok")).toBe(true);
    expect((await db.query("SELECT COUNT(*) c FROM signers").get()).c).toBe(0);
  });
});

describe("getSigners + fuzzy search", () => {
  test("pagination and total", async () => {
    for (let i = 0; i < 5; i++) await addVerifiedSigner({ name: `Person ${i}` });
    const page = await q.getSigners({ limit: 2, offset: 0 });
    expect(page.total).toBe(5);
    expect(page.signers).toHaveLength(2);
    // created_at is an ISO string, not a Date
    expect(typeof page.signers[0].created_at).toBe("string");
    expect(page.signers[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test("filter=kv only returns rows with a Kreisverband", async () => {
    await addVerifiedSigner({ name: "HasKV", kreisverband: "Leipzig" });
    await addVerifiedSigner({ name: "NoKV", kreisverband: "" });
    const res = await q.getSigners({ filter: "kv" });
    expect(res.signers.map((s) => s.name)).toEqual(["HasKV"]);
  });

  test("fuzzy: typo in name matches (Schmid -> Schmidt)", async () => {
    await addVerifiedSigner({ name: "Anna Schmidt", kreisverband: "Berlin" });
    await addVerifiedSigner({ name: "Bob Jones", kreisverband: "Köln" });
    const res = await q.getSigners({ search: "Schmid" });
    expect(res.signers.map((s) => s.name)).toContain("Anna Schmidt");
    expect(res.signers.map((s) => s.name)).not.toContain("Bob Jones");
  });

  test("fuzzy: matches on Kreisverband and ranks exact higher", async () => {
    await addVerifiedSigner({ name: "X", kreisverband: "Leipzig" });
    const res = await q.getSigners({ search: "leipzig" });
    expect(res.total).toBe(1);
  });
});

describe("stats", () => {
  test("getStats counts verified/today/week/kv", async () => {
    await addVerifiedSigner({ kreisverband: "Berlin" });
    await addVerifiedSigner({ kreisverband: "Hamburg", created_at: isoAgoDays(3) });
    await addVerifiedSigner({ kreisverband: "Hamburg", created_at: isoAgoDays(30) });
    const s = await q.getStats();
    expect(s.total).toBe(3);
    expect(s.today).toBe(1);
    expect(s.week).toBe(2);
    expect(s.kvCount).toBe(2);
  });

  test("newsletterNotZoomCount excludes signers registered for zoom", async () => {
    const s1 = await addVerifiedSigner({ newsletter: 1 });
    await addVerifiedSigner({ newsletter: 1 });
    await addZoomRegistration({ email: s1.email });
    const ns = await q.getNewsletterStats();
    expect(ns.subscriberCount).toBe(2);
    expect(ns.newsletterNotZoomCount).toBe(1);
  });
});

describe("occupations", () => {
  test("groups gender variants and adds Gendersternchen", async () => {
    await addVerifiedSigner({ occupation: "Lehrer" });
    await addVerifiedSigner({ occupation: "Lehrerin" });
    const occ = await q.getOccupations();
    const lehr = occ.find((o) => o.count === 2);
    expect(lehr).toBeTruthy();
    expect(lehr.occupation).toContain("*");
  });
});

describe("campaigns", () => {
  test("createCampaign stores recipient_ids JSON and listCampaigns counts it", async () => {
    const t = await addTemplate();
    const c = await q.createCampaign({
      templateId: t.id,
      subject: "Hi",
      scheduledAt: new Date(),
      audience: "selection",
      recipientIds: [1, 2, 3],
    });
    expect(c.audience).toBe("selection");
    const list = await q.listCampaigns();
    expect(list[0].selection_count).toBe(3);
    const byId = await q.getCampaignById(c.id);
    expect(byId.recipient_ids).toEqual([1, 2, 3]);
  });

  test("claimCampaignById claims scheduled/failed once, then returns null", async () => {
    const t = await addTemplate();
    const c = await q.createCampaign({
      templateId: t.id,
      subject: "Hi",
      scheduledAt: past(),
    });
    const claimed = await q.claimCampaignById(c.id);
    expect(claimed?.id).toBe(c.id);
    // now 'sending' -> not claimable again
    expect(await q.claimCampaignById(c.id)).toBeNull();
  });

  test("getDueCampaignIds returns only due scheduled/failed", async () => {
    const t = await addTemplate();
    await q.createCampaign({ templateId: t.id, subject: "due", scheduledAt: past() });
    await q.createCampaign({ templateId: t.id, subject: "future", scheduledAt: future() });
    const ids = await q.getDueCampaignIds();
    expect(ids).toHaveLength(1);
  });

  test("getNewsletterRecipientsByIds (ANY->IN) returns picked verified subscribers", async () => {
    const a = await addVerifiedSigner({ newsletter: 1 });
    const b = await addVerifiedSigner({ newsletter: 1 });
    await addVerifiedSigner({ newsletter: 1 });
    const got = await q.getNewsletterRecipientsByIds([a.id, b.id, 99999]);
    expect(got.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("zoom", () => {
  test("insertZoomRegistration round-trips delegierter as boolean", async () => {
    await q.insertZoomRegistration({
      name: "Del",
      email: "del@example.org",
      kv: "Berlin",
      delegierter: true,
    });
    const counts = await q.getZoomCounts();
    expect(counts.zoomCount).toBe(1);
    expect(counts.zoomDelegateCount).toBe(1);
    const reg = await q.getZoomRegistrationByEmail("del@example.org");
    expect(reg.delegierter).toBe(true);
  });

  test("claimZoomMailing is idempotent and markZoomMailing sets sent_at", async () => {
    expect(await q.claimZoomMailing("link")).toBe(true);
    expect(await q.claimZoomMailing("link")).toBe(false); // already sending
    await q.markZoomMailing("link", "sent", 5);
    const m = (await q.listZoomMailings()).find((x) => x.kind === "link");
    expect(m.status).toBe("sent");
    expect(m.recipient_count).toBe(5);
    expect(m.sent_at).toBeTruthy();
  });
});

describe("unsubscribe tokens + 90-day expiry", () => {
  test("getUnsubscribeState honors the 90-day window", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "fresh-tok", 1);
    expect((await q.getUnsubscribeState("fresh-tok"))?.email).toBe(s.email);

    const s2 = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s2.id, "old-tok", 100);
    expect(await q.getUnsubscribeState("old-tok")).toBeNull();
  });

  test("optOutNewsletter clears the subscription", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "opt-tok", 0);
    expect(await q.optOutNewsletter("opt-tok")).toBe(true);
    expect((await db.query("SELECT newsletter FROM signers WHERE id=?").get(s.id)).newsletter).toBe(0);
  });

  test("getUnsubscribeState returns booleans for newsletter/verified", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "bool-tok", 0);
    const st = await q.getUnsubscribeState("bool-tok");
    expect(st.newsletter).toBe(true);
    expect(st.verified).toBe(true);
  });
});

describe("self-service edit (previously broken merge code)", () => {
  test("updateSignerByEmail updates fields and resets state only on KV change", async () => {
    const s = await addVerifiedSigner({ kreisverband: "Berlin", state: "Berlin" });

    // Same KV -> state preserved
    expect(
      await q.updateSignerByEmail(s.email, {
        name: "New Name",
        kreisverband: "Berlin",
        occupation: "Arzt",
        newsletter: false,
        showPublicly: true,
      }),
    ).toBe(true);
    let row = await db.query("SELECT * FROM signers WHERE id=?").get(s.id);
    expect(row.name).toBe("New Name");
    expect(row.occupation).toBe("Arzt");
    expect(row.newsletter).toBe(0);
    expect(row.state).toBe("Berlin"); // unchanged

    // Changed KV -> state reset to ''
    await q.updateSignerByEmail(s.email, {
      name: "New Name",
      kreisverband: "Hamburg",
      occupation: "Arzt",
      newsletter: false,
      showPublicly: true,
    });
    row = await db.query("SELECT * FROM signers WHERE id=?").get(s.id);
    expect(row.kreisverband).toBe("Hamburg");
    expect(row.state).toBe("");
  });

  test("updateZoomByEmail updates a zoom registration", async () => {
    const z = await addZoomRegistration({ delegierter: 0 });
    expect(
      await q.updateZoomByEmail(z.email, {
        name: "Renamed",
        kreisverband: "Köln",
        delegierter: true,
      }),
    ).toBe(true);
    const reg = await q.getZoomRegistrationByEmail(z.email);
    expect(reg.delegierter).toBe(true);
    expect((await db.query("SELECT name FROM zoom_registrations WHERE id=?").get(z.id)).name).toBe("Renamed");
  });

  test("getUnifiedUnsubscribeState returns booleans for showPublicly/delegierter", async () => {
    const s = await addVerifiedSigner({ newsletter: 1, show_publicly: 1 });
    await setUnsubToken(s.id, "uni-tok", 0);
    await addZoomRegistration({ email: s.email, delegierter: 1 });
    const state = await q.getUnifiedUnsubscribeState("uni-tok", "newsletter");
    expect(state.showPublicly).toBe(true);
    expect(state.delegierter).toBe(true);
    expect(state.hasZoom).toBe(true);
  });
});

describe("email templates", () => {
  test("system flag is a boolean and reserved slugs are protected", async () => {
    await db.query(
      `INSERT INTO email_templates (slug, name, subject, html_body) VALUES ('verification','V','S','B')`,
    ).run();
    const created = await q.createEmailTemplate({
      name: "Newsletter Blast",
      subject: "S",
      htmlBody: "B",
    });
    const list = await q.listEmailTemplates();
    const sys = list.find((t) => t.slug === "verification");
    expect(sys.system).toBe(true);
    expect(list.find((t) => t.id === created.id).system).toBe(false);
    // reserved templates cannot be deleted
    expect(await q.deleteEmailTemplate(sys.id)).toBe(false);
    expect(await q.deleteEmailTemplate(created.id)).toBe(true);
  });
});
