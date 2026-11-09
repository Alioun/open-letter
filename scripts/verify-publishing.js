#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const directory = mkdtempSync(join(tmpdir(), "open-letter-publishing-"));
const port = Number(
  process.env.PUBLISHING_PORT || 32000 + Math.floor(Math.random() * 10000),
);
const origin = `http://localhost:${port}`;
const serve = process.argv.includes("--serve");
const env = {
  ...process.env,
  PUBLISHING_FIXTURE: "1",
  DATABASE_PATH: join(directory, "publishing-fixture.db"),
  DATABASE_ENCRYPTION_KEY: "publishing-fixture-encryption-only",
  BACKUP_ENCRYPTION_KEY: "publishing-fixture-backup-only",
  BACKUP_DIR: join(directory, "backups"),
  ADMIN_PATH: "admin",
  ADMIN_PASSWORD: "publishing-fixture-password",
  ADMIN_JWT_SECRET: "publishing-fixture-admin-secret-with-enough-characters",
  API_TOKEN_SECRET: "publishing-fixture-api-secret-with-enough-characters",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "",
  SMTP_PASS: "",
  BASE_URL: origin,
  PORT: String(port),
  HONKER_EXTENSION_PATH: new URL("../vendor/libhonker_ext.so", import.meta.url)
    .pathname,
};
let copyQueries = 0;
let child;
let logs = "";
async function start() {
  child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./test/fixtures/publishing-runtime.js",
      "server/index.js",
    ],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
      ipc(message) {
        if (message.type === "copy-query") copyQueries++;
      },
    },
  );
  logs = "";
  for (const stream of [child.stdout, child.stderr])
    (async () => {
      for await (const bytes of stream) logs += new TextDecoder().decode(bytes);
    })();
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (child.exitCode != null) throw new Error(`Fixture stopped: ${logs}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`Fixture did not start: ${logs}`);
}
async function stop() {
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await child.exited;
  }
}
async function fixtureDatabase(script) {
  const command = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import { db } from './db/connection.js'; try { ${script} } finally { await db.close(); }`,
    ],
    { env, stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ]);
  assert.equal(code, 0, errors);
  return output.trim() ? JSON.parse(output.trim()) : null;
}
try {
  await start();
  assert.match(
    await (await fetch(`${origin}/admin`)).text(),
    /<html lang="de">/,
    "German administration declares its own language independently of public content",
  );
  const login = await (
    await fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    })
  ).json();
  assert(login.token, "fixture authentication");
  const request = (path, options = {}) =>
    fetch(`${origin}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${login.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...(options.body &&
      typeof options.body !== "string" &&
      !Buffer.isBuffer(options.body)
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  const publication = await (await request("/api/admin/publication")).json();
  const meeting = await (await request("/api/admin/zoom-mailings")).json();
  const meetingInput = {
    eventAt: meeting.eventAt,
    zoomLink: meeting.link,
    linkOffsetHours: meeting.linkOffsetHours,
    reminderOffsetHours: meeting.reminderOffsetHours,
    durationMin: meeting.durationMin,
    mode: meeting.mode,
    showDelegierter: meeting.showDelegierter,
    locationName: meeting.location.name,
    locationAddress: meeting.location.address,
    locationMapsUrl: meeting.location.mapsUrl,
  };
  assert.equal(
    (
      await request("/api/admin/zoom-settings", {
        method: "POST",
        body: meetingInput,
      })
    ).status,
    400,
    "meeting updates require a loaded revision",
  );
  const meetingSave = await request("/api/admin/zoom-settings", {
    method: "POST",
    body: { ...meetingInput, expectedRevision: meeting.revision },
  });
  assert.equal(meetingSave.status, 200);
  const savedMeeting = await meetingSave.json();
  assert.equal(savedMeeting.revision, meeting.revision + 1);
  assert.equal(
    savedMeeting.eventAt,
    meeting.eventAt,
    "unrelated meeting edits preserve the exact event timestamp",
  );
  assert.equal(
    savedMeeting.mailingsReset,
    false,
    "unrelated meeting edits preserve delivery tracking",
  );
  assert.equal(
    (
      await request("/api/admin/zoom-settings", {
        method: "POST",
        body: {
          ...meetingInput,
          expectedRevision: meeting.revision,
          durationMin: 123,
        },
      })
    ).status,
    409,
    "stale meeting edits cannot overwrite the saved event",
  );
  assert.equal(
    (await (await request("/api/admin/zoom-mailings")).json()).durationMin,
    meeting.durationMin,
  );
  const operational = publication.document.templates.find(
    (template) => template.slug === "verification",
  );
  assert(operational, "fixture includes operational confirmation template");
  const invalidCampaign = await request("/api/admin/campaigns", {
    method: "POST",
    body: {
      request_key: crypto.randomUUID(),
      template_id: operational.id,
      subject: "Must not be broadcast",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(
    invalidCampaign.status,
    400,
    "server rejects operational templates in broadcasts",
  );
  assert.match((await invalidCampaign.json()).error, /Newsletter-Vorlage/);
  const newsletter = publication.document.templates.find(
    (t) => !/^(verification|already|deletion|invite|zoom|treffen)/.test(t.slug),
  );
  assert(newsletter, "fixture includes newsletter template");
  const retryId = await fixtureDatabase(`
    const campaign = await db.query("INSERT INTO campaigns(template_id,subject,i18n,scheduled_at,status,created_at) VALUES (?, ?, ?, ?, 'aborted', ?) RETURNING id").get(
      ${newsletter.id}, 'Saved retry subject', JSON.stringify({ de: { subject: 'Gespeicherter DE-Betreff' } }), new Date().toISOString(), new Date().toISOString());
    await db.query("UPDATE signers SET lang='de' WHERE email='fixture-1@example.invalid'").run();
    await db.query("INSERT INTO mailing_deliveries(mailing,email,sent_at) VALUES (?, 'fixture-0@example.invalid', ?)").run('campaign:'+campaign.id,new Date().toISOString());
    console.log(JSON.stringify(campaign.id));
  `);
  try {
    const firstReview = await (
      await request(`/api/admin/campaigns/${retryId}/retry`)
    ).json();
    assert.equal(firstReview.eligible, 36);
    assert.equal(firstReview.alreadyAccepted, 1);
    assert.equal(firstReview.remaining, 35);
    assert.deepEqual(
      firstReview.versions.map((version) => [
        version.language,
        version.count,
        version.subject,
      ]),
      [
        ["en", 34, "Saved retry subject"],
        ["de", 1, "Gespeicherter DE-Betreff"],
      ],
    );
    await fixtureDatabase(
      "await db.query(\"UPDATE signers SET newsletter=0 WHERE email='fixture-2@example.invalid'\").run();",
    );
    const nextReview = await (
      await request(`/api/admin/campaigns/${retryId}/retry`)
    ).json();
    assert.equal(nextReview.eligible, 35);
    assert.equal(nextReview.remaining, 34);
    assert.equal(
      (await (await request("/api/admin/campaigns")).json()).find(
        (c) => c.id === retryId,
      ).status,
      "aborted",
      "reading retry approval cannot start delivery",
    );
  } finally {
    await fixtureDatabase(`
      await db.query("DELETE FROM mailing_deliveries WHERE mailing=?").run('campaign:'+${retryId});
      await db.query("DELETE FROM campaigns WHERE id=?").run(${retryId});
      await db.query("UPDATE signers SET lang=NULL WHERE email='fixture-1@example.invalid'").run();
      await db.query("UPDATE signers SET newsletter=1 WHERE email='fixture-2@example.invalid'").run();
    `);
  }
  const pastCampaign = await request("/api/admin/campaigns", {
    method: "POST",
    body: {
      template_id: newsletter.id,
      request_key: crypto.randomUUID(),
      subject: "Past schedule must be rejected",
      scheduled_at: new Date(Date.now() - 3600000).toISOString(),
    },
  });
  assert.equal(pastCampaign.status, 400);
  assert.match((await pastCampaign.json()).error, /zukünftigen Versandtermin/);
  const templatePreview = await request("/api/admin/preview", {
    method: "POST",
    body: {
      template_id: operational.id,
      subject: "Hello {{firstName}} · {{signerCount}} signatories",
    },
  });
  assert.equal(templatePreview.status, 200);
  const previewData = await templatePreview.json();
  assert.equal(previewData.subject, "Hello Ada · 1.000 signatories");
  const templateHtml = previewData.html;
  assert(templateHtml.includes("https://preview.invalid/confirm/example"));
  assert(!templateHtml.includes('href=""'));
  assert.match(templateHtml, /valid for \d+ hours/);
  const translated = structuredClone(publication.document);
  const translation = {
    ...operational,
    id: Math.max(...translated.templates.map((t) => t.id)) + 1,
    slug: `${operational.slug}.de`,
    name: `${operational.name} (DE)`,
  };
  translated.templates.push(translation);
  const translationImport = (document) =>
    request("/api/admin/publication/import", {
      method: "POST",
      body: {
        document,
        base: publication.document,
        revision: publication.revision,
      },
    });
  assert.equal(
    (await translationImport(translated)).status,
    200,
    "system translation can be created in admin",
  );
  translation.html_body = "<p>Missing required confirmation link</p>";
  assert.equal(
    (await translationImport(translated)).status,
    400,
    "new translations retain protected operational links",
  );
  const importedDraft = await request("/api/admin/publication/import", {
    method: "POST",
    body: {
      document: publication.document,
      base: publication.document,
      revision: publication.revision,
    },
  });
  assert.equal(importedDraft.status, 200);
  assert.deepEqual((await importedDraft.json()).document, publication.document);
  assert.equal(
    (await (await request("/api/admin/publication")).json()).revision,
    publication.revision,
    "import validation does not publish",
  );
  assert.equal(
    (
      await request("/api/admin/publication/import", {
        method: "POST",
        body: {
          document: { ...publication.document, layout: { content: [] } },
          revision: publication.revision,
        },
      })
    ).status,
    400,
  );
  const alex = (
    await (await request("/api/admin/newsletter-signers?search=Alex")).json()
  ).signers.find((person) => person.name === "Alex Example");
  const selection = await request(
    "/api/admin/newsletter-selection?search=Sam",
    { method: "POST", body: { ids: [alex.id] } },
  );
  assert.equal(selection.status, 200);
  const selected = await selection.json();
  assert.equal(selected.total, 1);
  assert.equal(selected.outsideFilter, 1);
  assert.equal(selected.signers[0].name, "Alex Example");
  const oldHtml = await (await fetch(origin)).text();
  const oldAsset = oldHtml.match(/property="og:image" content="([^"]+)"/)[1];
  const before = copyQueries;
  for (const path of [
    "/",
    "/de/",
    "/api/boot",
    "/api/confirm/fixture-confirmation",
    "/abmelden/fixture-self-service-0",
  ])
    assert((await fetch(`${origin}${path}`)).ok, path);
  await Bun.sleep(30);
  assert.equal(
    copyQueries,
    before,
    "visitors perform no copy/template queries",
  );
  assert.equal(
    "copy" in (await (await fetch(`${origin}/api/boot`)).json()),
    false,
  );
  assert.match(await (await fetch(`${origin}/de/`)).text(), /<html lang="de"/);
  const next = structuredClone(publication.document);
  next.locales.en.copy.navCta = "Published instantly";
  next.metadata.en.title = "New publication title";
  next.metadata.en.imageText = "Immediate social image gjpqy";
  next.appearance.css = '[data-section="hero"] { outline-color: var(--rot); }';
  const result = await request("/api/admin/publication", {
    method: "PUT",
    body: { document: next, expectedRevision: publication.revision },
  });
  assert.equal(result.status, 200, await result.clone().text());
  const published = await result.json();
  const html = await (await fetch(origin)).text();
  assert(html.includes("Published instantly"));
  assert(html.includes("New publication title"));
  const newAsset = html.match(/property="og:image" content="([^"]+)"/)[1];
  assert.notEqual(newAsset, oldAsset);
  assert((await fetch(oldAsset)).ok);
  assert((await fetch(newAsset)).ok);
  assert.equal(
    (
      await request("/api/admin/publication", {
        method: "PUT",
        body: { document: next, expectedRevision: publication.revision },
      })
    ).status,
    409,
  );
  const unsafe = structuredClone(next);
  unsafe.appearance.css = '@import "https://outside.invalid/style.css";';
  assert.equal(
    (
      await request("/api/admin/publication", {
        method: "PUT",
        body: { document: unsafe, expectedRevision: published.revision },
      })
    ).status,
    400,
  );
  const preview = await (
    await request("/api/admin/publication/preview", {
      method: "POST",
      body: { document: next, lang: "de", pageState: "campaign" },
    })
  ).text();
  assert(preview.includes("connect-src 'none'"));
  assert(preview.includes("form-action 'none'"));
  assert(preview.includes('lang="de"'));
  const script = html.match(/type="module" src="([^"]+)"/)[1];
  const publicBundle = await (await fetch(origin + script)).text();
  assert(
    !/@puckeditor|PuckEditor|codemirror|CssEditor|AdminPublisher|TemplatesField/.test(
      publicBundle,
    ),
    "editors stay outside the public bundle",
  );
  await stop();
  await start();
  const persisted = await (await request("/api/admin/publication")).json();
  assert.equal(persisted.revision, published.revision);
  assert.equal(
    persisted.document.locales.en.copy.navCta,
    "Published instantly",
  );
  assert((await fetch(oldAsset)).ok);
  console.log(
    "PASS: publishing, revisions, invalid CSS, metadata, immutable assets, isolated preview, restart, and zero visitor copy/template queries",
  );
  if (serve) {
    const reset = await request("/api/admin/publication", {
      method: "PUT",
      body: {
        document: publication.document,
        expectedRevision: persisted.revision,
      },
    });
    assert.equal(
      reset.status,
      200,
      "restore original example copy for screenshots",
    );
    console.log(
      `Documentation fixture: ${origin} · /admin · password ${env.ADMIN_PASSWORD}`,
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
