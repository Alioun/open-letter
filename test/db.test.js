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
  test("insertSigner keeps a pending sign-up, replaces it once expired, no-ops once verified", async () => {
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

    // Same email while the first link is still valid: nothing changes; a
    // second request can't rewrite what the real person is about to confirm.
    const attempt = {
      name: "Second",
      email,
      kv: "Hamburg",
      occupation: "",
      newsletter: false,
      showPublicly: false,
      token: "tok-2",
      expiresAt: future(),
    };
    const r2 = await q.insertSigner(attempt);
    expect(r2.ok).toBe(true);
    expect(r2.pendingKept).toBe(true);
    let row = await db
      .query("SELECT name, show_publicly, verification_token FROM signers WHERE email=?")
      .get(email);
    expect(row).toEqual({ name: "First", show_publicly: 1, verification_token: "tok-1" });
    expect((await q.getPendingSignerByToken("tok-1")).show_publicly).toBe(true);

    // Once the first link expired, a new sign-up replaces the pending row.
    await db.run("UPDATE signers SET token_expires_at = '2000-01-01T00:00:00.000Z'");
    const r2b = await q.insertSigner(attempt);
    expect(r2b.pendingKept).toBeUndefined();
    row = await db.query("SELECT name FROM signers WHERE email=?").get(email);
    expect(row.name).toBe("Second");

    // Verify, then a further insert is a no-op (already verified).
    await q.confirmSigner("tok-2");
    expect(await q.getPendingSignerByToken("tok-2")).toBeNull();
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

});

