#!/usr/bin/env bun
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
const dir = mkdtempSync("/tmp/open-letter-delivery-");
const port = 33000 + Math.floor(Math.random() * 10000),
  origin = `http://localhost:${port}`;
const env = {
  ...process.env,
  HONKER_EXTENSION_PATH: new URL("../vendor/libhonker_ext.so", import.meta.url)
    .pathname,
  PUBLISHING_FIXTURE: "1",
  DELIVERY_FIXTURE_DIR: dir,
  DATABASE_PATH: join(dir, "publishing-fixture.db"),
  DATABASE_ENCRYPTION_KEY: "delivery-fixture-db-key",
  BACKUP_ENCRYPTION_KEY: "delivery-fixture-backup-key",
  BACKUP_DIR: join(dir, "backups"),
  ADMIN_PATH: "admin",
  ADMIN_PASSWORD: "delivery-fixture-password",
  ADMIN_JWT_SECRET: "delivery-fixture-admin-secret-with-enough-characters",
  API_TOKEN_SECRET: "delivery-fixture-public-secret-with-enough-characters",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "Fixture <fixture@example.invalid>",
  RESEND_API_KEY: "re_fixture_only",
  SMTP_PASS: "",
  BASE_URL: origin,
  PORT: String(port),
};
let child,
  logs = "";
