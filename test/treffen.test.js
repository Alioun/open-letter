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

  test("replacing a past event's date still purges its registrations on time", async () => {
    await addZoomRegistration({ created_at: new Date(Date.now() - 60_000).toISOString() });
    await q.scheduleTreffenPurge(new Date(Date.now() + 3600_000));
    expect(await q.purgePreviousTreffenRegistrations()).toBe(0); // not due yet
    await q.scheduleTreffenPurge(new Date(Date.now() - 1000)); // earlier deadline wins
    // Registered for the next event after the date changed: kept.
    await addZoomRegistration({ created_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await q.purgePreviousTreffenRegistrations()).toBe(1);
    expect(await count("zoom_registrations")).toBe(1);
    expect(await q.purgePreviousTreffenRegistrations()).toBe(0);
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
