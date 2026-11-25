// What a caller of the running server sees on the admin routes. Each server
// trusts X-Forwarded-For, so a test picks the address it comes from the way
// the reverse proxy would report it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  startAdminServer,
  ADMIN_PATH,
  ADMIN_PASSWORD,
} from "./fixtures/admin-server.js";

const BOOT_TIMEOUT = 120_000;
const HEALTH_TOKEN = "http-fixture-health-token";
const from = (address) => ({ "x-forwarded-for": address });
const wrongPassword = (server, headers) =>
  server.request("/api/admin/login", {
    method: "POST",
    headers,
    body: { password: "not-the-password" },
  });

describe("admin routes on a working server", () => {
  let server;
  let token;
  beforeAll(async () => {
    server = await startAdminServer({
      env: { TRUST_PROXY: "true", HEALTH_TOKEN },
    });
    token = await server.login(from("203.0.113.1"));
  }, BOOT_TIMEOUT);
  afterAll(() => server?.stop());

  test("crawlers are not told where the admin lives, and may not index it", async () => {
    const robots = await (await server.request("/robots.txt")).text();
    expect(robots).toContain("Disallow: /api/");
    expect(robots).not.toContain(ADMIN_PATH);

    const page = await server.request(`/${ADMIN_PATH}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
  });

  test("headers a client can set do not get it past the login limit", async () => {
    const statuses = [];
    let last;
    for (let attempt = 0; attempt < 6; attempt++) {
      last = await wrongPassword(server, {
        "x-real-ip": `10.0.0.${attempt}`,
        "x-forwarded-for": `10.1.0.${attempt}, 203.0.113.2`,
      });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await last.json()).error).toBe("Zu viele Anmeldeversuche.");
    // The limit follows the address, not the server: someone else signs in.
    expect((await wrongPassword(server, from("203.0.113.3"))).status).toBe(401);
  });

  test("a failed sign-in is logged with its address and without what was typed", async () => {
    expect((await wrongPassword(server, from("203.0.113.40"))).status).toBe(
      401,
    );
    expect(server.logs()).toContain("[admin] failed login from 203.0.113.40");
    expect(server.logs()).not.toContain("not-the-password");
    expect(server.logs()).not.toContain("failed login from 203.0.113.1\n");
  });

  test("a monitor learns that mail cannot go out, and numbers only with the token", async () => {
    const health = (headers) =>
      server.request("/api/health/operations", {
        headers: { ...from("203.0.113.41"), ...headers },
      });
    const open = await health();
    // The fixture has no mail profile, which is exactly what should alert.
    expect(open.status).toBe(503);
    expect(await open.json()).toEqual({
      ok: false,
      checks: {
        app: "ok",
        mail: "not-ready",
        mailQueue: "ok",
        backup: "ok",
      },
    });

    const detailed = await health({
      authorization: `Bearer ${HEALTH_TOKEN}`,
    });
    expect(detailed.status).toBe(503);
    const { details } = await detailed.json();
    expect(Object.keys(details).sort()).toEqual([
      "failedMails",
      "lastBackupAgeHours",
      "lastBackupAt",
      "lastBackupFailedAt",
      "lastMailAcceptedAt",
      "queuedMails",
    ]);
    expect(details).toMatchObject({ failedMails: 0, lastBackupFailedAt: null });

    expect((await health({ authorization: "Bearer guessed" })).status).toBe(
      401,
    );
    // The container's own check does not care about mail.
    expect((await server.request("/api/health")).status).toBe(200);
  });

  test("a body that is not a JSON object is a bad request, not a crash", async () => {
    for (const body of ["null", "[]", '"text"', "{"]) {
      const login = await server.request("/api/admin/login", {
        method: "POST",
        headers: from("203.0.113.4"),
        body,
      });
      expect([body, login.status]).toEqual([body, 400]);
    }
    for (const [path, method] of [
      ["/api/admin/signers/unblock", "POST"],
      ["/api/admin/email", "POST"],
      ["/api/admin/email/dns", "POST"],
      ["/api/admin/statistics", "PUT"],
      ["/api/admin/templates/1", "DELETE"],
    ]) {
      const response = await server.request(path, {
        method,
        token,
        body: "null",
      });
      expect([path, response.status]).toEqual([path, 400]);
    }
  });

  test("the email setup route refuses a body over the limit", async () => {
    const response = await server.request("/api/admin/email", {
      method: "POST",
      token,
      body: { action: "save", padding: "x".repeat(200_000) },
    });
    expect(response.status).toBe(413);
  });

  test("the DNS check keeps one ownership token per domain, however it is spelled", async () => {
    const check = (domain) =>
      server.request("/api/admin/email/dns", {
        method: "POST",
        token,
        body: { domain },
      });
    expect((await check("Fixture-Domain.INVALID")).status).toBe(200);
    expect((await check("fixture-domain.invalid")).status).toBe(200);
    expect((await check("not a domain")).status).toBe(400);
    const keys = await server.sql((db) =>
      db
        .query("SELECT key FROM app_settings WHERE key LIKE 'mailbox-dns:%'")
        .all(),
    );
    expect(keys).toEqual([{ key: "mailbox-dns:fixture-domain.invalid" }]);
  });

  test("an image upload over 8 MB is refused even without a declared length", async () => {
    const response = await fetch(
      `${server.origin}/api/admin/publication/assets`,
      {
        keepalive: false,
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: new ReadableStream({
          start(controller) {
            for (let chunk = 0; chunk < 9; chunk++)
              controller.enqueue(new Uint8Array(1024 * 1024));
            controller.close();
          },
        }),
      },
    );
    expect(response.status).toBe(413);
  });

  test("a template still due to be sent cannot be removed, by either route", async () => {
    const publication = async () =>
      (await server.request("/api/admin/publication", { token })).json();
    const { revision } = await publication();
    const created = await server.request("/api/admin/templates", {
      method: "POST",
      token,
      body: {
        name: "Rundbrief",
        subject: "Neues vom Brief",
        html_body:
          '<p>Hallo {{name}}</p><p><a href="{{unsubscribeUrl}}">x</a></p>',
        expectedRevision: revision,
      },
    });
    expect(created.status).toBe(201);
    const template = await created.json();
    const scheduled = await server.request("/api/admin/campaigns", {
      method: "POST",
      token,
      body: {
        template_id: template.id,
        subject: "Einladung zur Kundgebung",
        scheduled_at: new Date(Date.now() + 86400_000).toISOString(),
        audience: "newsletter",
        request_key: crypto.randomUUID(),
      },
    });
    expect(scheduled.status).toBe(201);
    const campaign = await scheduled.json();

    const refused = await server.request(
      `/api/admin/templates/${template.id}`,
      {
        method: "DELETE",
        token,
        body: { expectedRevision: template.revision },
      },
    );
    expect(refused.status).toBe(409);
    const reason = (await refused.json()).error;
    expect(reason).toContain(`#${campaign.id}`);
    expect(reason).toContain("Einladung zur Kundgebung");

    const current = await publication();
    const without = structuredClone(current.document);
    without.templates = without.templates.filter((t) => t.id !== template.id);
    const published = await server.request("/api/admin/publication", {
      method: "PUT",
      token,
      body: { document: without, expectedRevision: current.revision },
    });
    expect(published.status).toBe(409);
    const answer = await published.json();
    expect(answer.error).toContain(`#${campaign.id}`);
    // A stale edit is the other 409 here; only that one carries a revision.
    expect(answer.revision).toBeUndefined();

    await server.request(`/api/admin/campaigns/${campaign.id}`, {
      method: "DELETE",
      token,
    });
    const removed = await server.request(
      `/api/admin/templates/${template.id}`,
      {
        method: "DELETE",
        token,
        body: { expectedRevision: template.revision },
      },
    );
    expect(removed.status).toBe(200);
  });

  test("a send between tries is stopped once, and the log says how far it got", async () => {
    const now = new Date().toISOString();
    const { id } = await server.sql((database) =>
      database
        .query(
          `INSERT INTO campaigns
             (subject, scheduled_at, status, attempts, heartbeat_at, sent_offset, delivery_expires_at)
           VALUES ('Halb gesendet', ?, 'failed', 1, ?, 2, ?) RETURNING id`,
        )
        .get(now, now, new Date(Date.now() + 86400_000).toISOString()),
    );
    await server.sql((database) =>
      database
        .query(
          `INSERT INTO mailing_deliveries (mailing, email, sent_at)
           VALUES (?, 'a@example.org', ?), (?, 'b@example.org', ?)`,
        )
        .run(`campaign:${id}`, now, `campaign:${id}`, now),
    );
    const stop = () =>
      server.request(`/api/admin/campaigns/${id}/stop`, {
        method: "POST",
        token,
      });
    const stopped = await stop();
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ ok: true, reached: 2 });
    const listed = await (
      await server.request("/api/admin/campaigns", { token })
    ).json();
    expect(listed.find((campaign) => campaign.id === id)).toMatchObject({
      status: "aborted",
      failure: { category: "stopped-by-admin" },
    });

    const again = await stop();
    expect(again.status).toBe(409);
    expect((await again.json()).error).toContain("läuft nicht mehr");
    const log = await (
      await server.request("/api/admin/actions", { token })
    ).json();
    expect(
      log.actions.filter((entry) => entry.action === "campaign.stop"),
    ).toMatchObject([{ targetId: id, count: 2 }]);
  });

  test("a merge is validated like a sign-up and can be taken back", async () => {
    const ids = await server.sql(async (db) => {
      const out = [];
      for (const [email, occupation] of [
        ["a@example.org", "Lehrerin"],
        ["b@example.org", "Lehrerin"],
        ["c@example.org", "Lehrer*in"],
      ])
        out.push(
          (
            await db
              .query(
                "INSERT INTO signers (name, email, occupation, verified) VALUES ('Person', ?, ?, 1) RETURNING id",
              )
              .get(email, occupation)
          ).id,
        );
      return out;
    });
    const merge = (body) =>
      server.request("/api/admin/merge-occupation", {
        method: "POST",
        token,
        body,
      });
    expect(
      (await merge({ from: "Lehrerin", to: "x".repeat(5000) })).status,
    ).toBe(400);
    expect(
      (await merge({ from: "Lehrerin", to: "<b>Lehrer*in</b>" })).status,
    ).toBe(400);

    const merged = await merge({ from: "Lehrerin", to: "Lehrer*in" });
    expect(merged.status).toBe(200);
    const { updated, undoId } = await merged.json();
    expect(updated).toBe(2);

    const occupations = () =>
      server.sql((db) =>
        db
          .query(
            `SELECT occupation FROM signers WHERE id IN (${ids.join(",")}) ORDER BY id`,
          )
          .all(),
      );
    expect((await occupations()).map((row) => row.occupation)).toEqual([
      "Lehrer*in",
      "Lehrer*in",
      "Lehrer*in",
    ]);

    const undo = () =>
      server.request(`/api/admin/merges/${undoId}/undo`, {
        method: "POST",
        token,
      });
    const undone = await undo();
    expect(undone.status).toBe(200);
    expect((await undone.json()).restored).toBe(2);
    expect((await occupations()).map((row) => row.occupation)).toEqual([
      "Lehrerin",
      "Lehrerin",
      "Lehrer*in",
    ]);
    expect((await undo()).status).toBe(409);
  });

  test("without a public meeting nobody can register, but the team can still manage the meeting", async () => {
    expect((await server.request("/api/zoom-count")).status).toBe(404);
    expect(
      (await server.request("/api/admin/zoom-registrations", { token })).status,
    ).toBe(200);
  });

  test("the start page counts today's signatures and links about to expire", async () => {
    const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
    await server.sql(async (db) => {
      await db.run("DELETE FROM signers");
      const insert = db.query(
        `INSERT INTO signers (name, email, verified, token_expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      await insert.run("Heute", "today@example.org", 1, null, hours(-1));
      await insert.run("Gestern", "old@example.org", 1, null, hours(-30));
      await insert.run("Bald", "soon@example.org", 0, hours(2), hours(-20));
      await insert.run("Später", "later@example.org", 0, hours(20), hours(-4));
      await insert.run(
        "Abgelaufen",
        "gone@example.org",
        0,
        hours(-1),
        hours(-30),
      );
    });
    const read = (query = "") =>
      server.request(`/api/admin/overview${query}`, { token });
    const since = encodeURIComponent(hours(-6));
    const { expiredUnmailed, ...activity } = await (
      await read(`?since=${since}`)
    ).json();
    expect(activity).toEqual({
      signedSince: 1,
      pending: 2,
      pendingExpiringSoon: 1,
    });
    // The five-minute cleanup may have taken "Abgelaufen" by now: no mail ever
    // went to it, so it then counts as lost.
    expect(expiredUnmailed.days).toBe(30);
    expect([0, 1]).toContain(expiredUnmailed.count);
    expect((await read("?since=gestern")).status).toBe(400);
  });

  test("the backup state can be read", async () => {
    const response = await server.request("/api/admin/backup", { token });
    expect(response.status).toBe(200);
    const state = await response.json();
    // The hourly job may or may not have run by now.
    expect(Object.keys(state).sort()).toEqual([
      "expiredRestorePoint",
      "lastError",
      "lastErrorAt",
      "lastSuccessAt",
      "lastSuccessBytes",
      "retentionHours",
    ]);
    expect(state).toMatchObject({ lastError: null, retentionHours: 48 });
  });

  test("signing everyone out ends tokens that have not expired yet", async () => {
    const other = await server.login(from("203.0.113.5"));
    const read = (bearer) =>
      server.request("/api/admin/milestones", { token: bearer });
    expect((await read(other)).status).toBe(200);

    const everywhere = await server.request("/api/admin/logout-everywhere", {
      method: "POST",
      token,
    });
    expect(everywhere.status).toBe(200);
    expect((await read(token)).status).toBe(401);
    expect((await read(other)).status).toBe(401);
    expect((await read(await server.login(from("203.0.113.6")))).status).toBe(
      200,
    );
  });
});

describe("admin routes while background jobs are down", () => {
  let server;
  let token;
  beforeAll(async () => {
    server = await startAdminServer({
      jobs: false,
      env: { TRUST_PROXY: "true" },
    });
    token = await server.login(from("198.51.100.1"));
  }, BOOT_TIMEOUT);
  afterAll(() => server?.stop());

  test("the admin is told in German that jobs are down, with a 503", async () => {
    const unavailable =
      "Die Hintergrundverarbeitung ist nicht bereit. Versuche es später erneut.";
    for (const [path, body] of [
      ["/api/admin/campaigns/1/retry", {}],
      ["/api/admin/zoom-settings", { eventAt: new Date().toISOString() }],
    ]) {
      const response = await server.request(path, {
        method: "POST",
        token,
        body,
      });
      expect([path, response.status]).toEqual([path, 503]);
      expect((await response.json()).error).toBe(unavailable);
    }
  });

  test("a monitor is told the app is down, and nothing more", async () => {
    const response = await server.request("/api/health/operations");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      checks: { app: "down", mailQueue: "unknown" },
    });
  });

  test("failed logins from many addresses run into one shared ceiling", async () => {
    let failed = 0;
    for (let address = 0; failed < 30; address++)
      for (let attempt = 0; attempt < 5 && failed < 30; attempt++) {
        const response = await wrongPassword(
          server,
          from(`192.0.2.${address}`),
        );
        expect(response.status).toBe(401);
        failed++;
      }
    // A fresh address with the right password is held back as well: the
    // ceiling is what stops a guess spread over many addresses.
    const blocked = await server.request("/api/admin/login", {
      method: "POST",
      headers: from("192.0.2.200"),
      body: { password: ADMIN_PASSWORD },
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Sessions that already exist keep working.
    expect(
      (await server.request("/api/admin/milestones", { token })).status,
    ).toBe(200);
  });
});

describe("meeting registrations on a letter with a meeting", () => {
  let server;
  let token;
  beforeAll(async () => {
    server = await startAdminServer({
      env: { TRUST_PROXY: "true", HTTP_FIXTURE_ZOOM: "1" },
      preload: ["./test/fixtures/zoom-on.js"],
    });
    token = await server.login(from("203.0.113.9"));
  }, BOOT_TIMEOUT);
  afterAll(() => server?.stop());

  test("meeting registrations come in pages with their totals", async () => {
    await server.sql(async (db) => {
      for (let n = 0; n < 3; n++)
        await db
          .query(
            "INSERT INTO zoom_registrations (name, email, delegierter, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(
            `Person ${n}`,
            `meeting-${n}@example.org`,
            n === 0 ? 1 : 0,
            new Date(Date.now() - n * 60_000).toISOString(),
          );
    });
    const page = await (
      await server.request("/api/admin/zoom-registrations?limit=2&offset=2", {
        token,
      })
    ).json();
    expect(page.total).toBe(3);
    expect(page.delegates).toBe(1);
    expect(page.registrations.map((person) => person.name)).toEqual([
      "Person 2",
    ]);
  });

  test("one meeting registration is found by search and removed, and the log names no address", async () => {
    const { id } = await server.sql((db) =>
      db
        .query(
          "INSERT INTO zoom_registrations (name, email) VALUES ('Falsch Angemeldet', 'falsch@example.org') RETURNING id",
        )
        .get(),
    );
    const list = async (query = "") =>
      (
        await server.request(`/api/admin/zoom-registrations${query}`, { token })
      ).json();
    const before = await list();
    const found = await list("?search=FALSCH@");
    expect(found.matches).toBe(1);
    expect(found.total).toBe(before.total);
    expect(found.registrations).toMatchObject([
      { id, name: "Falsch Angemeldet", email: "falsch@example.org" },
    ]);

    const remove = () =>
      server.request(`/api/admin/zoom-registrations/${id}`, {
        method: "DELETE",
        token,
      });
    expect((await remove()).status).toBe(200);
    const again = await remove();
    expect(again.status).toBe(404);
    expect((await again.json()).error).toContain("gibt es nicht mehr");
    expect((await list()).total).toBe(before.total - 1);
    expect(
      (
        await server.request(`/api/admin/zoom-registrations/${id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(401);

    const log = await (
      await server.request("/api/admin/actions", { token })
    ).json();
    const entries = log.actions.filter(
      (entry) => entry.action === "meeting.remove",
    );
    expect(entries).toMatchObject([{ targetId: id }]);
    expect(JSON.stringify(entries)).not.toContain("example.org");
    // Deleting all of them is still its own route, not "the one called clear".
    const cleared = await server.request(
      "/api/admin/zoom-registrations/clear",
      { method: "POST", token },
    );
    expect(await cleared.json()).toEqual({
      ok: true,
      removed: before.total - 1,
    });
  });
});
