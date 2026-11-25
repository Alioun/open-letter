// The signer, export and log routes as the admin page calls them, on a
// letter with organisation, function and public details switched on.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startAdminServer } from "./fixtures/admin-server.js";

const BOOT_TIMEOUT = 120_000;

describe("moderating signatures over HTTP", () => {
  let server;
  let token;
  const call = (path, options = {}) =>
    server.request(path, { token, ...options });
  const post = (path, body = {}) => call(path, { method: "POST", body });
  const addSigner = (fields) =>
    server.sql(async (db) => {
      const row = {
        name: "Test Person",
        occupation: "",
        signer_function: "",
        newsletter: 0,
        show_publicly: 1,
        show_signer_details: null,
        verified: 1,
        verification_token: null,
        token_expires_at: null,
        ...fields,
      };
      const columns = Object.keys(row);
      return (
        await db
          .query(
            `INSERT INTO signers (${columns.join(",")})
             VALUES (${columns.map(() => "?").join(",")}) RETURNING id`,
          )
          .get(...Object.values(row))
      ).id;
    });
  const actions = async () =>
    (await (await call("/api/admin/actions")).json()).actions.map(
      ({ action, targetId, count }) => [action, targetId, count],
    );
  const queuedMails = () =>
    server.sql(async (db) =>
      (
        await db
          .query("SELECT payload FROM _honker_live WHERE queue = 'emails'")
          .all()
      ).map((job) => JSON.parse(job.payload)),
    );

  beforeAll(async () => {
    server = await startAdminServer({
      env: { REQUIRE_API_TOKEN: "false", HTTP_FIXTURE_SIGNER_DETAILS: "1" },
      preload: ["./test/fixtures/signer-details-on.js"],
    });
    token = await server.login();
  }, BOOT_TIMEOUT);
  afterAll(() => server?.stop());

  test("every route needs a session", async () => {
    for (const [path, method] of [
      ["/api/admin/signers/1", "PATCH"],
      ["/api/admin/signers/1/erase", "POST"],
      ["/api/admin/signers/remove", "POST"],
      ["/api/admin/signers/lookup", "POST"],
      ["/api/admin/signers/blocks", "GET"],
      ["/api/admin/export/signers.csv", "GET"],
      ["/api/admin/actions", "GET"],
    ]) {
      const response = await server.request(path, {
        method,
        ...(method !== "GET" && { body: "{}" }),
      });
      expect([path, response.status]).toEqual([path, 401]);
    }
  });

  test("an edit is cleaned like a sign-up, and public display needs the consent box", async () => {
    const id = await addSigner({
      name: "Dr. Erika Beispiel",
      email: "erika@example.org",
      occupation: "Verein A",
      signer_function: "Vorstand",
      show_publicly: 0,
      newsletter: 1,
    });
    const patch = (body) =>
      call(`/api/admin/signers/${id}`, { method: "PATCH", body });

    expect((await patch({ name: "<b>E</b>" })).status).toBe(400);
    expect((await patch({ showPublicly: true })).status).toBe(400);
    expect((await patch({ newsletter: false })).status).toBe(200);
    expect((await patch({ newsletter: true })).status).toBe(400);
    expect(
      (await call("/api/admin/signers/abc", { method: "PATCH", body: {} }))
        .status,
    ).toBe(400);
    expect(
      (await call("/api/admin/signers/999999", { method: "PATCH", body: {} }))
        .status,
    ).toBe(404);

    const saved = await patch({
      name: "  Erika <i>Beispiel</i> ",
      signerFunction: "",
      showPublicly: true,
      showSignerDetails: true,
      consent: true,
      consentNote: "per E-Mail am 3.11.",
      email: "andere@example.org",
    });
    expect(saved.status).toBe(200);
    const { signer, changed } = await saved.json();
    expect(changed.sort()).toEqual([
      "name",
      "showPublicly",
      "showSignerDetails",
      "signerFunction",
    ]);
    expect(signer).toMatchObject({
      name: "Erika Beispiel",
      email: "erika@example.org",
      occupation: "Verein A",
      signerFunction: "",
      showPublicly: true,
      showSignerDetails: true,
      newsletter: false,
    });

    const list = await (await call("/api/signers")).json();
    expect(list.signers).toMatchObject([
      { name: "Erika Beispiel", organisation: "Verein A" },
    ]);
    const detail = await (await call(`/api/admin/signers/${id}`)).json();
    expect(detail.consentNote).toBe("per E-Mail am 3.11.");
    expect(detail.history.map((entry) => entry.action)).toEqual([
      "signer.edit",
      "signer.edit",
    ]);
    expect(detail.history[0].detail.changes.name).toEqual([
      "Dr. Erika Beispiel",
      "Erika Beispiel",
    ]);
  });

  test("the newsletter is asked for by mail and switched on by the person's click", async () => {
    const id = await addSigner({
      name: "Nora News",
      email: "nora@example.org",
    });
    expect(
      (await post(`/api/admin/signers/${id}/newsletter-request`)).status,
    ).toBe(200);
    expect(await queuedMails()).toContainEqual(
      expect.objectContaining({ kind: "newsletter-optin", signerId: id }),
    );
    expect((await actions())[0]).toEqual([
      "signer.newsletter-request",
      id,
      null,
    ]);

    await server.sql((db) =>
      db
        .query(
          "UPDATE signers SET unsubscribe_token = 'nora-token', unsubscribe_token_created_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), id),
    );
    const page = await server.request(
      "/api/newsletter-einwilligung/nora-token",
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Yes, subscribe");
    const still = await (await call(`/api/admin/signers/${id}`)).json();
    expect(still.newsletter).toBe(false);

    const click = await server.request(
      "/api/newsletter-einwilligung/nora-token",
      {
        method: "POST",
      },
    );
    expect(click.status).toBe(200);
    expect(await click.text()).toContain("You're subscribed");
    const now = await (await call(`/api/admin/signers/${id}`)).json();
    expect(now.newsletter).toBe(true);
    expect(now.history[0].action).toBe("signer.newsletter-confirmed");

    expect(
      (await post(`/api/admin/signers/${id}/newsletter-request`)).status,
    ).toBe(409);
    expect(
      (
        await server.request("/api/newsletter-einwilligung/unbekannt", {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });

  test("an address is looked up with its unconfirmed sign-ups, and the confirmation can be sent again", async () => {
    const pending = await addSigner({
      name: "Paul Offen",
      email: "paul+brief@example.org",
      verified: 0,
      verification_token: "alt-token",
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const lookup = await post("/api/admin/signers/lookup", {
      email: " Paul@Example.org ",
    });
    expect(lookup.status).toBe(200);
    const found = await lookup.json();
    expect(found).toMatchObject({ email: "paul@example.org", blocked: false });
    expect(found).not.toHaveProperty("meeting");
    expect(found.signups).toMatchObject([
      { id: pending, name: "Paul Offen", verified: false },
    ]);
    expect(
      (await post("/api/admin/signers/lookup", { email: "kein" })).status,
    ).toBe(400);

    expect(
      (await post(`/api/admin/signers/${pending}/resend-confirmation`)).status,
    ).toBe(200);
    const mail = (await queuedMails()).find((job) => job.signerId === pending);
    expect(mail.kind).toBe("verification");
    expect(mail.token).toBeTruthy();
    expect(mail.token).not.toBe("alt-token");
    expect((await actions())[0]).toEqual([
      "signer.resend-confirmation",
      pending,
      null,
    ]);

    const confirmed = await addSigner({ email: "fertig@example.org" });
    expect(
      (await post(`/api/admin/signers/${confirmed}/resend-confirmation`))
        .status,
    ).toBe(409);
  });

  test("a selection is removed and blocked in one step; a deletion leaves the address free", async () => {
    const ids = [
      await addSigner({ name: "Spam Eins", email: "spam+1@example.org" }),
      await addSigner({ name: "Spam Zwei", email: "quatsch@example.org" }),
    ];
    const twin = await addSigner({
      name: "Spam Drei",
      email: "spam+3@example.org",
    });
    const regret = await addSigner({ name: "Reue", email: "reue@example.org" });

    expect((await post("/api/admin/signers/remove", { ids: [] })).status).toBe(
      400,
    );
    expect(
      (await post("/api/admin/signers/remove", { ids: ["1"] })).status,
    ).toBe(400);
    const removed = await (
      await post("/api/admin/signers/remove", { ids })
    ).json();
    expect(removed.removed).toBe(2);
    expect(removed.variants).toMatchObject([{ id: twin, name: "Spam Drei" }]);

    expect((await post(`/api/admin/signers/${regret}/erase`)).status).toBe(200);
    expect((await post(`/api/admin/signers/${regret}/erase`)).status).toBe(404);

    const blocks = await (await call("/api/admin/signers/blocks")).json();
    expect(blocks.total).toBe(2);
    expect(
      (
        await post("/api/admin/signers/lookup", {
          email: "reue@example.org",
        }).then((r) => r.json())
      ).blocked,
    ).toBe(false);
    expect(
      (
        await post("/api/admin/signers/lookup", {
          email: "spam@example.org",
        }).then((r) => r.json())
      ).blocked,
    ).toBe(true);
    expect((await actions()).slice(0, 2)).toEqual([
      ["signer.erase", regret, 1],
      ["signer.remove-block", null, 2],
    ]);
  });

  test("the export is a spreadsheet of the public list, without addresses, and is logged", async () => {
    await addSigner({
      name: "=SUMME(A1)",
      email: "formel@example.org",
      occupation: 'Verein "B"; e.V.',
      signer_function: "Kasse",
      show_signer_details: 1,
    });
    await addSigner({
      name: "Nicht Gezeigt",
      email: "still@example.org",
      show_publicly: 0,
    });
    const response = await call("/api/admin/export/signers.csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="unterschriften-oeffentlich-\d{4}-\d\d-\d\d\.csv"/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The byte order mark a German Excel needs to read the umlauts.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toStartWith(
      "Name;Funktion;Organisation;Unterschrieben am\r\n",
    );
    expect(text).toContain(`'=SUMME(A1);Kasse;"Verein ""B""; e.V.";`);
    expect(text).not.toContain("@");
    expect(text).not.toContain("Nicht Gezeigt");
    expect((await actions())[0][0]).toBe("export.signers");

    // The letter has no meeting, so there is nothing to export for it.
    expect(
      (await call("/api/admin/export/meeting-registrations.csv")).status,
    ).toBe(404);
  });

  test("other admin writes show up in the log, newest first, with how long it is kept", async () => {
    expect(
      (await post("/api/admin/milestones", { milestones: [100, 500] })).status,
    ).toBe(200);
    const log = await (await call("/api/admin/actions")).json();
    expect(log.retentionDays).toBe(30);
    expect(log.total).toBeGreaterThan(5);
    expect(log.actions[0]).toMatchObject({
      action: "settings.milestones",
      count: 2,
    });
    expect(JSON.stringify(log)).not.toContain("@");
  });

  test("hand-sent mails skip blocked mailboxes and wait between clicks; notes lose addresses", async () => {
    const id = await addSigner({
      email: "wiebke@example.org",
      show_publicly: 0,
    });
    await call(`/api/admin/signers/${id}`, {
      method: "PATCH",
      body: {
        showPublicly: true,
        consent: true,
        consentNote: "Zustimmung von wiebke@example.org",
      },
    });
    const detail = await (await call(`/api/admin/signers/${id}`)).json();
    expect(detail.consentNote).toBe("Zustimmung von [E-Mail-Adresse entfernt]");
    expect(JSON.stringify(detail.history)).not.toContain("@example.org");

    expect(
      (await post(`/api/admin/signers/${id}/newsletter-request`)).status,
    ).toBe(200);
    const again = await post(`/api/admin/signers/${id}/newsletter-request`);
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(0);

    const blocked = await addSigner({ email: "gesperrt@example.org" });
    const variant = await addSigner({
      email: "gesperrt+2@example.org",
      verified: 0,
      verification_token: "v-token",
      token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect((await post(`/api/admin/signers/${blocked}/remove`)).status).toBe(
      200,
    );
    expect(
      (await post(`/api/admin/signers/${variant}/resend-confirmation`)).status,
    ).toBe(409);
    expect((await queuedMails()).some((job) => job.signerId === variant)).toBe(
      false,
    );

    expect(
      (await post("/api/admin/email", { action: "requeue-failed" })).status,
    ).toBe(200);
    expect((await actions())[0][0]).toBe("email.requeue-failed");
  });

  test("first signers: added by hand, never mailed, ordered with a revision, imported after a backup", async () => {
    const put = (path, body) => call(path, { method: "PUT", body });
    const refused = await post("/api/admin/first-signers", {
      name: "Ohne Zustimmung",
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("zugestimmt");

    const added = await post("/api/admin/first-signers", {
      name: "Dr. Von Hand",
      occupation: "Klinikum",
      signerFunction: "Chefärztin",
      showSignerDetails: true,
      consent: true,
      consentNote: "per Telefon, hand@example.org",
      pin: true,
    });
    expect(added.status).toBe(200);
    const { signer: entry } = await added.json();
    expect(entry).toMatchObject({
      handAdded: true,
      firstSigner: true,
      email: null,
      position: 1,
    });

    // The public page shows it first, labelled, with its details.
    const page = await (
      await server.request("/api/signers?filter=alle&sort=asc&limit=5")
    ).json();
    expect(page.signers[0]).toMatchObject({
      name: "Dr. Von Hand",
      firstSigner: true,
      organisation: "Klinikum",
    });

    // Nothing can be sent to it and there is no address to block.
    for (const path of ["newsletter-request", "remove"]) {
      const response = await post(`/api/admin/signers/${entry.id}/${path}`);
      expect([path, response.status]).toEqual([path, 409]);
      expect((await response.json()).error).toContain("keine E-Mail-Adresse");
    }
    expect((await queuedMails()).some((j) => j.signerId === entry.id)).toBe(
      false,
    );

    const other = await addSigner({
      name: "Formular Person",
      email: "formular@example.org",
    });
    expect(
      (await post(`/api/admin/signers/${other}/position`, { position: 1 }))
        .status,
    ).toBe(200);
    expect(
      (await post(`/api/admin/signers/${other}/position`, { position: 0 }))
        .status,
    ).toBe(400);
    const listed = await (await call("/api/admin/first-signers")).json();
    expect(listed.ordered.map((s) => s.id)).toEqual([other, entry.id]);

    const saved = await put("/api/admin/first-signers/order", {
      ids: [entry.id, other],
      revision: listed.revision,
    });
    expect(saved.status).toBe(200);
    const stale = await put("/api/admin/first-signers/order", {
      ids: [other],
      revision: listed.revision,
    });
    expect(stale.status).toBe(409);
    const conflict = await stale.json();
    expect(conflict.error).toContain("inzwischen an anderer Stelle");
    expect(conflict.revision).toBe((await saved.json()).revision);

    expect(
      (
        await post(`/api/admin/signers/${other}/first-signer`, {
          marked: true,
        })
      ).status,
    ).toBe(200);

    const csv =
      "name,email\nFormular Person,formular@example.org\nNeu Importiert,\n";
    const preview = await (
      await post("/api/admin/first-signers/import/preview", { csv })
    ).json();
    expect(preview.counts).toMatchObject({ already: 1, add: 1, skip: 0 });
    expect(
      (
        await post("/api/admin/first-signers/import", {
          csv,
          plan: preview.plan,
        })
      ).status,
    ).toBe(400);
    const imported = await post("/api/admin/first-signers/import", {
      csv,
      plan: preview.plan,
      consent: true,
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ added: 1, marked: 0 });
    const backup = await (await call("/api/admin/backup")).json();
    expect(backup.lastSuccessAt).toBeTruthy();

    const log = (await actions()).map(([action]) => action);
    for (const action of [
      "signer.add-by-hand",
      "signer.position",
      "first-signers.order",
      "signer.first-signer",
      "first-signers.import",
    ])
      expect(log).toContain(action);
    const entries = (await (await call("/api/admin/actions")).json()).actions;
    expect(JSON.stringify(entries)).not.toContain("@example.org");
    // Writes a real backup on the way, which takes a while on a busy machine.
  }, 180_000);
});