const post = (path, body, token) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
const messages = () =>
  existsSync(join(dir, "messages.jsonl"))
    ? readFileSync(join(dir, "messages.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out: ${label}\n${logs}`);
}
async function start(jobs) {
  logs = "";
  child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./test/fixtures/publishing-runtime.js",
      "--preload",
      "./test/fixtures/delivery-provider.js",
      "server/index.js",
    ],
    {
      env: {
        ...env,
        HONKER_EXTENSION_PATH: jobs
          ? new URL("../vendor/libhonker_ext.so", import.meta.url).pathname
          : join(dir, "missing.so"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  for (const stream of [child.stdout, child.stderr])
    (async () => {
      for await (const b of stream) logs += new TextDecoder().decode(b);
    })();
  await until(async () => {
    if (child.exitCode != null) throw new Error(logs);
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "listener");
  if (jobs)
    await until(
      async () => (await fetch(`${origin}/api/health`)).ok,
      "readiness",
    );
}
async function stop() {
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await child.exited;
  }
}
async function sql(script) {
  const proc = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import {db} from './db/connection.js';try { const result=await(async()=>{${script}})();console.log(JSON.stringify(result));}finally{await db.close();}`,
    ],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  assert.equal(code, 0, err);
  return JSON.parse(out.trim().split("\n").pop());
}
try {
  await start(false);
  assert.equal((await fetch(`${origin}/api/health`)).status, 503);
  const before = await sql(
    "return await db.query(\"SELECT verification_token FROM signers WHERE email='pending@example.invalid'\").get();",
  );
  for (const [path, body] of [
    [
      "/api/sign",
      { name: "Queue Unavailable", email: "unavailable@example.invalid" },
    ],
    ["/api/resend-verification", { email: "pending@example.invalid" }],
    ["/api/request-deletion", { email: "fixture-0@example.invalid" }],
  ])
    assert.equal((await post(path, body)).status, 503, path);
  assert.equal(
    (
      await sql(
        "return await db.query(\"SELECT COUNT(*) n FROM signers WHERE email='unavailable@example.invalid'\").get();",
      )
    ).n,
    0,
  );
  assert.deepEqual(
    await sql(
      "return await db.query(\"SELECT verification_token FROM signers WHERE email='pending@example.invalid'\").get();",
    ),
    before,
  );
  assert.equal(
    (
      await sql(
        "return await db.query('SELECT COUNT(*) n FROM deletion_requests').get();",
      )
    ).n,
    0,
  );
  await stop();
  await start(true);
  const login = await (
    await post("/api/admin/login", { password: env.ADMIN_PASSWORD })
  ).json();
  assert(login.token);
  const get = (path) =>
    fetch(`${origin}${path}`, {
      headers: { Authorization: `Bearer ${login.token}` },
    });
  assert.equal((await (await get("/api/admin/email")).json()).jobs.ready, true);
  await sql(`
    const {initJobs,enqueue}=await import('./db/jobs.js');
    await initJobs();
    await db.query("INSERT INTO signers(name,email,verified,verification_token,token_expires_at) VALUES (?,?,0,?,?)")
      .run('Current legacy recipient','legacy@example.invalid','legacy-current-token',new Date(Date.now()+3600000).toISOString());
    await enqueue('emails',{kind:'verification',to:'legacy@example.invalid',name:'Obsolete queued name',token:'legacy-current-token',baseUrl:${JSON.stringify(origin)}},{expires:3600});
    return true;
  `);
  await until(
    () =>
      messages().filter((message) => message.to === "legacy@example.invalid")
        .length === 1,
    "legacy job conversion and delivery",
  );
  assert(
    messages()
      .find((message) => message.to === "legacy@example.invalid")
      .html.includes("legacy-current-token"),
  );
  const responses = await Promise.all(
    ["burst-a", "burst-b"].map((n) =>
      post("/api/sign", {
        name: "Burst Fixture",
        email: `${n}@example.invalid`,
        newsletter: true,
        agree: true,
      }),
    ),
  );
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  await until(
    () => messages().filter((m) => m.to.startsWith("burst-")).length === 2,
    "both burst messages",
  );
  const resendEmail = "pending@example.invalid";
  for (let i = 0; i < 2; i++) {
    assert.equal(
      (await post("/api/resend-verification", { email: resendEmail })).status,
      200,
    );
    await until(
      () => messages().filter((m) => m.to === resendEmail).length >= i + 1,
      "resend accepted",
    );
  }
  const current = await sql(
    "return await db.query(\"SELECT verification_token FROM signers WHERE email='pending@example.invalid'\").get();",
  );
  assert(
    messages()
      .filter((m) => m.to === resendEmail)
      .at(-1)
      .html.includes(current.verification_token),
  );
  for (let i = 0; i < 2; i++) {
    assert.equal(
      (
        await post("/api/request-deletion", {
          email: "fixture-0@example.invalid",
        })
      ).status,
      200,
    );
    await until(
      () =>
        messages().filter((m) => m.to === "fixture-0@example.invalid").length >=
        i + 1,
      "replacement deletion message",
    );
  }
  const deletion = await sql(
    "return await db.query(\"SELECT token FROM deletion_requests WHERE email='fixture-0@example.invalid'\").get();",
  );
  assert(
    messages()
      .filter((m) => m.to === "fixture-0@example.invalid")
      .at(-1)
      .html.includes(deletion.token),
  );
  writeFileSync(join(dir, `hold-${resendEmail}`), "");
  assert.equal(
    (await post(`/api/confirm/${current.verification_token}`)).status,
    303,
  );
  await until(
    () => messages().filter((m) => m.to === resendEmail).length === 3,
    "invite submitted",
  );
  const payload = await sql(
    "const rows=await db.query(\"SELECT payload FROM _honker_live WHERE queue='emails'\").all();return rows.map(r=>JSON.parse(r.payload)).find(p=>p.kind==='invite');",
  );
  assert(payload?.messageId && payload.statsToken);
  rmSync(join(dir, `hold-${resendEmail}`));
  await until(
    async () =>
      (
        await sql(
          "return await db.query(\"SELECT COUNT(*) n FROM _honker_live WHERE queue='emails'\").get();",
        )
      ).n === 0,
    "invite acknowledgement",
  );
  await sql(
    `const {initJobs,enqueue}=await import('./db/jobs.js');await initJobs();await enqueue('emails',${JSON.stringify(payload)});return true;`,
  );
  await until(
    async () =>
      (
        await sql(
          "return await db.query(\"SELECT COUNT(*) n FROM _honker_live WHERE queue='emails'\").get();",
        )
      ).n === 0,
    "replayed job acknowledgement",
  );
  assert.equal(messages().filter((m) => m.to === resendEmail).length, 3);
  assert.deepEqual(
    await sql(
      `const q=await import('./server/db.js');return q.getInviteStats(${JSON.stringify(payload.inviteCode)},${JSON.stringify(payload.statsToken)});`,
    ),
    { count: 0 },
  );
  const people = await sql(
    "const out=[];for(let i=0;i<3;i++){const row=await db.query(\"INSERT INTO signers(name,email,verified,newsletter,unsubscribe_token,unsubscribe_token_created_at,created_at) VALUES (?,?,1,1,?,?,?) RETURNING id,email\").get('Campaign Fixture',`race-${i}@example.invalid`,`race-token-${i}`,new Date().toISOString(),new Date(Date.now()+i).toISOString());out.push(row);}return out;",
  );
  const publication = await (await get("/api/admin/publication")).json();
  const templateResponse = await post(
    "/api/admin/templates",
    {
      name: "Delivery fixture",
      subject: "Fixture {{name}}",
      html_body: '<p>{{name}}</p><a href="{{unsubscribeUrl}}">Preferences</a>',
      expectedRevision: publication.revision,
    },
    login.token,
  );
  assert.equal(
    templateResponse.status,
    201,
    await templateResponse.clone().text(),
  );
  const template = await templateResponse.json();
  writeFileSync(join(dir, `hold-${people[0].email}`), "");
  const campaignResponse = await post(
    "/api/admin/campaigns",
    {
      template_id: template.id,
      subject: "Fixture",
      send_now: true,
      audience: "selection",
      recipient_ids: people.map((p) => p.id),
      request_key: crypto.randomUUID(),
    },
    login.token,
  );
  assert.equal(
    campaignResponse.status,
    201,
    await campaignResponse.clone().text(),
  );
  const campaign = await campaignResponse.json();
  await until(
    () => messages().some((m) => m.to === people[0].email),
    "campaign first submission",
  );
  assert.equal(
    (await post("/api/unsubscribe/race-token-1/opt-out")).status,
    200,
  );
  assert.equal(
    (await fetch(`${origin}/api/unsubscribe/race-token-2`)).status,
    200,
  );
  assert.equal(
    (await post("/api/unsubscribe/race-token-2/delete")).status,
    200,
  );
  assert.equal(
    (await post("/api/unsubscribe/race-token-0/delete")).status,
    200,
  );
  rmSync(join(dir, `hold-${people[0].email}`));
  await until(
    async () =>
      (
        await sql(
          `return await db.query('SELECT status FROM campaigns WHERE id=?').get(${campaign.id});`,
        )
      ).status === "sent",
    "campaign completion",
  );
  assert.deepEqual(
    messages()
      .filter((m) => m.to.startsWith("race-"))
      .map((m) => m.to),
    [people[0].email],
  );
  assert.equal(
    (
      await sql(
        "return await db.query(\"SELECT COUNT(*) n FROM mailing_deliveries WHERE email LIKE 'race-%'\").get();",
      )
    ).n,
    0,
  );
  const attempts = await sql(
    "return await db.query(\"SELECT COUNT(*) n FROM email_attempts WHERE subject_hmac IN (SELECT email_hmac FROM erasure_log WHERE kind='erase')\").get();",
  );
  assert.equal(attempts.n, 0);
  const retryPublication = await (await get("/api/admin/publication")).json();
  const added = await post(
    "/api/admin/templates",
    {
      name: "Retry fixture",
      subject: "Retry {{name}}",
      html_body: '<p>{{name}}</p><a href="{{unsubscribeUrl}}">Preferences</a>',
      expectedRevision: retryPublication.revision,
    },
    login.token,
  );
  assert.equal(added.status, 201);
  const retiredTemplate = await added.json();
  const retryPerson = await sql(
    `return await db.query("INSERT INTO signers(name,email,verified,newsletter) VALUES ('Retry fixture','retired-retry@example.invalid',1,1) RETURNING id").get();`,
  );
  const retryResponse = await post(
    "/api/admin/campaigns",
    {
      template_id: retiredTemplate.id,
      subject: "Retired retry",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      audience: "selection",
      recipient_ids: [retryPerson.id],
      request_key: crypto.randomUUID(),
    },
    login.token,
  );
  assert.equal(retryResponse.status, 201);
  const retried = await retryResponse.json();
  await sql(
    `await db.query("UPDATE campaigns SET status='aborted',attempts=5,scheduled_at=? WHERE id=?").run(new Date(Date.now()-3600000).toISOString(),${retried.id});return true;`,
  );
  const beforeRetirement = await (await get("/api/admin/publication")).json();
  const removed = await fetch(
    `${origin}/api/admin/templates/${retiredTemplate.id}`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        Origin: origin,
        Authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({ expectedRevision: beforeRetirement.revision }),
    },
  );
  assert.equal(removed.status, 200);
  const retryReview = await get(`/api/admin/campaigns/${retried.id}/retry`);
  assert.equal(retryReview.status, 200);
  assert.equal((await retryReview.json()).remaining, 1);
  assert.equal(
    (await post(`/api/admin/campaigns/${retried.id}/retry`, {}, login.token))
      .status,
    200,
  );
  await until(
    () =>
      messages().some((mail) => mail.to === "retired-retry@example.invalid"),
    "retired template campaign retry",
  );
  console.log(
    "PASS: real HTTP queue outage gating, burst signup, replacement confirmation/deletion links, durable invite replay, self-service erasure, consent during dispatch, in-flight erasure and retired-template retry review/delivery.",
  );
} finally {
  for (const f of ["pending@example.invalid", "race-0@example.invalid"])
    rmSync(join(dir, `hold-${f}`), { force: true });
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