describe("erasure covers signatures and Treffen registrations", () => {
  const count = async (table) =>
    (await db.query(`SELECT COUNT(*) c FROM ${table}`).get()).c;

  test("the deletion link removes signature and Treffen registration", async () => {
    const s = await addVerifiedSigner();
    await addZoomRegistration({ email: s.email });
    expect(await q.createDeletionRequest(s.email, "del-tok", future())).toBeTruthy();
    expect(await q.deleteByDeletionToken("del-tok")).toBe(true);
    expect(await count("signers")).toBe(0);
    expect(await count("zoom_registrations")).toBe(0);
    expect(await count("deletion_requests")).toBe(0);
    expect(await q.deleteByDeletionToken("del-tok")).toBe(false); // single use
  });

  test("an address that only registered for the Treffen can be erased", async () => {
    const z = await addZoomRegistration();
    const other = await addVerifiedSigner();
    expect(await q.createDeletionRequest(z.email, "zoom-del", future())).toBeTruthy();
    expect(await q.deleteByDeletionToken("zoom-del")).toBe(true);
    expect(await count("zoom_registrations")).toBe(0);
    expect(await count("signers")).toBe(1);
    expect(other.id).toBeTruthy();
  });

  test("unknown addresses get no request, expired links do nothing", async () => {
    expect(await q.createDeletionRequest("nobody@example.org", "x", future())).toBeNull();
    const s = await addVerifiedSigner();
    await q.createDeletionRequest(s.email, "old-del", past());
    expect(await q.deleteByDeletionToken("old-del")).toBe(false);
    expect(await count("signers")).toBe(1);
    expect(await q.deleteExpiredDeletionRequests()).toBe(1);
  });

  test("deleting from the settings page also removes the Treffen registration", async () => {
    const s = await addVerifiedSigner();
    await setUnsubToken(s.id, "page-del", 1);
    await addZoomRegistration({ email: s.email });
    expect(await q.deleteSignerByUnsubscribeToken("page-del")).toBe(true);
    expect(await count("signers")).toBe(0);
    expect(await count("zoom_registrations")).toBe(0);
  });

  test("Treffen registrations are purged once the retention after the event passed", async () => {
    await addZoomRegistration();
    expect(await q.purgeZoomRegistrationsAfter(future())).toBe(0);
    expect(await count("zoom_registrations")).toBe(1);
    expect(await q.purgeZoomRegistrationsAfter(past())).toBe(1);
    expect(await count("zoom_registrations")).toBe(0);
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

  test("fuzzy fallback still catches a misspelling nothing contains", async () => {
    await addVerifiedSigner({ name: "Anna Schmidt", kreisverband: "Berlin" });
    await addVerifiedSigner({ name: "Bob Jones", kreisverband: "Köln" });
    // "schmitt" is a substring of nothing, so this exercises the fallback.
    const res = await q.getSigners({ search: "Schmitt" });
    expect(res.signers.map((s) => s.name)).toContain("Anna Schmidt");
    expect(res.signers.map((s) => s.name)).not.toContain("Bob Jones");
  });

  test("fuzzy fallback matches a misspelled multi-word query word by word", async () => {
    await addVerifiedSigner({ name: "Anna Schmidt", kreisverband: "Berlin" });
    await addVerifiedSigner({ name: "Anna Jones", kreisverband: "Köln" });
    const res = await q.getSigners({ search: "Anna Schmitt" });
    expect(res.signers.map((s) => s.name)).toEqual(["Anna Schmidt"]);
  });

  test("search is case-insensitive and paginates on the substring path", async () => {
    for (let i = 0; i < 5; i++) await addVerifiedSigner({ name: `Mira Wagner ${i}` });
    await addVerifiedSigner({ name: "Unrelated Person" });
    const res = await q.getSigners({ search: "WAGNER", limit: 2, offset: 0 });
    expect(res.total).toBe(5);
    expect(res.signers).toHaveLength(2);
  });

  test("capital umlauts match on the substring path (SQLite lower() is ASCII-only)", async () => {
    await addVerifiedSigner({ name: "Kerem Özdemir", kreisverband: "Berlin" });
    await addVerifiedSigner({ name: "Ömer Öztürk", kreisverband: "Köln" });
    await addVerifiedSigner({ name: "Anna Schmidt", kreisverband: "Hamburg" });
    const res = await q.getSigners({ search: "özdemir" });
    expect(res.total).toBe(1);
    expect(res.signers[0].name).toBe("Kerem Özdemir");
    // "öz" matches both Ö-names but not the wildcard-only superset hit.
    const both = await q.getSigners({ search: "Öz" });
    expect(both.signers.map((s) => s.name).sort()).toEqual(["Kerem Özdemir", "Ömer Öztürk"]);
    // A single umlaut is exact (not a match-anything wildcard) and paged in SQL.
    const one = await q.getSigners({ search: "ö", limit: 1 });
    expect(one.total).toBe(2);
    expect(one.signers).toHaveLength(1);
  });

  test("GLOB metacharacters in a non-ASCII query match literally", async () => {
    await addVerifiedSigner({ name: "Jörg [Test]*?" });
    await addVerifiedSigner({ name: "Jörg Tester" });
    const res = await q.getSigners({ search: "jörg [test]*?" });
    expect(res.total).toBe(1);
    expect(res.signers[0].name).toBe("Jörg [Test]*?");
  });

  test("LIKE wildcards in the query are treated as literal characters", async () => {
    await addVerifiedSigner({ name: "Anna Berger" });
    await addVerifiedSigner({ name: "100% Cotton" });
    // Without escaping, '%' would match every signer.
    const res = await q.getSigners({ search: "%" });
    expect(res.total).toBe(1);
    expect(res.signers[0].name).toBe("100% Cotton");
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

  const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

  test("a 'sending' campaign is reclaimable only once its heartbeat is stale", async () => {
    const t = await addTemplate();
    const c = await q.createCampaign({ templateId: t.id, subject: "s", scheduledAt: past() });
    expect((await q.claimCampaignById(c.id))?.attempts).toBe(1);
    // Live sender: heartbeat fresh -> not claimable, not due.
    expect(await q.claimCampaignById(c.id)).toBeNull();
    expect(await q.getDueCampaignIds()).not.toContain(c.id);

    // Process died mid-send: heartbeat stale -> due and claimable again.
    await db.query("UPDATE campaigns SET heartbeat_at = ? WHERE id = ?").run(minutesAgo(11), c.id);
    expect(await q.getDueCampaignIds()).toContain(c.id);
    expect((await q.claimCampaignById(c.id))?.attempts).toBe(2);
  });

  test("failed campaigns back off between attempts and abort at the cap", async () => {
    const t = await addTemplate();
    const c = await q.createCampaign({ templateId: t.id, subject: "s", scheduledAt: past() });
    await q.claimCampaignById(c.id);
    await q.markCampaignFailed(c.id);
    // Within the 1-minute backoff after the first failure.
    expect(await q.getDueCampaignIds()).not.toContain(c.id);
    await db.query("UPDATE campaigns SET heartbeat_at = ? WHERE id = ?").run(minutesAgo(2), c.id);
    expect(await q.getDueCampaignIds()).toContain(c.id);

    await db.query("UPDATE campaigns SET attempts = ? WHERE id = ?").run(q.MAX_MAILING_ATTEMPTS, c.id);
    await q.markCampaignFailed(c.id);
    let row = await db.query("SELECT status FROM campaigns WHERE id = ?").get(c.id);
    expect(row.status).toBe("aborted");
    await db.query("UPDATE campaigns SET heartbeat_at = ? WHERE id = ?").run(minutesAgo(600), c.id);
    expect(await q.getDueCampaignIds()).not.toContain(c.id);

    expect(await q.retryAbortedCampaign(c.id)).toBe(true);
    row = await db.query("SELECT status, attempts FROM campaigns WHERE id = ?").get(c.id);
    expect(row).toEqual({ status: "failed", attempts: 0 });
    expect(await q.getDueCampaignIds()).toContain(c.id);
  });

  test("the delivery log is erased with the address and aged out once a campaign is done", async () => {
    const t = await addTemplate();
    const done = await q.createCampaign({ templateId: t.id, subject: "d", scheduledAt: past() });
    const open = await q.createCampaign({ templateId: t.id, subject: "o", scheduledAt: past() });
    await q.markCampaignSent(done.id, 1);
    await q.claimCampaignById(open.id);
    await q.markCampaignFailed(open.id);
    await q.markDelivered(`campaign:${done.id}`, ["x@x.org"]);
    await q.markDelivered(`campaign:${open.id}`, ["x@x.org"]);
    await db
      .query("UPDATE mailing_deliveries SET sent_at = ?")
      .run(new Date(Date.now() - 31 * 86400_000).toISOString());
    expect(await q.deleteOldDeliveries()).toBe(1); // the finished campaign's row
    expect(await q.countDelivered(`campaign:${open.id}`)).toBe(1);

    const s = await addVerifiedSigner();
    await q.markDelivered(`campaign:${open.id}`, [s.email]);
    await q.eraseEmail(s.email);
    expect(await q.getDeliveredEmails(`campaign:${open.id}`)).not.toContain(s.email);
  });

  test("an aborted campaign's log ages out, and its retry is refused after that", async () => {
    const t = await addTemplate();
    const c = await q.createCampaign({ templateId: t.id, subject: "a", scheduledAt: past() });
    await q.claimCampaignById(c.id);
    await db.query("UPDATE campaigns SET attempts = ? WHERE id = ?").run(q.MAX_MAILING_ATTEMPTS, c.id);
    await q.markCampaignFailed(c.id); // -> aborted
    await q.markDelivered(`campaign:${c.id}`, ["y@x.org"]);
    const old = new Date(Date.now() - 31 * 86400_000).toISOString();
    await db.query("UPDATE mailing_deliveries SET sent_at = ?").run(old);

    // Retrying now could re-mail y@x.org once the log is purged: refused.
    expect(await q.retryAbortedCampaign(c.id)).toBe(false);
    expect(await q.deleteOldDeliveries()).toBe(1);
  });

  test("the delivery log records each address once per mailing", async () => {
    await q.markDelivered("campaign:1", ["a@x.org", "b@x.org"]);
    await q.markDelivered("campaign:1", ["b@x.org"]); // retry reports it again
    await q.markDelivered("campaign:2", ["a@x.org"]);
    expect(await q.countDelivered("campaign:1")).toBe(2);
    expect([...(await q.getDeliveredEmails("campaign:1"))].sort()).toEqual(["a@x.org", "b@x.org"]);
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

  test("a zoom mailing stuck in 'sending' is reclaimed; event reset clears its log", async () => {
    expect(await q.claimZoomMailing("reminder")).toBe(true);
    await q.markDelivered("zoom-reminder", ["a@x.org"]);
    expect(await q.claimZoomMailing("reminder")).toBe(false);
    await db
      .query("UPDATE zoom_event_mailings SET updated_at = ? WHERE kind = 'reminder'")
      .run(new Date(Date.now() - 11 * 60_000).toISOString());
    expect(await q.claimZoomMailing("reminder")).toBe(true);

    await q.resetZoomMailings();
    expect(await q.countDelivered("zoom-reminder")).toBe(0);
  });
});

describe("unsubscribe tokens: stable, opt-out never expires", () => {
  test("getUnsubscribeState honors the 90-day window", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "fresh-tok", 1);
    expect((await q.getUnsubscribeState("fresh-tok"))?.email).toBe(s.email);

    const s2 = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s2.id, "old-tok", 100);
    expect(await q.getUnsubscribeState("old-tok")).toBeNull();
  });

  test("getUnsubscribeState returns booleans for newsletter/verified", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "bool-tok", 0);
    const st = await q.getUnsubscribeState("bool-tok");
    expect(st.newsletter).toBe(true);
    expect(st.verified).toBe(true);
  });

  test("issuing again keeps the token, so an earlier mail's link still works", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    const first = await q.issueUnsubscribeToken(s.id); // newsletter A
    const second = await q.issueUnsubscribeToken(s.id); // newsletter B
    expect(second).toBe(first);
    expect(await q.issueUnsubscribeTokenByEmail(s.email)).toBe(first); // e.g. request-deletion
    expect(await q.optOutNewsletter(first)).toBe(true);
  });

  test("issuing re-stamps the edit window without changing the token", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "stamp-tok", 120);
    expect(await q.resolveEmailFromToken("stamp-tok")).toBeNull();
    expect(await q.issueUnsubscribeToken(s.id)).toBe("stamp-tok");
    expect(await q.resolveEmailFromToken("stamp-tok")).toBe(s.email);
  });

  test("one-click opt-out works after 120 days and keeps the token", async () => {
    const s = await addVerifiedSigner({ newsletter: 1 });
    await setUnsubToken(s.id, "opt-tok", 120);
    expect(await q.optOutNewsletter("opt-tok")).toBe(true);
    const row = await db
      .query("SELECT newsletter, unsubscribe_token FROM signers WHERE id=?")
      .get(s.id);
    expect(row.newsletter).toBe(0);
    expect(row.unsubscribe_token).toBe("opt-tok");
  });

  test("an old token opts out but no longer reads, edits or deletes", async () => {
    const s = await addVerifiedSigner({ newsletter: 1, name: "Old Link" });
    await setUnsubToken(s.id, "stale-tok", 120);
    expect(await q.resolveEmailFromToken("stale-tok")).toBeNull();
    expect(
      await q.resolveEmailFromToken("stale-tok", null, { optOut: true }),
    ).toBe(s.email);
    const state = await q.getUnifiedUnsubscribeState("stale-tok", "newsletter");
    expect(state.editable).toBe(false);
    expect(state.newsletter).toBe(true);
    expect(state.name).toBeUndefined();
    expect(state.canDeleteSigner).toBe(false);
    expect(await q.deleteSignerByUnsubscribeToken("stale-tok")).toBe(false);
  });

  test("Treffen tokens are stable too", async () => {
    const z = await addZoomRegistration();
    const first = await q.issueZoomUnsubscribeToken(z.id);
    expect(first).toBeTruthy();
    expect(await q.issueZoomUnsubscribeToken(z.id)).toBe(first);
  });

  test("one-time migration drops every previously issued token, once", async () => {
    const { applyDataMigrations } = await import("../db/data-migrations.js");
    const s = await addVerifiedSigner();
    await setUnsubToken(s.id, "exposed-tok", 1);
    const z = await addZoomRegistration();
    await q.issueZoomUnsubscribeToken(z.id);

    expect((await applyDataMigrations(db)).length).toBeGreaterThan(0);
    expect(
      (await db.query("SELECT unsubscribe_token t FROM signers WHERE id=?").get(s.id)).t,
    ).toBeNull();
    expect(
      (await db.query("SELECT unsubscribe_token t FROM zoom_registrations WHERE id=?").get(z.id)).t,
    ).toBeNull();

    // Already applied: tokens issued afterwards survive a second run.
    const fresh = await q.issueUnsubscribeToken(s.id);
    expect(await applyDataMigrations(db)).toEqual([]);
    expect(await q.resolveEmailFromToken(fresh)).toBe(s.email);
  });

  test("a deletion link issued before the deploy still works afterwards", async () => {
    const { applyDataMigrations } = await import("../db/data-migrations.js");
    const s = await addVerifiedSigner();
    await db
      .query(
        `UPDATE signers SET deletion_token = 'old-del', deletion_token_expires_at = ? WHERE id = ?`,
      )
      .run(new Date(Date.now() + 3600_000).toISOString(), s.id);
    await applyDataMigrations(db);
    expect(await q.deleteByDeletionToken("old-del")).toBe(true);
    expect((await db.query("SELECT COUNT(*) c FROM signers").get()).c).toBe(0);
  });

  test("re-submitting a pending sign-up renews its link but keeps its values", async () => {
    const base = {
      name: "Pia",
      email: "renew@example.org",
      kv: "",
      occupation: "",
      newsletter: false,
      showPublicly: true,
    };
    await q.insertSigner({ ...base, token: "t1", expiresAt: new Date(Date.now() + 60_000) });
    const later = new Date(Date.now() + 24 * 3600_000);
    const r = await q.insertSigner({ ...base, name: "Other", token: "t2", expiresAt: later });
    expect(r.pendingKept).toBe(true);
    const row = await db
      .query("SELECT name, verification_token, token_expires_at FROM signers WHERE email = ?")
      .get(base.email);
    expect(row).toEqual({
      name: "Pia",
      verification_token: "t1",
      token_expires_at: later.toISOString(),
    });
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
