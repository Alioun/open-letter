// What the team can do to one signature in the admin, and what the admin log
// then holds about it.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  db,
  resetDb,
  addVerifiedSigner,
  addZoomRegistration,
  isoAgoDays,
  setUnsubToken,
} from "./helpers.js";
import * as q from "../server/db.js";
import cfg from "../config/letter.config.js";
import {
  CLEAR_SIGNER_FUNCTION,
  HIDE_PUBLICLY,
  HIDE_SIGNER_DETAILS,
  NEWSLETTER_OPT_OUT,
  applyErasureLog,
  readErasureLog,
} from "../db/erasure-log.js";
import { recordAdminAction } from "../db/admin-actions.js";

const features = { ...cfg.features };
beforeEach(resetDb);
afterEach(() => Object.assign(cfg.features, features));

const logged = async () => (await q.listAdminActions({})).actions;
const erasureKinds = async () =>
  (await readErasureLog(db)).map((entry) => entry.kind).sort();
const pin = (id, position) =>
  db
    .query("INSERT INTO first_signer_pins (signer_id, position) VALUES (?, ?)")
    .run(id, position);

test("the list filters by visibility and date, and marks first signers", async () => {
  const old = await addVerifiedSigner({
    name: "Alt Bekannt",
    created_at: isoAgoDays(10),
  });
  const hidden = await addVerifiedSigner({
    name: "Still Dabei",
    show_publicly: 0,
    created_at: isoAgoDays(2),
  });
  const recent = await addVerifiedSigner({
    name: "Neu Hier",
    created_at: isoAgoDays(1),
  });
  await pin(old.id, 3);

  const names = async (filters) =>
    (await q.listSigners(filters)).signers.map((signer) => signer.name);
  expect(await names({ visibility: "hidden" })).toEqual(["Still Dabei"]);
  expect(await names({ visibility: "public" })).toEqual([
    "Neu Hier",
    "Alt Bekannt",
  ]);
  expect(await names({ dateFrom: isoAgoDays(3) })).toEqual([
    "Neu Hier",
    "Still Dabei",
  ]);
  expect(
    await names({ dateFrom: isoAgoDays(3), dateTo: isoAgoDays(1.5) }),
  ).toEqual(["Still Dabei"]);

  const all = (await q.listSigners({})).signers;
  expect(all.find((s) => s.id === old.id).position).toBe(3);
  expect(all.find((s) => s.id === recent.id).position).toBeNull();
  expect(all.find((s) => s.id === hidden.id)).toMatchObject({
    showPublicly: false,
    showSignerDetails: false,
    newsletter: true,
  });
});

test("a search finds every word in name or address, and only falls back to similar names when nothing contains it", async () => {
  await addVerifiedSigner({
    name: "Anna Schmidt",
    email: "anna@verein.org",
    created_at: isoAgoDays(3),
  });
  await addVerifiedSigner({
    name: "Änne Özdemir",
    email: "oe@example.org",
    created_at: isoAgoDays(2),
  });
  await addVerifiedSigner({
    name: "Bernd Schmidt",
    email: "b@example.org",
    created_at: isoAgoDays(1),
  });

  const find = async (search) => {
    const result = await q.listSigners({ search });
    return [result.signers.map((s) => s.name), Boolean(result.fuzzy)];
  };
  expect(await find("schmidt verein")).toEqual([["Anna Schmidt"], false]);
  expect(await find("ÖZDEMIR")).toEqual([["Änne Özdemir"], false]);
  expect(await find("100%")).toEqual([[], false]);
  // Nobody is called "Schmitt"; both Schmidts are close, newest first.
  expect(await find("schmitt")).toEqual([
    ["Bernd Schmidt", "Anna Schmidt"],
    true,
  ]);
  expect(
    (await q.listSigners({ search: "schmitt", visibility: "hidden" })).total,
  ).toBe(0);
});

