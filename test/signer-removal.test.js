import { beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { db, resetDb, addVerifiedSigner, isoAgoDays } from "./helpers.js";
import * as q from "../server/db.js";
import {
  BLOCK_SIGNING,
  ERASE,
  applyErasureLog,
  purgeErasureLog,
  readErasureLog,
} from "../db/erasure-log.js";
import { canonicalMailbox } from "../db/email-identity.js";
import { SignerTable } from "../src/SignerManagement.jsx";
import {
  isSignerList,
  removeSigner,
  signerListPath,
  unblockSigner,
} from "../src/signer-admin.js";

const signUp = (email, name = "Neue Person") =>
  q.insertSigner({
    name,
    email,
    kv: "",
    occupation: "",
    newsletter: false,
    showPublicly: true,
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 86400_000),
  });

beforeEach(resetDb);

test("the admin list shows every confirmed signature, newest first, and searches name and email", async () => {
  await addVerifiedSigner({ name: "Erste", created_at: isoAgoDays(3) });
  const hidden = await addVerifiedSigner({
    name: "Adolf Witzbold",
    email: "joke@example.org",
    newsletter: 0,
    show_publicly: 0,
    created_at: isoAgoDays(1),
  });
  await signUp("pending@example.org", "Unbestätigt");

  const all = await q.listSigners({});
  expect(all.total).toBe(2);
  expect(all.signers.map((s) => s.name)).toEqual(["Adolf Witzbold", "Erste"]);
  expect(all.signers[0]).toMatchObject({
    id: hidden.id,
    email: "joke@example.org",
    showPublicly: false,
  });

  expect((await q.listSigners({ search: "JOKE@" })).signers).toHaveLength(1);
  expect((await q.listSigners({ search: "witzbold" })).total).toBe(1);
  expect((await q.listSigners({ limit: 1, offset: 1 })).signers[0].name).toBe(
    "Erste",
  );
});

test("removing a signature erases it from the count and blocks the address from signing again", async () => {
  const joke = await addVerifiedSigner({ email: "Joke@Example.org" });
  const real = await addVerifiedSigner();

  expect(await q.removeAndBlockSigner(joke.id)).toEqual({ variants: [] });
  expect(await q.removeAndBlockSigner(joke.id)).toBeNull();
  expect((await q.getStats()).total).toBe(1);
  expect((await q.listSigners({})).signers.map((s) => s.id)).toEqual([real.id]);

  const retry = await signUp("  joke@example.ORG ");
  expect(retry).toMatchObject({ ok: false, blocked: true });
  expect(
    await db
      .query(
        "SELECT COUNT(*) AS n FROM signers WHERE lower(email) LIKE 'joke@%'",
      )
      .get(),
  ).toEqual({ n: 0 });

  expect((await signUp("someone-else@example.org")).ok).toBe(true);
});

test("a signing block outlives the erasure log purge, expires with signer retention, and is carried into a restored backup", async () => {
  const joke = await addVerifiedSigner({ email: "joke@example.org" });
  await q.removeAndBlockSigner(joke.id);
  const tomorrow = new Date(Date.now() + 86400_000);
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 86400_000);

  await purgeErasureLog(db, tomorrow, threeYearsAgo);
  const kept = await readErasureLog(db);
  expect(kept.map((entry) => entry.kind)).toEqual([BLOCK_SIGNING]);
  expect(await q.isSigningBlocked("joke@example.org")).toBe(true);

  const entries = await readErasureLog(db);
  await db.run("DELETE FROM erasure_log");
  expect(await q.isSigningBlocked("joke@example.org")).toBe(false);
  await applyErasureLog(db, entries);
  expect(await q.isSigningBlocked("joke@example.org")).toBe(true);

  await purgeErasureLog(db, tomorrow, tomorrow);
  expect(await q.isSigningBlocked("joke@example.org")).toBe(false);
});

test("an erase without a block still lets the address sign again", async () => {
  const signer = await addVerifiedSigner({ email: "changed-mind@example.org" });
  await q.eraseEmail(signer.email);
  expect((await readErasureLog(db)).map((entry) => entry.kind)).toEqual([
    ERASE,
  ]);
  expect((await signUp("changed-mind@example.org")).ok).toBe(true);
});

