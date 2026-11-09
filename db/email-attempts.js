import { createHash } from "node:crypto";
import { emailHmac } from "./email-identity.js";
import cfg from "../config/letter.config.js";

const digest = (scope) => createHash("sha256").update(scope).digest("hex");

async function meetingDates(db, tables) {
  const dates = new Set();
  const configured = process.env.ZOOM_EVENT_AT || cfg.zoom?.eventAt;
  const setting = tables.has("app_settings")
    ? await db
        .query("SELECT value FROM app_settings WHERE key='zoom_event_at'")
        .get()
    : null;
  for (const value of [configured, setting?.value]) {
    const date = new Date(value);
    if (value && !Number.isNaN(date.getTime())) dates.add(date.toISOString());
  }
  return dates;
}

export async function legacyAttemptScopes(db, email, ids, tables) {
  const scopes = new Set();
  if (tables.has("campaigns")) {
    for (const row of await db.query("SELECT id FROM campaigns").all()) {
      scopes.add(digest(`campaign-${row.id}:${email}`));
    }
  }
  for (const date of await meetingDates(db, tables)) {
    scopes.add(digest(`zoom-reminder:${date}:${email}`));
    for (const id of ids.get("registrationId") || [])
      scopes.add(digest(`zoom-link:${date}:${id}`));
  }
  for (const table of ["_honker_live", "_honker_dead"].filter((t) =>
    tables.has(t),
  )) {
    for (const job of await db
      .query(`SELECT id,payload FROM ${table} WHERE queue='emails'`)
      .all()) {
      let payload;
      try {
        payload = JSON.parse(job.payload);
      } catch {
        continue;
      }
      if (!payload || typeof payload !== "object") continue;
      if (
        payload.to === email ||
        [...ids].some(([field, values]) => values.has(payload[field]))
      ) {
        scopes.add(digest(`transactional:${job.id}`));
      }
    }
  }
  return scopes;
}

export async function ensureEmailAttemptSubjects(db, hmac = emailHmac) {
  return db.transaction(
    async () => {
      const tables = new Set(
        (
          await db
            .query("SELECT name FROM sqlite_master WHERE type='table'")
            .all()
        ).map((r) => r.name),
      );
      if (!tables.has("email_attempts")) return { backfilled: 0, unmatched: 0 };
      const columns = new Set(
        (await db.query("PRAGMA table_info(email_attempts)").all()).map(
          (c) => c.name,
        ),
      );
      for (const column of ["subject_hmac", "created_at"]) {
        if (!columns.has(column))
          await db.run(`ALTER TABLE email_attempts ADD COLUMN ${column} TEXT`);
      }
      await db.run(
        "CREATE INDEX IF NOT EXISTS idx_email_attempts_subject ON email_attempts (subject_hmac, created_at)",
      );
      const remaining = new Map(
        (
          await db
            .query(
              "SELECT scope,updated_at FROM email_attempts WHERE subject_hmac IS NULL",
            )
            .all()
        ).map((r) => [r.scope, r]),
      );
      if (!remaining.size) {
        await db
          .query(
            "UPDATE email_attempts /* public-neutral */ SET created_at=updated_at WHERE created_at IS NULL",
          )
          .run();
        return { backfilled: 0, unmatched: 0 };
      }
      const marker = "email:attempt-subjects:1";
      if (
        tables.has("app_settings") &&
        (await db.query("SELECT 1 FROM app_settings WHERE key=?").get(marker))
      ) {
        return { backfilled: 0, unmatched: remaining.size };
      }
      let backfilled = 0;
      const bind = async (scope, email, createdAt) => {
        const row = remaining.get(scope);
        if (!row) return;
        const at =
          createdAt && createdAt < row.updated_at ? createdAt : row.updated_at;
        await db
          .query(
            "UPDATE email_attempts /* public-neutral */ SET subject_hmac=?,created_at=COALESCE(created_at,?) WHERE scope=?",
          )
          .run(hmac(email), at, scope);
        remaining.delete(scope);
        backfilled++;
      };
      if (tables.has("mailing_deliveries")) {
        for (const row of await db
          .query("SELECT mailing,email,sent_at FROM mailing_deliveries")
          .all()) {
          const match = /^campaign:(\d+)$/.exec(row.mailing);
          if (match)
            await bind(
              digest(`campaign-${match[1]}:${row.email}`),
              row.email,
              row.sent_at,
            );
        }
      }
      const identities = new Map();
      for (const [table, field] of [
        ["signers", "signerId"],
        ["zoom_registrations", "registrationId"],
        ["zoom_pending", "pendingId"],
        ["deletion_requests", "requestId"],
      ]) {
        if (!tables.has(table)) continue;
        const rows = await db
          .query(`SELECT id,email,created_at FROM ${table}`)
          .all();
        identities.set(field, new Map(rows.map((row) => [row.id, row])));
      }
      if (remaining.size && tables.has("campaigns")) {
        const campaigns = await db.query("SELECT id FROM campaigns").all();
        campaignIdentities: for (const recipients of identities.values()) {
          for (const row of recipients.values()) {
            for (const campaign of campaigns) {
              if (!remaining.size) break campaignIdentities;
              await bind(
                digest(`campaign-${campaign.id}:${row.email}`),
                row.email,
                row.created_at,
              );
            }
          }
        }
      }
      for (const date of await meetingDates(db, tables)) {
        for (const row of identities.get("registrationId")?.values() || []) {
          await bind(
            digest(`zoom-link:${date}:${row.id}`),
            row.email,
            row.created_at,
          );
          await bind(
            digest(`zoom-reminder:${date}:${row.email}`),
            row.email,
            row.created_at,
          );
        }
        if (tables.has("mailing_deliveries")) {
          for (const row of await db
            .query(
              "SELECT email,sent_at FROM mailing_deliveries WHERE mailing='zoom-reminder'",
            )
            .all()) {
            await bind(
              digest(`zoom-reminder:${date}:${row.email}`),
              row.email,
              row.sent_at,
            );
          }
        }
      }
      for (const table of ["_honker_live", "_honker_dead"].filter((t) =>
        tables.has(t),
      )) {
        for (const job of await db
          .query(`SELECT id,payload FROM ${table} WHERE queue='emails'`)
          .all()) {
          let payload;
          try {
            payload = JSON.parse(job.payload);
          } catch {
            continue;
          }
          if (!payload || typeof payload !== "object") continue;
          const subject = [...identities]
            .map(([field, rows]) => rows.get(payload[field]))
            .find(Boolean);
          if (subject)
            await bind(
              digest(`transactional:${job.id}`),
              subject.email,
              subject.created_at,
            );
          else if (typeof payload.to === "string")
            await bind(digest(`transactional:${job.id}`), payload.to);
        }
      }
      await db
        .query(
          "UPDATE email_attempts /* public-neutral */ SET created_at=updated_at WHERE created_at IS NULL",
        )
        .run();
      if (tables.has("app_settings")) {
        await db
          .query(
            "INSERT INTO app_settings /* public-neutral */ (key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
          )
          .run(marker, new Date().toISOString());
      }
      return { backfilled, unmatched: remaining.size };
    },
    { immediate: true },
  );
}