test("removing, deleting and unblocking are logged without any address", async () => {
  const fake = await addVerifiedSigner({ email: "fake@example.org" });
  const twin = await addVerifiedSigner({ email: "fake+2@example.org" });
  const other = await addVerifiedSigner({ email: "other@example.org" });
  const sorry = await addVerifiedSigner({ email: "sorry@example.org" });

  await q.removeAndBlockSigner(fake.id);
  expect(await q.removeAndBlockSigners([twin.id, other.id, 999999])).toEqual({
    removed: 2,
    variants: [],
  });
  expect(await q.eraseSigner(sorry.id)).toBe(true);
  expect(await q.eraseSigner(sorry.id)).toBe(false);
  expect(await q.unblockSigning("other@example.org")).toBe(true);
  expect(await q.unblockSigning("other@example.org")).toBe(false);

  expect(
    (await logged()).map(({ action, targetId, count }) => [
      action,
      targetId,
      count,
    ]),
  ).toEqual([
    ["signer.unblock", null, 1],
    ["signer.erase", sorry.id, 1],
    ["signer.remove-block", null, 2],
    ["signer.remove-block", fake.id, 1],
  ]);
  expect((await q.insertSigner(signUp("sorry@example.org"))).ok).toBe(true);
  expect((await q.insertSigner(signUp("fake@example.org"))).blocked).toBe(true);
  expect(
    JSON.stringify(await db.query("SELECT * FROM admin_actions").all()),
  ).not.toContain("@");

  const blocks = await q.listSigningBlocks();
  expect(blocks.total).toBe(1);
  expect(blocks.blocks).toHaveLength(1);
  expect(JSON.stringify(blocks)).not.toContain("example.org");
});

const signUp = (email) => ({
  name: "Neue Person",
  email,
  kv: "",
  occupation: "",
  newsletter: false,
  showPublicly: true,
  token: crypto.randomUUID(),
  expiresAt: new Date(Date.now() + 86400_000),
});

test("an edit changes only what it names and logs the old and new value", async () => {
  const signer = await addVerifiedSigner({
    name: "Dr. Max Muster",
    email: "max@example.org",
    occupation: "Verein A",
  });
  await db
    .query("UPDATE signers SET signer_function = 'Vorstand' WHERE id = ?")
    .run(signer.id);

  const updated = await q.updateSignerByAdmin(signer.id, {
    name: "Max Muster",
    signerFunction: "",
  });
  expect(updated.signer).toMatchObject({
    name: "Max Muster",
    signerFunction: "",
    occupation: "Verein A",
    email: "max@example.org",
    newsletter: true,
  });
  const [entry] = await logged();
  expect(entry).toMatchObject({
    action: "signer.edit",
    targetId: signer.id,
    detail: {
      changes: {
        name: ["Dr. Max Muster", "Max Muster"],
        signerFunction: ["Vorstand", ""],
      },
    },
  });
  expect(JSON.stringify(entry)).not.toContain("max@example.org");

  // Saving the same values again changes and logs nothing.
  const again = await q.updateSignerByAdmin(signer.id, { name: "Max Muster" });
  expect(again.changes).toEqual({});
  expect(await logged()).toHaveLength(1);
  expect(await q.updateSignerByAdmin(999999, { name: "Niemand" })).toBeNull();
});

test("an edit is saved and logged whatever text sits around an address in the old value", async () => {
  // A quote, a backslash or a line break next to an address, as a name or a
  // note typed by hand can hold them.
  const names = [
    'Signer "contact@example.org"',
    "Signer \\contact@example.org\\",
    "Signer\ncontact@example.org\tand more",
    '"contact@example.org',
    "contact@example.org\\",
  ];
  for (const name of names) {
    const signer = await addVerifiedSigner({ name });
    const saved = await q.updateSignerByAdmin(
      signer.id,
      { name: "Signer", showPublicly: false },
      { consentNote: `asked by ${name}` },
    );
    expect(saved.signer.name).toBe("Signer");
    expect((await q.getSignerForAdmin(signer.id)).name).toBe("Signer");
  }

  const entries = await logged();
  expect(entries).toHaveLength(names.length);
  for (const entry of entries) {
    const [before, after] = entry.detail.changes.name;
    expect(before).toContain("[E-Mail-Adresse entfernt]");
    expect(after).toBe("Signer");
    expect(JSON.stringify(entry)).not.toContain("@");
  }
  // Only the address goes; the text around it stays as it was typed.
  expect(entries.at(-1).detail.changes.name[0]).toBe(
    'Signer "[E-Mail-Adresse entfernt]"',
  );

  // Values that are not text, and text JSON has to escape, are kept as is.
  await recordAdminAction(db, "signer.position", {
    targetId: 1,
    detail: {
      changes: { position: [null, 3], firstSigner: [false, true] },
      consentNote: 'half \ud800 pair, "quoted" \\ and\u0000 a@example.org',
    },
  });
  expect((await logged())[0].detail).toEqual({
    changes: { position: [null, 3], firstSigner: [false, true] },
    consentNote:
      'half \ud800 pair, "quoted" \\ and\u0000 [E-Mail-Adresse entfernt]',
  });
});

