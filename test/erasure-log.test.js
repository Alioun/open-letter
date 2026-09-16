import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
  setUnsubToken,
  db,
  isoAgoDays,
} from "./helpers.js";
import * as q from "../server/db.js";
import { openEncrypted } from "../db/connection.js";
import {
  readErasureLog,
  applyErasureLog,
  emailHmac,
  ERASE,
  NEWSLETTER_OPT_OUT,
  TREFFEN_OPT_OUT,
  HIDE_PUBLICLY,
} from "../db/erasure-log.js";

beforeEach(resetDb);

const future = () => new Date(Date.now() + 3600_000);

// A second encrypted database with the app schema, standing in for a restored
// backup taken before the erasures happened.
let dir;
let restored;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "erasure-restore-"));
  restored = await openEncrypted(join(dir, "restored.db"));
  await restored.run(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
});
afterEach(async () => {
  await restored.close();
  rmSync(dir, { recursive: true, force: true });
});

async function copyRow(table, email, created_at) {
  if (table === "signers") {
    await restored
      .query(
        `INSERT INTO signers (name, email, verified, newsletter, created_at) VALUES ('X', ?, 1, 1, ?)`,
      )
      .run(email, created_at);
  } else {
    await restored
      .query(`INSERT INTO zoom_registrations (name, email, created_at) VALUES ('X', ?, ?)`)
      .run(email, created_at);
  }
}
const countIn = async (conn, table) =>
  (await conn.query(`SELECT COUNT(*) c FROM ${table}`).get()).c;

describe("erasure log", () => {
  test("stores an HMAC, never the address", async () => {
    const s = await addVerifiedSigner({ email: "private@example.org" });
    await q.createDeletionRequest(s.email, "t", future());
    await q.deleteByDeletionToken("t");
    const log = await readErasureLog(db);
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe(ERASE);
    expect(log[0].email_hmac).toBe(emailHmac("private@example.org"));
    expect(JSON.stringify(log)).not.toContain("private");
  });

  test("a restore re-applies an erasure made after the backup", async () => {
    const s = await addVerifiedSigner({ email: "gone@example.org", created_at: isoAgoDays(10) });
    await addZoomRegistration({ email: "gone@example.org", created_at: isoAgoDays(10) });
    await copyRow("signers", s.email, isoAgoDays(10));
    await copyRow("zoom_registrations", s.email, isoAgoDays(10));
    await copyRow("signers", "stays@example.org", isoAgoDays(10));

    await q.createDeletionRequest(s.email, "t", future());
    await q.deleteByDeletionToken("t");

    const applied = await applyErasureLog(restored, await readErasureLog(db));
    expect(applied[ERASE]).toBe(1);
    expect(await countIn(restored, "signers")).toBe(1);
    expect(await countIn(restored, "zoom_registrations")).toBe(0);
    // The log travels along, so a later restore is covered too.
    expect(await countIn(restored, "erasure_log")).toBe(1);
  });

  test("someone who signed again after being erased keeps the new signature", async () => {
    const s = await addVerifiedSigner({ email: "again@example.org" });
    await q.createDeletionRequest(s.email, "t", future());
    await q.deleteByDeletionToken("t");
    // In the restored DB the row is newer than the erasure.
    await copyRow("signers", s.email, new Date(Date.now() + 60_000).toISOString());
    await applyErasureLog(restored, await readErasureLog(db));
    expect(await countIn(restored, "signers")).toBe(1);
  });

  test("opt-outs are re-applied; opting back in clears the entry", async () => {
    const s = await addVerifiedSigner({ email: "news@example.org", created_at: isoAgoDays(5) });
    await setUnsubToken(s.id, "opt", 1);
    await addZoomRegistration({ email: "news@example.org", created_at: isoAgoDays(5) });
    await copyRow("signers", s.email, isoAgoDays(5));
    await copyRow("zoom_registrations", s.email, isoAgoDays(5));

    await q.optOutNewsletter("opt");
    await q.deleteZoomByEmail(s.email);
    const applied = await applyErasureLog(restored, await readErasureLog(db));
    expect(applied[NEWSLETTER_OPT_OUT]).toBe(1);
    expect(applied[TREFFEN_OPT_OUT]).toBe(1);
    expect(
      (await restored.query("SELECT newsletter FROM signers").get()).newsletter,
    ).toBe(0);
    expect(await countIn(restored, "zoom_registrations")).toBe(0);

    await q.updateSignerByEmail(s.email, {
      name: "X",
      kreisverband: "",
      occupation: "",
      newsletter: true,
      showPublicly: true,
    });
    expect((await readErasureLog(db)).map((e) => e.kind)).toEqual([TREFFEN_OPT_OUT]);
  });

  test("taking the name off the public list survives a restore", async () => {
    const s = await addVerifiedSigner({ email: "hide@example.org", created_at: isoAgoDays(5) });
    await copyRow("signers", s.email, isoAgoDays(5));
    const edit = (showPublicly) =>
      q.updateSignerByEmail(s.email, {
        name: "X",
        kreisverband: "",
        occupation: "",
        newsletter: true,
        showPublicly,
      });

    await edit(false);
    const applied = await applyErasureLog(restored, await readErasureLog(db));
    expect(applied[HIDE_PUBLICLY]).toBe(1);
    expect(
      (await restored.query("SELECT show_publicly FROM signers").get()).show_publicly,
    ).toBe(0);

    await edit(true); // shown again: nothing to re-apply
    expect((await readErasureLog(db)).map((e) => e.kind)).not.toContain(HIDE_PUBLICLY);
  });

  test("old entries are purged", async () => {
    const s = await addVerifiedSigner();
    await q.createDeletionRequest(s.email, "t", future());
    await q.deleteByDeletionToken("t");
    expect(await q.purgeOldErasureLog(new Date(Date.now() - 86400_000))).toBe(0);
    expect(await q.purgeOldErasureLog(new Date(Date.now() + 1000))).toBe(1);
  });
});
