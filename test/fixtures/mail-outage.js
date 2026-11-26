// Preload for the HTTP test of a mail outage: the example letter with a
// confirmation link that is valid for one hour while a queued mail is kept
// for a day, and a mail service that refuses every mail while the file
// `down` exists in MAIL_FIXTURE_DIR. Mails it takes go to `messages.jsonl`.
// While the file `fail-window` exists there, the next write that starts a
// link's time fails, once, and removes the file.
import { appendFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import letter from "../../config/letters/example/index.js";

const dir = process.env.MAIL_FIXTURE_DIR;
if (!dir?.startsWith("/tmp/"))
  throw new Error("Only for the HTTP test fixture");
letter.privacy = {
  ...letter.privacy,
  confirmationLinkHours: 1,
  emailJobRetentionHours: 24,
};

const otherFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input?.url || input));
  if (url.origin !== "https://api.resend.com") return otherFetch(input, init);
  const body = JSON.parse(init.body || "{}");
  const to = Array.isArray(body.to) ? body.to[0] : body.to;
  if (existsSync(join(dir, "down"))) {
    appendFileSync(join(dir, "refused.jsonl"), JSON.stringify({ to }) + "\n");
    return Response.json({}, { status: 503 });
  }
  appendFileSync(
    join(dir, "messages.jsonl"),
    JSON.stringify({ to, html: body.html }) + "\n",
  );
  return Response.json({ id: crypto.randomUUID() });
};

const { db } = await import("../../db/connection.js");
const query = db.query;
db.query = (sql) => {
  const statement = query(sql);
  if (!/UPDATE signers[^;]*SET token_expires_at = \?/.test(sql))
    return statement;
  return {
    ...statement,
    run(...params) {
      const flag = join(dir, "fail-window");
      if (!existsSync(flag)) return statement.run(...params);
      rmSync(flag);
      return Promise.reject(new Error("disk I/O error (fixture)"));
    },
  };
};
