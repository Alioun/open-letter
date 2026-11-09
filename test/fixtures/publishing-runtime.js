// Disposable application fixture for publishing verification and documentation shots.
import { readFileSync } from "node:fs";
import letter from "../../config/letters/example/index.js";
if (
  process.env.PUBLISHING_FIXTURE !== "1" ||
  !process.env.DATABASE_PATH?.endsWith("publishing-fixture.db")
)
  throw new Error(
    "Use scripts/verify-publishing.js with its disposable database",
  );
letter.features = {
  ...letter.features,
  zoomEvent: true,
  kreisverbandField: true,
  occupationField: true,
  germanyMap: true,
  stateResolution: true,
  inviteLinks: true,
  multiLanguage: true,
};
letter.languages = ["en", "de"];
letter.zoom = {
  ...letter.zoom,
  eventAt: new Date(Date.now() + 14 * 86400000).toISOString(),
};
const { db } = await import("../../db/connection.js");
await db.run(
  readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"),
);
const { letterTemplates } = await import("../../config/i18n.js");
const { applyDataMigrations } = await import("../../db/data-migrations.js");
await applyDataMigrations(db);
for (const [slug, template] of Object.entries(letterTemplates(letter)))
  await db
    .query(
      "INSERT INTO email_templates(slug,name,subject,html_body) VALUES(?,?,?,?) ON CONFLICT(slug) DO NOTHING",
    )
    .run(slug, template.name, template.subject, template.html_body);
if (!(await db.query("SELECT COUNT(*) AS n FROM signers").get()).n) {
  const names = [
    "Alex Example",
    "Sam Sample",
    "Robin Demo",
    "Jamie Test",
    "Kim Example",
    "Morgan Sample",
  ];
  const areas = [
    ["Berlin-Mitte", "Berlin"],
    ["Hamburg", "Hamburg"],
    ["München", "Bayern"],
    ["Leipzig", "Sachsen"],
    ["Köln", "Nordrhein-Westfalen"],
    ["Hannover", "Niedersachsen"],
  ];
  for (let i = 0; i < 36; i++)
    await db
      .query(
        "INSERT INTO signers(name,email,kreisverband,occupation,state,newsletter,verified,created_at,unsubscribe_token,unsubscribe_token_created_at) VALUES (?,?,?,?,?,1,1,?,?,?)",
      )
      .run(
        names[i % names.length],
        `fixture-${i}@example.invalid`,
        areas[i % areas.length][0],
        ["Teacher", "Researcher", "Designer"][i % 3],
        areas[i % areas.length][1],
        new Date(Date.now() - i * 900000).toISOString(),
        `fixture-self-service-${i}`,
        new Date().toISOString(),
      );
  await db
    .query(
      "INSERT INTO signers(name,email,verified,created_at,verification_token,token_expires_at) VALUES ('Taylor Example','pending@example.invalid',0,?,?,?)",
    )
    .run(
      new Date().toISOString(),
      "fixture-confirmation",
      new Date(Date.now() + 86400000).toISOString(),
    );
}
const original = db.query.bind(db);
db.query = (sql) => {
  if (
    /^\s*SELECT\b/i.test(sql) &&
    (/\bemail_templates\b/.test(sql) ||
      (/\bapp_settings\b/.test(sql) && /copy/.test(sql)))
  )
    process.send?.({ type: "copy-query" });
  return original(sql);
};
