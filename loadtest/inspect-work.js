import { statSync } from "node:fs";
import { db, DB_PATH } from "../db/connection.js";

try {
  const count = async (sql) => (await db.query(sql).get()).n;
  console.log(
    JSON.stringify({
      signers: await count("SELECT COUNT(*) n FROM signers"),
      newSigners: await count(
        "SELECT COUNT(*) n FROM signers WHERE email LIKE 'lt-%@load.test'",
      ),
      pending: await count(
        "SELECT COUNT(*) n FROM _honker_live WHERE queue='emails'",
      ),
      dead: await count(
        "SELECT COUNT(*) n FROM _honker_dead WHERE queue='emails'",
      ),
      attempts: await db
        .query("SELECT status,COUNT(*) n FROM email_attempts GROUP BY status")
        .all(),
      campaigns: await db
        .query(
          "SELECT id,status,sent_offset AS sent_count,recipient_count FROM campaigns",
        )
        .all(),
      recipients: (
        await db
          .query(
            "SELECT id FROM signers WHERE verified=1 AND newsletter=1 ORDER BY id LIMIT 10",
          )
          .all()
      ).map((r) => r.id),
      templateId: (
        await db
          .query(
            "SELECT id FROM email_templates WHERE slug='open-letter-update' LIMIT 1",
          )
          .get()
      )?.id,
      databaseBytes: statSync(DB_PATH).size,
    }),
  );
} finally {
  await db.close();
}
