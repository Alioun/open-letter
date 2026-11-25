// First signers as the admin manages them: mark and position, the public
// order and label, entries added by hand, duplicates, the order editor and
// the CSV import.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db, resetDb, addVerifiedSigner, isoAgoDays } from "./helpers.js";
import * as q from "../server/db.js";
import * as first from "../server/first-signers.js";
import cfg from "../config/letter.config.js";
import { invalidate } from "../server/cache.js";
import {
  ERASE,
  HIDE_PUBLICLY,
  applyErasureLog,
  readErasureLog,
  recordErasure,
} from "../db/erasure-log.js";

const features = { ...cfg.features };
beforeEach(async () => {
  await resetDb();
  await db.run("DELETE FROM first_signer_pins");
  invalidate();
});
afterEach(() => {
  Object.assign(cfg.features, features);
  invalidate();
});

const addUnverifiedSigner = async ({ name, email = `${name}@example.org` }) =>
  db
    .query(
      `INSERT INTO signers (name, email, verified, verification_token, token_expires_at)
       VALUES (?, ?, 0, ?, ?) RETURNING id`,
    )
    .get(name, email, crypto.randomUUID(), isoAgoDays(-1));
const signer = (name, days, extra = {}) =>
  addVerifiedSigner({ name, created_at: isoAgoDays(days), ...extra });
const mark = (id) => first.setMark(id, true);
const handEntry = (name, extra = {}) =>
  first.addByHand({ name, consentNote: "", ...extra });
const publicNames = async (opts = {}) =>
  (await q.getSigners({ sort: "asc", ...opts })).signers.map((s) => s.name);
const labelled = async (opts) =>
  (await q.getSigners(opts)).signers
    .filter((s) => s.firstSigner)
    .map((s) => s.name);
const order = async () =>
  (await first.listFirstSigners()).ordered.map((s) => s.name);

describe("public list", () => {
  test("the default view shows positions, then marked first signers oldest first, then everyone by date", async () => {
    const oldest = await signer("Oldest", 9);
    const markedOld = await signer("Marked old", 8);
    const second = await signer("Second", 7);
    const markedNew = await signer("Marked new", 2);
    const top = await signer("Top", 0.5);
    await signer("Plain", 3);
    await first.setPosition(top.id, 1);
    await first.setPosition(second.id, 2);
    await mark(markedNew.id);
    await mark(markedOld.id);
    await mark(top.id);
    invalidate();

    expect(await publicNames()).toEqual([
      "Top",
      "Second",
      "Marked old",
      "Marked new",
      "Oldest",
      "Plain",
    ]);
    // Newest first keeps its own order and only labels.
    expect(await publicNames({ filter: "neueste", sort: "desc" })).toEqual([
      "Top",
      "Marked new",
      "Plain",
      "Second",
      "Marked old",
      "Oldest",
    ]);
    // The label shows in every view.
    for (const [opts, names] of [
      [{ sort: "asc" }, ["Top", "Marked old", "Marked new"]],
      [
        { filter: "neueste", sort: "desc" },
        ["Top", "Marked new", "Marked old"],
      ],
      [{ filter: "heute", sort: "desc" }, ["Top"]],
      [{ search: "marked", sort: "desc" }, ["Marked new", "Marked old"]],
      [{ search: "Markd old", sort: "desc" }, ["Marked old"]],
    ])
      expect(await labelled(opts)).toEqual(names);
    expect(
      (await q.getSigners({ search: "oldest" })).signers[0].firstSigner,
    ).toBe(false);
    expect(oldest.id).toBeGreaterThan(0);
  });

  test("details follow the person's own choice, not the mark or the position", async () => {
    const agreed = await signer("Agreed", 3, { occupation: "Klinik" });
    const declined = await signer("Declined", 2, { occupation: "Schule" });
    await db
      .query("UPDATE signers SET show_signer_details = ? WHERE id = ?")
      .run(1, agreed.id);
    await db
      .query("UPDATE signers SET show_signer_details = ? WHERE id = ?")
      .run(0, declined.id);
    await mark(agreed.id);
    await mark(declined.id);
    await first.setPosition(declined.id, 1);
    for (const flags of [
      { publicSignerDetails: true, publicFirstSignerDetails: true },
      { publicSignerDetails: false, publicFirstSignerDetails: true },
    ]) {
      Object.assign(cfg.features, flags);
      invalidate();
      const rows = (await q.getSigners({ sort: "asc" })).signers;
      expect(
        Object.fromEntries(rows.map((r) => [r.name, r.organisation])),
      ).toEqual({ Declined: null, Agreed: "Klinik" });
    }
    // A letter that shows details for first signers only: the position
    // alone is not enough, the mark is.
    await first.setMark(agreed.id, false);
    invalidate();
    expect(
      (await q.getSigners({ sort: "asc" })).signers.find(
        (r) => r.name === "Agreed",
      ).organisation,
    ).toBeNull();
  });
});

