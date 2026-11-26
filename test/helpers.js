// Shared test helpers: per-test DB reset + fixture builders.
import { db } from "../db/connection.js";

const APP_TABLES = [
  "signers",
  "campaigns",
  "email_templates",
  "zoom_registrations",
  "deletion_requests",
  "zoom_pending",
  "erasure_log",
  "zoom_event_mailings",
  "app_settings",
  "kv_state_cache",
  "kv_not_typo",
  "occupation_not_typo",
  "admin_merges",
  "admin_actions",
  "mailing_deliveries",
];

// Honker tables exist only after initJobs() has run.
const HONKER_TABLES = [
  "_honker_live",
  "_honker_dead",
  "_honker_scheduler_tasks",
  "_honker_results",
  "_honker_locks",
];

export async function resetDb() {
  for (const t of [...APP_TABLES, ...HONKER_TABLES]) {
    try {
      await db.run(`DELETE FROM ${t}`);
    } catch {
      // table not created yet (e.g. honker tables before initJobs)
    }
  }
}

const isoNow = () => new Date().toISOString();
const isoAgoDays = (d) => new Date(Date.now() - d * 86400_000).toISOString();
export { isoNow, isoAgoDays };

let emailSeq = 0;
function uniqueEmail(prefix = "u") {
  return `${prefix}${++emailSeq}-${Date.now()}@example.org`;
}

// Insert a verified signer directly (full control over verified/state/created_at).
// show_signer_details is the signer's own choice to show role, organisation
// and region with the name; unset means they were never asked.
export async function addVerifiedSigner(overrides = {}) {
  const s = {
    name: "Anna Schmidt",
    email: uniqueEmail("s"),
    kreisverband: "Berlin-Mitte",
    occupation: "Lehrerin",
    signer_function: "",
    state: "",
    newsletter: 1,
    show_publicly: 1,
    show_signer_details: null,
    created_at: isoNow(),
    ...overrides,
  };
  const row = await db
    .query(
      `INSERT INTO signers
        (name, email, kreisverband, occupation, signer_function, state, newsletter, show_publicly, show_signer_details, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       RETURNING id`,
    )
    .get(
      s.name,
      s.email,
      s.kreisverband,
      s.occupation,
      s.signer_function,
      s.state,
      s.newsletter ? 1 : 0,
      s.show_publicly ? 1 : 0,
      s.show_signer_details === null ? null : s.show_signer_details ? 1 : 0,
      s.created_at,
    );
  return { id: row.id, ...s };
}

export async function addZoomRegistration(overrides = {}) {
  const z = {
    name: "Zoom Person",
    email: uniqueEmail("z"),
    kreisverband: "Berlin-Mitte",
    delegierter: 0,
    created_at: isoNow(),
    ...overrides,
  };
  const row = await db
    .query(
      `INSERT INTO zoom_registrations (name, email, kreisverband, delegierter, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(z.name, z.email, z.kreisverband, z.delegierter ? 1 : 0, z.created_at);
  return { id: row.id, ...z };
}

let slugSeq = 0;
export async function addTemplate(overrides = {}) {
  const t = {
    slug: `tpl-${++slugSeq}-${Date.now()}`,
    name: "Test Template",
    subject: "Subject {{name}}",
    html_body: "<p>Hi {{name}}</p>",
    ...overrides,
  };
  const row = await db
    .query(
      `INSERT INTO email_templates (slug, name, subject, html_body)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(t.slug, t.name, t.subject, t.html_body);
  return { id: row.id, ...t };
}

// Give a signer an unsubscribe token created `ageDays` ago.
export async function setUnsubToken(signerId, token, ageDays = 0) {
  await db
    .query(
      `UPDATE signers SET unsubscribe_token = ?, unsubscribe_token_created_at = ? WHERE id = ?`,
    )
    .run(token, isoAgoDays(ageDays), signerId);
  return token;
}

export { db };
