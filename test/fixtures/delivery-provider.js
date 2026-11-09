import { appendFileSync, existsSync } from "node:fs";
const dir = process.env.DELIVERY_FIXTURE_DIR;
if (
  !dir?.startsWith("/tmp/open-letter-delivery-") ||
  !process.env.DATABASE_PATH?.startsWith(dir)
)
  throw new Error("Delivery provider stub requires an isolated fixture");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input?.url || input));
  if (url.origin === "https://api.resend.com") {
    const body = JSON.parse(init.body || "{}");
    const to = Array.isArray(body.to) ? body.to[0] : body.to;
    appendFileSync(
      `${dir}/messages.jsonl`,
      JSON.stringify({
        to,
        html: body.html,
        subject: body.subject,
        idempotencyKey: init.headers?.["Idempotency-Key"],
      }) + "\n",
    );
    while (existsSync(`${dir}/hold-${to}`)) await Bun.sleep(20);
    return Response.json({ id: crypto.randomUUID() });
  }
  if (["localhost", "127.0.0.1"].includes(url.hostname))
    return realFetch(input, init);
  throw new Error(
    `External fetch blocked in delivery fixture: ${url.hostname}`,
  );
};