test("a function taken off stays off after a backup is restored, unless it was entered again", async () => {
  const signer = await addVerifiedSigner({ email: "funktion@example.org" });
  const setFunction = (value) =>
    db
      .query("UPDATE signers SET signer_function = ? WHERE id = ?")
      .run(value, signer.id);
  await setFunction("Sprecherin");
  await q.updateSignerByAdmin(signer.id, { signerFunction: "" });
  expect(await erasureKinds()).toEqual([CLEAR_SIGNER_FUNCTION]);

  // The backup still had the function; the replayed log takes it off again.
  await setFunction("Sprecherin");
  const replayed = await applyErasureLog(db, await readErasureLog(db));
  expect(replayed[CLEAR_SIGNER_FUNCTION]).toBe(1);
  expect((await q.getSignerForAdmin(signer.id)).signerFunction).toBe("");

  await q.updateSignerByAdmin(signer.id, { signerFunction: "Kassenwart" });
  expect(await erasureKinds()).toEqual([]);
});

test("taking something off is immediate; putting it on the public list needs recorded consent", async () => {
  cfg.features.publicSignerDetails = true;
  const signer = await addVerifiedSigner({ email: "privat@example.org" });
  await db
    .query("UPDATE signers SET show_signer_details = 1 WHERE id = ?")
    .run(signer.id);

  // Hiding the name hides the details with it, and stops the newsletter.
  const hidden = await q.updateSignerByAdmin(signer.id, {
    showPublicly: false,
    newsletter: false,
  });
  expect(hidden.signer).toMatchObject({
    showPublicly: false,
    showSignerDetails: false,
    newsletter: false,
  });
  expect((await q.getSigners({})).total).toBe(0);
  expect(await erasureKinds()).toEqual(
    [HIDE_PUBLICLY, HIDE_SIGNER_DETAILS, NEWSLETTER_OPT_OUT].sort(),
  );

  await expect(
    q.updateSignerByAdmin(signer.id, { showPublicly: true }),
  ).rejects.toMatchObject({ status: 400 });
  expect((await q.getSigners({})).total).toBe(0);

  const shown = await q.updateSignerByAdmin(
    signer.id,
    { showPublicly: true, showSignerDetails: true },
    { consent: true, consentNote: "per E-Mail am 3.11." },
  );
  expect(shown.signer).toMatchObject({
    showPublicly: true,
    showSignerDetails: true,
    consentNote: "per E-Mail am 3.11.",
  });
  expect(shown.signer.consentAt).toBeTruthy();
  expect((await q.getSigners({})).total).toBe(1);
  expect(await erasureKinds()).toEqual([NEWSLETTER_OPT_OUT]);
  expect((await logged())[0].detail).toEqual({
    changes: { showPublicly: [false, true], showSignerDetails: [false, true] },
    consentNote: "per E-Mail am 3.11.",
  });

  // The newsletter is never switched on from here.
  const stillOff = await q.updateSignerByAdmin(signer.id, { newsletter: true });
  expect(stillOff.signer.newsletter).toBe(false);
});

test("the log forgets a signature's old values once the signature is deleted, and ends after its retention", async () => {
  const signer = await addVerifiedSigner({ name: "Alter Name" });
  const kept = await addVerifiedSigner({ name: "Bleibt" });
  await q.updateSignerByAdmin(signer.id, { name: "Neuer Name" });
  await q.updateSignerByAdmin(kept.id, { name: "Bleibt Hier" });
  expect(
    (await q.getSignerForAdmin(signer.id)).history.map((e) => e.action),
  ).toEqual(["signer.edit"]);

  await q.eraseEmail(signer.email);
  const afterErase = await logged();
  expect(JSON.stringify(afterErase)).not.toContain("Alter Name");
  expect(JSON.stringify(afterErase)).not.toContain("Neuer Name");
  expect(
    afterErase.map((e) => [e.action, e.targetId, Boolean(e.detail)]),
  ).toEqual([
    ["signer.edit", kept.id, true],
    ["signer.edit", signer.id, false],
  ]);

  await recordAdminAction(db, "export.signers", {
    count: 3,
    at: new Date(Date.now() - 40 * 86400_000),
  });
  expect((await q.listAdminActions({})).total).toBe(3);
  await q.purgeOldAdminActions(new Date(Date.now() - 30 * 86400_000));
  expect((await q.listAdminActions({})).total).toBe(2);
  await expect(recordAdminAction(db, "signer.invented")).rejects.toThrow(
    "Unknown admin action",
  );
});

