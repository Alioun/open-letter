import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./connection.js";
import cfg from "../config/letter.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default transactional templates seeded from the active letter config. Existing
// rows are left untouched (ON CONFLICT DO NOTHING), so admin edits are preserved.
const templates = Object.entries(cfg.email.templates).map(([slug, t]) => ({
  slug,
  name: t.name,
  subject: t.subject,
  htmlBody: t.htmlBody,
}));


try {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await db.run(schema);
  const insert = db.query(
    `INSERT INTO email_templates (slug, name, subject, html_body)
     VALUES (?, ?, ?, ?) ON CONFLICT (slug) DO NOTHING`,
  );
  for (const template of templates) {
    await insert.run(
      template.slug,
      template.name,
      template.subject,
      template.htmlBody,
    );
  }
  console.log("Database schema applied successfully.");
} catch (err) {
  console.error("Failed to apply database schema:", err.message);
  process.exit(1);
} finally {
  await db.close();
}