describe("positions", () => {
  test("a position moves the others down to make room; empty takes it away", async () => {
    const [a, b, c, d] = await Promise.all(
      ["A", "B", "C", "D"].map((name, i) => signer(name, 5 - i)),
    );
    for (const s of [a, b, c]) await first.setPosition(s.id, 999);
    expect(await order()).toEqual(["A", "B", "C"]);
    expect(await first.setPosition(d.id, 2)).toEqual({ position: 2 });
    expect(await order()).toEqual(["A", "D", "B", "C"]);
    await first.setPosition(a.id, 3);
    expect(await order()).toEqual(["D", "B", "A", "C"]);
    await first.setPosition(b.id, null);
    expect(await order()).toEqual(["D", "A", "C"]);
    expect(await first.setPosition(123456, 1)).toBeNull();
    const logged = (await q.listAdminActions({})).actions.filter(
      (entry) => entry.action === "signer.position",
    );
    expect(logged[0].detail.changes.position).toEqual([2, null]);
  });

  test("saving the order replaces it whole and refuses a stale revision", async () => {
    const [a, b, c] = await Promise.all(
      ["A", "B", "C"].map((name, i) => signer(name, 5 - i)),
    );
    for (const s of [a, b]) await first.setPosition(s.id, 999);
    const { revision } = await first.listFirstSigners();
    await first.replaceOrder([c.id, a.id], revision);
    expect(await order()).toEqual(["C", "A"]);
    // B lost the position, not anything else.
    expect((await q.listSigners({})).total).toBe(3);

    const stale = first.replaceOrder([a.id, c.id], revision);
    await expect(stale).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("inzwischen an anderer Stelle"),
    });
    expect(await order()).toEqual(["C", "A"]);
    await expect(
      first.replaceOrder(
        [a.id, a.id],
        (await first.listFirstSigners()).revision,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const unconfirmed = await addUnverifiedSigner({ name: "Pending" });
    await expect(
      first.replaceOrder(
        [unconfirmed.id],
        (await first.listFirstSigners()).revision,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await order()).toEqual(["C", "A"]);
  });
});

describe("entries added by hand", () => {
  test("count as a signature, are marked, and are never a mail recipient", async () => {
    await signer("Subscriber", 2);
    const entry = await handEntry("Prof. Hand Eintrag", {
      organisation: "Uni",
      signerFunction: "Präsidentin",
      showSignerDetails: true,
      consentNote: "per Telefon am 3.11., hand@example.org",
      pin: true,
    });
    expect(entry).toMatchObject({
      handAdded: true,
      firstSigner: true,
      position: 1,
      email: null,
      newsletter: false,
    });
    invalidate();
    expect((await q.getStats()).total).toBe(2);
    expect((await q.getSigners({ sort: "asc" })).signers[0]).toMatchObject({
      name: "Prof. Hand Eintrag",
      firstSigner: true,
      organisation: "Uni",
    });
    expect((await q.getNewsletterRecipients()).map((r) => r.name)).toEqual([
      "Subscriber",
    ]);
    expect(await q.getNewsletterRecipientsByIds([entry.id])).toEqual([]);
    expect(await q.getSignerForMail(entry.id)).toBeNull();
    expect(
      Object.values(await q.getCampaignLanguageCounts("newsletter")).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(1);
    // The note is kept without the address.
    const logged = (await q.listAdminActions({})).actions.find(
      (a) => a.action === "signer.add-by-hand",
    );
    expect(logged.detail.consentNote).toBe(
      "per Telefon am 3.11., [E-Mail-Adresse entfernt]",
    );
    // A hand entry can never become mailable.
    await expect(
      db.query("UPDATE signers SET newsletter = 1 WHERE id = ?").run(entry.id),
    ).rejects.toThrow(/CHECK/);
    // Bulk removal skips it: there is no address to block.
    expect((await q.removeAndBlockSigners([entry.id])).removed).toBe(0);
    // The admin search finds it by name; an address search does not crash.
    expect((await q.listSigners({ search: "hand eintrag" })).total).toBe(1);
    expect((await q.listSigners({ search: "@example" })).total).toBe(1);
  });

  test("deleting one survives a backup restore, and so does hiding it", async () => {
    const kept = await handEntry("Bleibt");
    const gone = await handEntry("Geht");
    const before = await db.query("SELECT * FROM signers").all();
    expect(await q.eraseSigner(gone.id)).toBe(true);
    await q.updateSignerByAdmin(kept.id, { showPublicly: false });
    const log = await readErasureLog(db);
    // Restore: the rows come back as they were in the backup.
    await db.run("DELETE FROM signers");
    for (const row of before) {
      const columns = Object.keys(row);
      await db
        .query(
          `INSERT INTO signers (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .run(...Object.values(row));
    }
    const applied = await applyErasureLog(db, log);
    expect(applied[ERASE]).toBe(1);
    expect(applied[HIDE_PUBLICLY]).toBe(1);
    expect(
      await db.query("SELECT name, show_publicly FROM signers").all(),
    ).toEqual([{ name: "Bleibt", show_publicly: 0 }]);
  });
});

describe("duplicates", () => {
  test("a signature with the name of a hand entry is flagged on both, and linking keeps the count right", async () => {
    const before = await signer("Someone Else", 9);
    await first.setPosition(before.id, 1);
    const entry = await handEntry("Erika  Muster", { pin: true });
    const after = await signer("Third", 8);
    await first.setPosition(after.id, 999);
    const real = await signer("erika muster", 0, { show_publicly: 1 });
    const flags = Object.fromEntries(
      (await q.listSigners({})).signers.map((s) => [
        s.name,
        s.possibleDuplicate,
      ]),
    );
    expect(flags).toEqual({
      "erika muster": true,
      "Erika  Muster": true,
      "Someone Else": false,
      Third: false,
    });
    expect((await first.duplicatesOf(entry.id)).map((s) => s.id)).toEqual([
      real.id,
    ]);
    invalidate();
    expect((await q.getStats()).total).toBe(4);

    const linked = await first.linkDuplicate(entry.id, real.id);
    expect(linked).toMatchObject({
      id: real.id,
      firstSigner: true,
      position: 2,
      possibleDuplicate: false,
    });
    expect(await order()).toEqual(["Someone Else", "erika muster", "Third"]);
    invalidate();
    expect((await q.getStats()).total).toBe(3);
    expect(await q.getSignerForAdmin(entry.id)).toBeNull();
    // Only a hand entry and a real signature can be linked.
    await expect(first.linkDuplicate(after.id, real.id)).rejects.toMatchObject({
      status: 400,
    });
  });

  test("a signature that already has a position keeps it when the hand entry had none", async () => {
    const entry = await handEntry("Max Muster");
    const real = await signer("Max Muster", 0);
    await first.setPosition(real.id, 1);
    await first.linkDuplicate(entry.id, real.id);
    expect(await order()).toEqual(["Max Muster"]);
    expect((await q.getSignerForAdmin(real.id)).firstSigner).toBe(true);
  });
});

describe("CSV import", () => {
  const csv = (lines) =>
    ["name,email,organisation,funktion", ...lines].join("\n");

  test("the preview says who gets marked, added or skipped and why, and applying needs the same plan", async () => {
    await signer("Bestehend", 5, { email: "da@example.org" });
    await signer("Versteckt", 5, {
      email: "privat@example.org",
      show_publicly: 0,
    });
    await addUnverifiedSigner({ name: "Offen", email: "offen@example.org" });
    await recordErasure(db, "weg@example.org", ERASE);
    const already = await handEntry("Schon Da");
    const rows = first.readImportFile(
      csv([
        "Bestehend,da@example.org,,",
        "Neu Person,,Klinik,Ärztin",
        "Unbekannt,niemand@example.org,,",
        "Versteckt,privat@example.org,,",
        "Offen,offen@example.org,,",
        "Weg,weg@example.org,,",
        "X,,,",
        "Neu Person,,,",
        "Schon Da,,,",
        "Kaputt,keine-adresse,,",
      ]),
    );
    const preview = await first.planImport(rows);
    expect(
      preview.rows.map((row) => [row.line, row.outcome, Boolean(row.reason)]),
    ).toEqual([
      [2, "mark", false],
      [3, "add", false],
      [4, "add", false],
      [5, "skip", true],
      [6, "skip", true],
      [7, "skip", true],
      [8, "skip", true],
      [9, "skip", true],
      [10, "already", true],
      [11, "skip", true],
    ]);
    expect(preview.counts).toEqual({
      mark: 1,
      already: 1,
      add: 2,
      skip: 6,
      placed: 4,
    });
    expect(preview.rows[3].reason).toContain("nicht öffentlich");
    expect(preview.rows[5].reason).toContain("Löschung");

    let backups = 0;
    const backup = async () => {
      backups++;
    };
    await expect(
      first.applyImport(rows, { plan: "stale" }, backup),
    ).rejects.toMatchObject({ status: 409 });
    expect(backups).toBe(0);

    // A failed backup changes nothing.
    await expect(
      first.applyImport(rows, { plan: preview.plan }, async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(await order()).toEqual([]);

    const result = await first.applyImport(
      rows,
      { plan: preview.plan, consentNote: "Liste vom 3.11." },
      backup,
    );
    expect(backups).toBe(1);
    expect(result).toEqual({ marked: 1, added: 2 });
    expect(await order()).toEqual([
      "Bestehend",
      "Neu Person",
      "Unbekannt",
      "Schon Da",
    ]);
    const added = await db
      .query(
        "SELECT name, email, first_signer, show_signer_details, occupation, admin_consent_note FROM signers WHERE name IN ('Neu Person', 'Unbekannt') ORDER BY id",
      )
      .all();
    // The address of an unknown person is never stored.
    expect(added).toEqual([
      {
        name: "Neu Person",
        email: null,
        first_signer: 1,
        show_signer_details: 0,
        occupation: "Klinik",
        admin_consent_note: "Liste vom 3.11.",
      },
      {
        name: "Unbekannt",
        email: null,
        first_signer: 1,
        show_signer_details: 0,
        occupation: "",
        admin_consent_note: "Liste vom 3.11.",
      },
    ]);
    // Running the same file again marks and adds nobody.
    const again = await first.planImport(rows);
    expect(again.counts).toMatchObject({ mark: 0, add: 0, placed: 0 });
    expect(already.id).toBeGreaterThan(0);
  });

  test("a changed organisation needs a new preview, and an unmarked hand entry is marked again", async () => {
    const hand = await handEntry("Hanna Hand");
    await mark(hand.id);
    await first.setMark(hand.id, false);
    const reviewed = first.readImportFile(
      csv(["Neu Person,,Klinik,Ärztin", "Hanna Hand,,,"]),
    );
    const preview = await first.planImport(reviewed);
    expect(preview.rows.map((row) => row.outcome)).toEqual(["add", "mark"]);

    const edited = first.readImportFile(
      csv(["Neu Person,,Andere Klinik,Ärztin", "Hanna Hand,,,"]),
    );
    await expect(
      first.applyImport(edited, { plan: preview.plan }, async () => {}),
    ).rejects.toThrow("Seit der Vorschau");

    await first.applyImport(reviewed, { plan: preview.plan }, async () => {});
    expect(
      (
        await db
          .query("SELECT first_signer FROM signers WHERE name = 'Hanna Hand'")
          .get()
      ).first_signer,
    ).toBe(1);
  });

  test("a hidden signature withdrawn by the person is refused even under another spelling", async () => {
    await recordErasure(db, "zurueck@example.org", HIDE_PUBLICLY);
    const preview = await first.planImport(
      first.readImportFile(csv(["Zurück,Zurueck@Example.org,,"])),
    );
    expect(preview.rows[0]).toMatchObject({ outcome: "skip" });
    expect(preview.rows[0].reason).toContain("zurückgenommen");
  });

  test("a file that is not the expected CSV is refused as a whole", () => {
    expect(() => first.readImportFile("foo,bar\n1,2")).toThrow(/Erwartet wird/);
    expect(() => first.readImportFile('name\n"broken')).toThrow(
      /keine gültige CSV/,
    );
    expect(() => first.readImportFile("name")).toThrow(/1 bis 2000/);
    const sheet = first.readImportFile(
      "Zeitstempel;Vorname, Name (öffentlich);E-Mail-Adresse\n1;Anna Beispiel;Anna@Example.org",
    );
    expect(sheet).toEqual([
      expect.objectContaining({
        name: "Anna Beispiel",
        email: "anna@example.org",
      }),
    ]);
  });
});
