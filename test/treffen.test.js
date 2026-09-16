import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetDb,
  addZoomRegistration,
  addVerifiedSigner,
  db,
} from "./helpers.js";
import * as q from "../server/db.js";
import { prepareQueuedEmail } from "../server/queued-email.js";

beforeEach(resetDb);

const future = () => new Date(Date.now() + 3600_000);
const past = () => new Date(Date.now() - 1000);
const count = async (table) =>
  (await db.query(`SELECT COUNT(*) c FROM ${table}`).get()).c;

const signup = (over = {}) =>
  q.insertZoomPending({
    name: "Tina Treffen",
    email: "tina@example.org",
    kv: "Leipzig",
    delegierter: false,
    token: "zoom-tok",
    expiresAt: future(),
    ...over,
  });

describe("Treffen sign-up with double opt-in", () => {
  test("nothing is registered until the link is confirmed", async () => {
    const res = await signup();
    expect(res.status).toBe("pending");
    expect(await count("zoom_registrations")).toBe(0);
    expect((await q.getZoomRecipients()).length).toBe(0);

    const reg = await q.confirmZoomPending("zoom-tok");
    expect(reg.email).toBe("tina@example.org");
    expect(await count("zoom_registrations")).toBe(1);
    expect(await count("zoom_pending")).toBe(0);
    expect(await q.confirmZoomPending("zoom-tok")).toBeNull(); // single use
  });

  test("an unauthenticated sign-up never touches an existing registration", async () => {
    await addZoomRegistration({ email: "tina@example.org", name: "Real Tina" });
    expect((await signup({ name: "Attacker" })).status).toBe("registered");
    const row = await db
      .query("SELECT name FROM zoom_registrations WHERE email = ?")
      .get("tina@example.org");
    expect(row.name).toBe("Real Tina");
    expect(await count("zoom_pending")).toBe(0);
  });

  test("a pending sign-up keeps its values until its link expires", async () => {
    const first = await signup();
    const second = await signup({ name: "Other", token: "other-tok" });
    expect(second.id).toBe(first.id);
    expect((await q.getZoomPendingByToken("zoom-tok")).name).toBe("Tina Treffen");
    expect(await q.getZoomPendingByToken("other-tok")).toBeNull();

    await db.run("UPDATE zoom_pending SET expires_at = '2000-01-01T00:00:00.000Z'");
    await signup({ name: "Fresh", token: "fresh-tok" });
    expect((await q.getZoomPendingByToken("fresh-tok")).name).toBe("Fresh");
  });

  test("expired pending sign-ups can't be confirmed and are purged", async () => {
    await signup({ expiresAt: past() });
    expect(await q.confirmZoomPending("zoom-tok")).toBeNull();
    expect(await q.deleteExpiredZoomPending()).toBe(1);
  });

  test("erasing an address also drops a pending Treffen sign-up", async () => {
    await signup();
    await q.eraseEmail("tina@example.org");
    expect(await count("zoom_pending")).toBe(0);
  });

  test("a sign-up for a registered address mails its settings link", async () => {
    const z = await addZoomRegistration({ email: "tina@example.org" });
    const res = await signup();
    expect(res).toEqual({ status: "registered", id: z.id });
    const args = await prepareQueuedEmail({
      kind: "treffen-already-registered",
      registrationId: res.id,
      baseUrl: "https://example.org",
    });
    expect(args.to).toBe("tina@example.org");
    expect(args.unsubscribeUrl).toEndWith("?from=zoom");
  });

  test("the settings-page delete works with a Treffen token", async () => {
    const s = await addVerifiedSigner({ email: "both@example.org" });
    const z = await addZoomRegistration({ email: s.email });
    const token = await q.issueZoomUnsubscribeToken(z.id);
    expect(await q.deleteSignerByUnsubscribeToken(token, "zoom")).toBe(true);
    expect(await count("signers")).toBe(0);
    expect(await count("zoom_registrations")).toBe(0);
  });

  const isoAt = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

  test("replacing a past event's date still purges its registrations on time", async () => {
    await addZoomRegistration({ created_at: isoAt(-60_000) });
    await q.scheduleTreffenPurge(new Date(Date.now() + 3600_000));
    expect(await q.purgePreviousTreffenRegistrations()).toBe(0); // not due yet
    await db.run(
      `UPDATE app_settings SET value = json_set(value, '$[0].purgeAt', '2000-01-01T00:00:00.000Z')
       WHERE key = 'treffen_previous_purges'`,
    );
    // Registered for the next event after the date changed: kept.
    await addZoomRegistration({ created_at: isoAt(60_000) });
    expect(await q.purgePreviousTreffenRegistrations()).toBe(1);
    expect(await count("zoom_registrations")).toBe(1);
    expect(await q.purgePreviousTreffenRegistrations()).toBe(0);
  });

  test("someone from the previous Treffen can register again and is not purged", async () => {
    await addZoomRegistration({ email: "tina@example.org", created_at: isoAt(-60_000) });
    await q.scheduleTreffenPurge(new Date(Date.now() - 1000)); // already due
    // Not "already registered" for the new date: goes through double opt-in.
    const res = await signup();
    expect(res.status).toBe("pending");
    expect(await q.getCurrentZoomRegistrationByEmail("tina@example.org")).toBeNull();
    await q.confirmZoomPending("zoom-tok"); // renews the registration
    expect(await q.purgePreviousTreffenRegistrations()).toBe(0);
    expect(await count("zoom_registrations")).toBe(1);
    expect(await q.getCurrentZoomRegistrationByEmail("tina@example.org")).not.toBeNull();
  });

  test("a second date change keeps each event's own deadline", async () => {
    // A's registration, then the date moves to B (A's purge in the future).
    await addZoomRegistration({ email: "a@example.org", created_at: isoAt(-120_000) });
    await q.scheduleTreffenPurge(new Date(Date.now() + 3600_000));
    // Registered for B, then the date moves again (B's purge further out).
    await addZoomRegistration({ email: "b@example.org", created_at: isoAt(1000) });
    await new Promise((r) => setTimeout(r, 1100));
    await q.scheduleTreffenPurge(new Date(Date.now() + 7200_000));
    // A's deadline arrives: only A's registration goes.
    await db.run(
      `UPDATE app_settings SET value = json_set(value, '$[0].purgeAt', '2000-01-01T00:00:00.000Z')
       WHERE key = 'treffen_previous_purges'`,
    );
    expect(await q.purgePreviousTreffenRegistrations()).toBe(1);
    const left = await db.query("SELECT email FROM zoom_registrations").all();
    expect(left.map((r) => r.email)).toEqual(["b@example.org"]);
  });

  test("re-submitting a pending Treffen sign-up renews its link", async () => {
    await signup({ expiresAt: new Date(Date.now() + 60_000) });
    await signup({ name: "Other", token: "other-tok", expiresAt: future() });
    const row = await db
      .query("SELECT name, token, expires_at FROM zoom_pending")
      .get();
    expect(row.name).toBe("Tina Treffen");
    expect(row.token).toBe("zoom-tok");
    expect(row.expires_at > isoAt(30 * 60_000)).toBe(true);
  });

  test("the confirmation mail is built from the pending row", async () => {
    const { id } = await signup();
    const args = await prepareQueuedEmail({
      kind: "treffen-verification",
      pendingId: id,
      baseUrl: "https://example.org",
    });
    expect(args.to).toBe("tina@example.org");
    expect(args.token).toBe("zoom-tok");

    await q.confirmZoomPending("zoom-tok");
    expect(
      await prepareQueuedEmail({
        kind: "treffen-verification",
        pendingId: id,
        baseUrl: "https://example.org",
      }),
    ).toBeNull();
  });
});
