import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
  db,
  isoAgoDays,
} from "./helpers.js";
import * as q from "../server/db.js";
import { resolvePrivacy, retentionCutoff } from "../config/privacy.js";

beforeEach(resetDb);

const count = async (table) =>
  (await db.query(`SELECT COUNT(*) c FROM ${table}`).get()).c;

describe("age-based retention", () => {
  test("the cutoff is signerRetentionYears calendar years back", () => {
    const privacy = resolvePrivacy({ privacy: { signerRetentionYears: 3 } });
    const cutoff = retentionCutoff(privacy, new Date("2029-06-15T12:00:00Z"));
    expect(cutoff.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  test("entries older than the cutoff are deleted, newer ones kept", async () => {
    await addVerifiedSigner({ created_at: isoAgoDays(3 * 365 + 5) });
    const keep = await addVerifiedSigner({ created_at: isoAgoDays(3 * 365 - 5) });
    await addZoomRegistration({ created_at: isoAgoDays(3 * 365 + 5) });

    const cutoff = retentionCutoff(resolvePrivacy({}));
    expect(await q.deleteExpiredByAge(cutoff)).toBe(2);
    expect(await count("signers")).toBe(1);
    expect(await count("zoom_registrations")).toBe(0);
    expect(
      (await db.query("SELECT id FROM signers").get()).id,
    ).toBe(keep.id);
    expect(await q.deleteExpiredByAge(cutoff)).toBe(0);
  });
});