test("looking up an address shows every sign-up of the mailbox, confirmed or not, and whether it is blocked", async () => {
  const confirmed = await addVerifiedSigner({
    name: "Rita Real",
    email: "rita@example.org",
    newsletter: 0,
    created_at: isoAgoDays(1),
  });
  await q.insertSigner({ ...signUp("rita+neu@example.org"), name: "Rita Neu" });
  await addVerifiedSigner({ email: "nicht-rita@example.org" });
  await addZoomRegistration({ email: "rita@example.org" });

  const found = await q.lookupSignups("rita@example.org");
  expect(found.blocked).toBe(false);
  expect(found.meeting).toBe("registered");
  expect(found.signups.map((s) => [s.name, s.verified, s.newsletter])).toEqual([
    ["Rita Neu", false, false],
    ["Rita Real", true, false],
  ]);
  expect(found.signups[0].confirmationExpiresAt).toBeTruthy();
  expect(found.signups[1]).toMatchObject({
    id: confirmed.id,
    confirmationExpiresAt: null,
  });

  expect(await q.lookupSignups("niemand@example.org")).toMatchObject({
    blocked: false,
    signups: [],
    mail: [],
    queued: 0,
    meeting: null,
  });
  await q.removeAndBlockSigner(confirmed.id);
  expect((await q.lookupSignups("rita+x@example.org")).blocked).toBe(true);
});

test("the public export holds what the public list shows and no address", async () => {
  cfg.features.publicSignerDetails = true;
  const open = await addVerifiedSigner({
    name: "Offen Sichtbar",
    email: "offen@example.org",
    occupation: "Verein A",
    created_at: isoAgoDays(2),
  });
  await db
    .query(
      "UPDATE signers SET show_signer_details = 1, signer_function = 'Vorsitz' WHERE id = ?",
    )
    .run(open.id);
  await addVerifiedSigner({
    name: "Nur Name",
    email: "name@example.org",
    occupation: "Geheimbund",
    created_at: isoAgoDays(1),
  });
  await addVerifiedSigner({ name: "Nur Gezählt", show_publicly: 0 });
  await q.insertSigner(signUp("offen+pending@example.org"));

  const rows = await q.exportPublicSigners();
  expect(rows.map((r) => [r.name, r.signerFunction, r.organisation])).toEqual([
    ["Offen Sichtbar", "Vorsitz", "Verein A"],
    ["Nur Name", "", ""],
  ]);
  expect(JSON.stringify(rows)).not.toContain("@");
  expect((await logged())[0]).toMatchObject({
    action: "export.signers",
    count: 2,
  });

  await addZoomRegistration({ name: "Gast Eins", email: "gast@example.org" });
  const guests = await q.exportMeetingRegistrations();
  expect(guests.map((g) => [g.name, g.delegierter])).toEqual([
    ["Gast Eins", false],
  ]);
  expect(JSON.stringify(guests)).not.toContain("@");
  expect((await logged())[0]).toMatchObject({
    action: "export.meeting-registrations",
    count: 1,
  });
});

test("only the person's own click on a current link subscribes them to the newsletter", async () => {
  const signer = await addVerifiedSigner({ newsletter: 0 });
  await setUnsubToken(signer.id, "frisch", 1);
  expect(await q.getNewsletterOptIn("frisch")).toMatchObject({
    id: signer.id,
    newsletter: false,
  });
  expect((await q.getSignerForAdmin(signer.id)).newsletter).toBe(false);

  expect(await q.confirmNewsletterOptIn("falsch")).toBeNull();
  expect(await q.confirmNewsletterOptIn("frisch")).toMatchObject({
    id: signer.id,
  });
  expect((await q.getSignerForAdmin(signer.id)).newsletter).toBe(true);
  // A second click changes and logs nothing more.
  await q.confirmNewsletterOptIn("frisch");
  expect((await logged()).map((e) => [e.action, e.targetId])).toEqual([
    ["signer.newsletter-confirmed", signer.id],
  ]);

  const late = await addVerifiedSigner({ newsletter: 0 });
  await setUnsubToken(late.id, "alt", 200);
  expect(await q.confirmNewsletterOptIn("alt")).toBeNull();
  expect((await q.getSignerForAdmin(late.id)).newsletter).toBe(false);
});
