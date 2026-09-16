import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
  db,
} from "./helpers.js";
import * as q from "../server/db.js";
import { prepareQueuedEmail } from "../server/queued-email.js";

beforeEach(resetDb);

const future = () => new Date(Date.now() + 3600_000);
const base = "https://example.org";

async function pendingSigner(email = "pending@example.org") {
  await q.insertSigner({
    name: "Pia Pending",
    email,
    kv: "",
    occupation: "",
    newsletter: true,
    showPublicly: true,
    token: "verify-tok",
    expiresAt: future(),
  });
  return q.getSignerIdByEmail(email);
}

describe("queued transactional mail", () => {
  test("a verification mail is built from the row at send time", async () => {
    const signerId = await pendingSigner();
    const args = await prepareQueuedEmail({
      kind: "verification",
      signerId,
      baseUrl: base,
    });
    expect(args.to).toBe("pending@example.org");
    expect(args.name).toBe("Pia Pending");
    expect(args.token).toBe("verify-tok");
    expect(args.unsubscribeUrl).toStartWith(`${base}/abmelden/`);
    expect(args.headers["List-Unsubscribe"]).toContain("/opt-out");
  });

  test("no mail once the signer is gone, confirmed, or the link expired", async () => {
    const signerId = await pendingSigner();
    await db.query("DELETE FROM signers WHERE id = ?").run(signerId);
    expect(
      await prepareQueuedEmail({ kind: "verification", signerId, baseUrl: base }),
    ).toBeNull();

    const confirmedId = await pendingSigner("c@example.org");
    await q.confirmSigner("verify-tok");
    expect(
      await prepareQueuedEmail({
        kind: "verification",
        signerId: confirmedId,
        baseUrl: base,
      }),
    ).toBeNull();

    expect(
      await prepareQueuedEmail({ kind: "deletion", requestId: 999, baseUrl: base }),
    ).toBeNull(); // no such request
  });

  test("a deletion mail works for a Treffen-only address", async () => {
    const z = await addZoomRegistration({ email: "treffen@example.org" });
    const requestId = await q.createDeletionRequest(z.email, "del-tok", future());
    const args = await prepareQueuedEmail({
      kind: "deletion",
      requestId,
      baseUrl: base,
    });
    expect(args.to).toBe("treffen@example.org");
    expect(args.token).toBe("del-tok");
    expect(args.unsubscribeUrl).toEndWith("?from=zoom");
    expect(args.headers["List-Unsubscribe"]).toContain("/api/zoom-abmelden/");
  });

  test("the unsubscribe token in a queued mail is the signer's stable one", async () => {
    const s = await addVerifiedSigner();
    const token = await q.issueUnsubscribeToken(s.id);
    const args = await prepareQueuedEmail({
      kind: "already-signed",
      signerId: s.id,
      baseUrl: base,
    });
    expect(args.unsubscribeUrl).toBe(`${base}/abmelden/${token}`);
  });
});
