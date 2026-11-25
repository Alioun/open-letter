import { beforeEach, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { SignJWT } from "jose";
import { db, resetDb } from "./helpers.js";
import {
  createAdminSessions,
  endAdminSessions,
} from "../server/admin-sessions.js";

const secret = "admin-session-test-secret-with-32-characters";
const start = (password = "the-shared-admin-password") =>
  createAdminSessions(db, { password, secret });

beforeEach(resetDb);

test("a token signs in until every session is ended", async () => {
  const sessions = await start();
  const token = await sessions.issue();
  expect(await sessions.verify(token)).toBe(true);

  await sessions.revokeAll();
  expect(await sessions.verify(token)).toBe(false);
  expect(await sessions.verify(await sessions.issue())).toBe(true);
});

test("a restart keeps sessions, and keeps ended sessions ended", async () => {
  const before = await start();
  const ended = await before.issue();
  await before.revokeAll();
  const current = await before.issue();

  const after = await start();
  expect(await after.verify(current)).toBe(true);
  expect(await after.verify(ended)).toBe(false);
});

test("restoring a backup does not bring back sessions ended since", async () => {
  const before = await start();
  const leaked = await before.issue();
  const backup = await db.query("SELECT key, value FROM app_settings").all();
  await before.revokeAll();

  // The restore puts the settings of the backup's time in place, and then
  // ends the sessions of that time.
  await db.run("DELETE FROM app_settings");
  for (const row of backup)
    await db
      .query("INSERT INTO app_settings (key, value) VALUES (?, ?)")
      .run(row.key, row.value);
  await endAdminSessions(db);

  const after = await start();
  expect(await after.verify(leaked)).toBe(false);
  expect(await after.verify(await after.issue())).toBe(true);
});

test("starting with a different password ends every session", async () => {
  const token = await (await start()).issue();
  const changed = await start("a-new-admin-password-after-a-leak");
  expect(await changed.verify(token)).toBe(false);
  expect(await changed.verify(await changed.issue())).toBe(true);
});

test("tokens that were not issued here do not sign in", async () => {
  const sessions = await start();
  const sign = (claims, key = secret) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("admin")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(new TextEncoder().encode(key));

  expect(await sessions.verify("")).toBe(false);
  expect(await sessions.verify("not-a-token")).toBe(false);
  // Issued before sessions had a generation.
  expect(await sessions.verify(await sign({ scope: "admin" }))).toBe(false);
  expect(await sessions.verify(await sign({ scope: "admin", gen: 1 }))).toBe(
    false,
  );
  // The right claims under another key: copy them from a real token.
  const [, claims] = (await sessions.issue()).split(".");
  const { gen } = JSON.parse(Buffer.from(claims, "base64url").toString());
  expect(await sessions.verify(await sign({ scope: "public", gen }))).toBe(
    false,
  );
  expect(
    await sessions.verify(
      await sign(
        { scope: "admin", gen },
        "another-secret-that-is-32-characters-long",
      ),
    ),
  ).toBe(false);
});