test("the admin view requests pages, validates the list, and reports each removal outcome", async () => {
  expect(signerListPath({ search: " hitler " }, 2)).toBe(
    "/api/admin/signers?limit=50&offset=100&search=hitler",
  );
  expect(signerListPath({}, 0)).toBe("/api/admin/signers?limit=50&offset=0");
  const filtered = new URL(
    signerListPath(
      { from: "2026-11-01", to: "2026-11-02", visibility: "hidden" },
      1,
      20,
    ),
    "http://admin.invalid",
  ).searchParams;
  expect(Object.fromEntries(filtered)).toEqual({
    limit: "20",
    offset: "20",
    from: new Date("2026-11-01T00:00:00").toISOString(),
    to: new Date("2026-11-02T23:59:59.999").toISOString(),
    public: "hidden",
  });
  expect(isSignerList({ total: 1, signers: [{ id: 1, name: "A" }] })).toBe(
    true,
  );
  expect(isSignerList({ total: 1, signers: [{ name: "A" }] })).toBe(false);

  const calls = [];
  const api =
    (status, body = {}) =>
    async (path, options) => {
      calls.push([path, options.method]);
      return Response.json(body, { status });
    };
  const twin = { id: 8, name: "Witz Zwei", email: "joke+2@example.org" };
  expect(await removeSigner(api(200, { variants: [twin] }), { id: 7 })).toEqual(
    { outcome: "removed", variants: [twin] },
  );
  expect((await removeSigner(api(404), { id: 7 })).outcome).toBe("gone");
  await expect(removeSigner(api(500), { id: 7 })).rejects.toThrow("500");
  expect(calls[0]).toEqual(["/api/admin/signers/7/remove", "POST"]);

  const signer = {
    id: 7,
    name: "Witz Bold",
    email: "joke@example.org",
    signerFunction: "Clown",
    showPublicly: true,
    showSignerDetails: false,
    newsletter: false,
    firstSigner: true,
    position: 2,
    createdAt: "2026-11-20T10:00:00.000Z",
  };
  const html = renderToStaticMarkup(
    <SignerTable
      signers={[
        signer,
        {
          ...signer,
          id: 9,
          name: "Still",
          showPublicly: false,
          firstSigner: false,
          position: null,
        },
        {
          ...signer,
          id: 11,
          name: "Per Hand",
          email: null,
          handAdded: true,
          firstSigner: true,
          position: null,
          possibleDuplicate: true,
        },
      ]}
      details={["signerFunction", "occupation"]}
      busy={false}
      actions={{}}
      selected={new Map([[9, signer]])}
      onSelect={() => {}}
      onSelectPage={() => {}}
    />,
  );
  expect(html).toContain("Witz Bold");
  expect(html).toContain("Clown");
  // Addresses carry <wbr> break hints after "@" and "."; the visible text is unchanged.
  expect(html.replaceAll("<wbr/>", "")).toContain("joke@example.org");
  // Mark and position are separate badges, in the table and on the cards.
  expect(html.match(/>Erstunterzeichner\*in</g)).toHaveLength(4);
  expect(html.match(/>Position 2</g)).toHaveLength(2);
  expect(html.match(/>Von Hand eingetragen</g)).toHaveLength(2);
  expect(html.match(/>Mögliches Duplikat</g)).toHaveLength(2);
  expect(html).toContain("Von Hand eingetragen, ohne E-Mail-Adresse");
  // A hand entry cannot be selected for "entfernen und sperren".
  expect(html).not.toContain('aria-label="Per Hand auswählen"');
  expect(html).toContain("Nur Name");
  // Phone cards carry every action as a button; the table folds them in a menu.
  for (const label of [
    "Bearbeiten",
    "Nicht öffentlich zeigen",
    "Löschen ohne Sperre",
    "Entfernen und sperren",
    "Position entfernen",
    "Nach oben anheften",
    "Als Erstunterzeichner*in markieren",
    "Markierung als Erstunterzeichner*in entfernen",
    "Mit Duplikat verknüpfen",
  ])
    expect(html).toContain(label);
  expect(html.match(/Nicht öffentlich zeigen/g)).toHaveLength(2);
  // The hand entry has nothing to block.
  expect(html.match(/Entfernen und sperren/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Weitere Aktionen für Witz Bold"');
  expect(html).toContain('aria-label="Witz Bold auswählen"');
  expect(html).toContain('aria-selected="true"');
});

test("a block also catches plus-tags and Gmail spellings of the same mailbox", async () => {
  expect(canonicalMailbox(" Witz+Spam@Example.org ")).toBe("witz@example.org");
  expect(canonicalMailbox("W.i.t.z+1@googlemail.com")).toBe("witz@gmail.com");
  expect(canonicalMailbox("w.itz@example.org")).toBe("w.itz@example.org");
  expect(canonicalMailbox("+only@example.org")).toBe("+only@example.org");

  const joke = await addVerifiedSigner({ email: "witz.bold@gmail.com" });
  await q.removeAndBlockSigner(joke.id);
  for (const variant of [
    "witzbold@gmail.com",
    "Witz.Bold+2@googlemail.com",
    "w.i.t.z.b.o.l.d+x@gmail.com",
  ])
    expect((await signUp(variant)).blocked).toBe(true);
  expect((await signUp("witz.bold@example.org")).ok).toBe(true);
});

test("removing a signature names the other sign-ups of the same mailbox", async () => {
  const first = await addVerifiedSigner({
    name: "Spam Eins",
    email: "spam+1@example.org",
    created_at: isoAgoDays(3),
  });
  const second = await addVerifiedSigner({
    name: "Spam Zwei",
    email: "Spam+2@Example.org",
    created_at: isoAgoDays(2),
  });
  const plain = await addVerifiedSigner({
    name: "Spam",
    email: "spam@example.org",
    created_at: isoAgoDays(1),
  });
  await signUp("spam+pending@example.org", "Noch offen");
  await addVerifiedSigner({ email: "spam@example.com" });
  await addVerifiedSigner({ email: "spammer@example.org" });

  const { variants } = await q.removeAndBlockSigner(first.id);
  expect(variants.map((v) => [v.name, v.verified])).toEqual([
    ["Noch offen", false],
    ["Spam", true],
    ["Spam Zwei", true],
  ]);
  expect(variants[1]).toMatchObject({ id: plain.id, email: plain.email });

  // Each is removed the same way; the last one leaves none behind.
  await q.removeAndBlockSigner(second.id);
  await q.removeAndBlockSigner(plain.id);
  const last = await q.removeAndBlockSigner(variants[0].id);
  expect(last).toEqual({ variants: [] });

  const gmail = await addVerifiedSigner({ email: "wi.tz@gmail.com" });
  const dotted = await addVerifiedSigner({ email: "w.i.t.z+a@googlemail.com" });
  expect(
    (await q.removeAndBlockSigner(gmail.id)).variants.map((v) => v.id),
  ).toEqual([dotted.id]);
});

test("lifting a block lets the address and its variants sign again", async () => {
  const joke = await addVerifiedSigner({ email: "mistake@example.org" });
  await q.removeAndBlockSigner(joke.id);
  expect(await q.unblockSigning("Mistake+x@Example.org")).toBe(true);
  expect(await q.unblockSigning("mistake@example.org")).toBe(false);
  expect((await signUp("mistake@example.org")).ok).toBe(true);

  const answers = { 200: { unblocked: true }, 201: { unblocked: false } };
  const api = (status) => async (path, options) => {
    expect(path).toBe("/api/admin/signers/unblock");
    expect(JSON.parse(options.body)).toEqual({ email: "a@b.org" });
    return Response.json(answers[status] || {}, {
      status: status === 201 ? 200 : status,
    });
  };
  expect(await unblockSigner(api(200), "a@b.org")).toBe("unblocked");
  expect(await unblockSigner(api(201), "a@b.org")).toBe("not-blocked");
  expect(await unblockSigner(api(400), "a@b.org")).toBe("invalid");
  await expect(unblockSigner(api(500), "a@b.org")).rejects.toThrow("500");
});
