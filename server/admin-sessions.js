import { createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const GENERATION_KEY = "admin:session-generation";
const PASSWORD_KEY = "admin:password-fingerprint";

const read = async (db, name) =>
  (await db.query("SELECT value FROM app_settings WHERE key = ?").get(name))
    ?.value;
const save = (db, name, value) =>
  db
    .query(
      `INSERT INTO app_settings /* public-neutral */ (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(name, value, new Date().toISOString());

// Gives sessions a new generation, which ends every session issued so far.
// db/restore-backup.js runs this too: a backup holds the generation of its
// time, and restoring that would bring back sessions ended since.
export async function endAdminSessions(db) {
  const generation = randomUUID();
  await save(db, GENERATION_KEY, generation);
  return generation;
}

// Admin sign-in tokens. A token is good for two hours and only while the
// session generation it was issued under is still the current one. A new
// generation is how sessions end before they expire: "Überall abmelden" makes
// one, and so does a start with a different ADMIN_PASSWORD, so whoever held
// the old password is out as soon as it is changed.
export async function createAdminSessions(db, { password, secret }) {
  const key = new TextEncoder().encode(secret);
  // Keyed with the signing secret, so the stored value says nothing about the
  // password to someone who only has the database.
  const fingerprint = createHmac("sha256", secret)
    .update(password)
    .digest("hex");
  let generation = await read(db, GENERATION_KEY);
  if (!generation || (await read(db, PASSWORD_KEY)) !== fingerprint) {
    generation = await endAdminSessions(db);
    await save(db, PASSWORD_KEY, fingerprint);
  }

  return {
    async revokeAll() {
      generation = await endAdminSessions(db);
    },
    issue() {
      return new SignJWT({ scope: "admin", gen: generation })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("admin")
        .setIssuedAt()
        .setExpirationTime("2h")
        .sign(key);
    },
    async verify(token) {
      if (!token) return false;
      try {
        const { payload } = await jwtVerify(token, key);
        return (
          payload.sub === "admin" &&
          payload.scope === "admin" &&
          payload.gen === generation
        );
      } catch {
        return false;
      }
    },
  };
}
