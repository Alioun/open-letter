import { inDatabaseTransaction } from "../db/connection.js";
import { ValidationError } from "../config/validation.js";
import nodemailer from "nodemailer";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { RevisionConflict } from "./publications.js";
import { resolvePrivacy } from "../config/privacy.js";
import { ensureEmailAttemptSubjects } from "../db/email-attempts.js";
import { emailHmac } from "../db/erasure-log.js";
import { identifiedEmailTest } from "../config/email-test.js";

export class DeliveryDeferred extends Error {
  constructor(category, retryAfterS = 60) {
    super(category);
    this.name = "DeliveryDeferred";
    this.retryAfterS = retryAfterS;
    this.defer = true;
  }
}

export const deliveryContext = new AsyncLocalStorage();
const nonempty = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const identity = (p) =>
  createHash("sha256")
    .update(JSON.stringify([p.provider, p.host, p.port, p.secure, p.user]))
    .digest("hex");
const accountKey = (p) =>
  createHash("sha256")
    .update(JSON.stringify([p.provider, p.host, p.user || p.from]))
    .digest("hex");

export function deploymentProfile(config, env = process.env) {
  const provider =
    nonempty(env.EMAIL_PROVIDER) || config.email.provider || "resend";
  const smtp = config.email.smtp || {};
  return {
    provider,
    from:
      nonempty(env.EMAIL_FROM) ||
      nonempty(env.RESEND_FROM) ||
      config.email.from ||
      "",
    host: nonempty(env.SMTP_HOST) || smtp.host || "",
    port: Number(nonempty(env.SMTP_PORT) || smtp.port || 587),
    secure: nonempty(env.SMTP_SECURE)
      ? ["true", "1"].includes(env.SMTP_SECURE)
      : Boolean(smtp.secure),
    user: nonempty(env.SMTP_USER) || "",
    secret:
      nonempty(provider === "resend" ? env.RESEND_API_KEY : env.SMTP_PASS) ||
      "",
    processor: config.email.processor || provider,
    region: config.email.region || "",
    revision: 0,
  };
}

export function cleanProfile(input, previous) {
  if (!input || typeof input !== "object")
    throw new ValidationError("Das Versandprofil ist ungültig.");
  const p = {
    provider: input.provider,
    from: String(input.from || "").trim(),
    host: String(input.host || "")
      .trim()
      .toLowerCase(),
    port: Number(input.port || 465),
    secure: input.secure !== false,
    user: String(input.user || "").trim(),
    processor: String(input.processor || "").trim(),
    region: String(input.region || "").trim(),
    secret: input.secret || "",
  };
  if (!["smtp", "mailbox.org", "resend"].includes(p.provider))
    throw new ValidationError(
      "Wähle SMTP, mailbox.org oder Resend als Anbieter.",
    );
  if (!/^[^\r\n<>]*<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(p.from))
    throw new ValidationError("Gib eine gültige Absenderadresse ein.");
  if (p.provider === "mailbox.org") {
    p.host = "smtp.mailbox.org";
    if (![465, 587].includes(p.port))
      throw new ValidationError("Verwende für mailbox.org Port 465 oder 587.");
    p.secure = p.port === 465;
    p.processor = "mailbox.org / Heinlein Support GmbH";
    p.region = "Germany";
  }
  if (p.provider === "resend") {
    p.host = "api.resend.com";
    p.port = 443;
    p.secure = true;
    p.processor = "Resend";
    if (!p.region)
      throw new ValidationError(
        "Gib die beim Anbieter eingestellte Verarbeitungsregion ein.",
      );
  }
  if (
    p.provider !== "resend" &&
    (!/^[a-z0-9.-]+$/.test(p.host) ||
      !Number.isInteger(p.port) ||
      p.port < 1 ||
      p.port > 65535 ||
      !p.user ||
      !p.processor ||
      !p.region)
  )
    throw new ValidationError(
      "Ergänze SMTP-Server, Hauptadresse, Betreiber und Verarbeitungsregion.",
    );
  if (!p.secret && previous && identity(previous) === identity(p))
    p.secret = previous.secret;
  if (!p.secret)
    throw new ValidationError(
      "Gib neue Zugangsdaten für diesen Anbieter, Server und dieses Konto ein.",
    );
  if (
    typeof p.secret !== "string" ||
    p.secret.length > 4096 ||
    /[\r\n]/.test(p.secret)
  )
    throw new ValidationError("Die Zugangsdaten sind ungültig.");
  return p;
}

export function smtpOptions(p) {
  return {
    host: p.host,
    port: p.port,
    secure: p.secure,
    requireTLS: !p.secure,
    opportunisticTLS: false,
    auth: { user: p.user, pass: p.secret },
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: p.host,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };
}

export function diagnostic(error) {
  const protocol = Number(error.responseCode || error.status || 0);
  const code = String(error.code || "");
  const category =
    protocol === 429 || protocol === 452 || protocol === 421
      ? "quota"
      : protocol === 535 || protocol === 401 || code === "EAUTH"
        ? "authentication"
        : /CERT|TLS|SSL/.test(code) ||
            /certificate|self.signed|unable.to.verify/i.test(
              String(error.message || ""),
            )
          ? "encryption"
          : protocol === 403 ||
              (protocol === 550 && error.command === "MAIL FROM")
            ? "sender-authorization"
            : protocol >= 500 && error.command === "RCPT TO"
              ? "recipient-rejected"
              : ["ENOTFOUND", "EINVAL"].includes(code)
                ? "configuration"
                : "temporary-delivery";
  return {
    category,
    protocol: protocol || null,
    code: [
      "EAUTH",
      "EENVELOPE",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ECONNECTION",
      "ESOCKET",
    ].includes(code)
      ? code
      : null,
    correlationId: randomUUID(),
  };
}

async function apiRequest(p, path, data, key) {
  const r = await fetch(`https://api.resend.com/${path}`, {
    method: data ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${p.secret}`,
      "Content-Type": "application/json",
      ...(key && { "Idempotency-Key": key }),
    },
    ...(data && { body: JSON.stringify(data) }),
  });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error("Provider request failed");
    e.status = r.status;
    e.retryAfterS = Math.min(
      86400,
      Math.max(60, Number(r.headers.get("retry-after")) || 60),
    );
    throw e;
  }
  return result;
}

function safeProfile(p) {
  if (!p) return null;
  const { secret, ...rest } = p;
  return { ...rest, hasCredential: Boolean(secret) };
}

export async function createEmailManager(
  connection,
  config,
  {
    createTransport = nodemailer.createTransport,
    request = apiRequest,
    onActivate = () => {},
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  await connection.run(
    readFileSync(new URL("../db/publishing.sql", import.meta.url), "utf8"),
  );
  const legacyAttempts = await ensureEmailAttemptSubjects(connection);
  if (legacyAttempts.unmatched)
    console.warn(
      `[email] ${legacyAttempts.unmatched} legacy attempts have no recoverable subject; retained until their original retention deadline`,
    );
  const deployment = deploymentProfile(config);
  const row = await connection
    .query("SELECT * FROM email_configuration WHERE id=1")
    .get();
  let state = row
    ? {
        revision: row.revision,
        source: row.source,
        active: JSON.parse(row.active || "null"),
        candidate: JSON.parse(row.candidate || "null"),
        ...JSON.parse(row.state),
      }
    : {
        revision: 0,
        source: "deployment",
        active: deployment,
        candidate: null,
        ready: Boolean(
          deployment.secret &&
          (deployment.provider === "resend" || deployment.host),
        ),
        retired: [],
      };
  if (state.source === "deployment") state.active = deployment;
  const restored = await connection
    .query("SELECT value FROM app_settings WHERE key='email:restored'")
    .get();
  if (restored && state.restoreMarker !== restored.value) {
    state = {
      ...state,
      revision: state.revision + 1,
      ready: false,
      validation: null,
      restoreMarker: restored.value,
      failure: {
        category: "restore-revalidation",
        correlationId: randomUUID(),
        protocol: null,
        code: null,
      },
    };
  }
  let serial = Promise.resolve();
  const transports = new Map();
  const inFlight = new Set();
  let waitingTransactional = 0;
  const locked = (fn) => {
    const next = serial.then(fn);
    serial = next.catch(() => {});
    return next;
  };
  const check = (expected) => {
    if (!Number.isInteger(expected) || expected !== state.revision)
      throw new RevisionConflict(state.revision);
  };
  async function persist(next) {
    const changed =
      next.ready !== state.ready ||
      next.active?.revision !== state.active?.revision;
    const { revision, source, active, candidate, ...details } = next;
    await connection
      .query(
        "INSERT INTO email_configuration /* public-neutral */ (id,revision,source,active,candidate,state) VALUES (1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,source=excluded.source,active=excluded.active,candidate=excluded.candidate,state=excluded.state",
      )
      .run(
        revision,
        source,
        JSON.stringify(active),
        JSON.stringify(candidate),
        JSON.stringify(details),
      );
    state = next;
    if (changed) onActivate(manager.facts);
  }
  function transport(p) {
    const key = `${identity(p)}:${p.revision}`;
    if (!transports.has(key))
      transports.set(key, createTransport(smtpOptions(p)));
    return transports.get(key);
  }
  const publicState = () => ({
    revision: state.revision,
    source: state.source,
    active: safeProfile(state.active),
    candidate: safeProfile(state.candidate),
    ready: Boolean(state.ready),
    validation: state.validation || null,
    failure: state.failure || null,
    setupFailure: state.setupFailure || null,
    lastSuccess: state.lastSuccess || null,
  });
  async function verify(p) {
    if (p.provider !== "resend") await transport(p).verify();
  }
  async function deliver(p, payload, scope) {
    if (p.provider === "resend")
      return request(
        p,
        "emails",
        {
          from: p.from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          ...(payload.text && { text: payload.text }),
          ...(payload.headers && { headers: payload.headers }),
          ...(payload.attachments && { attachments: payload.attachments }),
        },
        scope,
      );
    return transport(p).sendMail({
      ...payload,
      from: p.from,
      attachments: payload.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, "base64"),
        contentType: a.content_type,
      })),
    });
  }
  const manager = {
    get status() {
      return publicState();
    },
    get facts() {
      return {
        provider:
          state.active?.provider === "mailbox.org"
            ? "smtp"
            : state.active?.provider,
        processor: state.active?.processor || state.active?.provider,
        region: state.active?.region || "",
        ready: Boolean(state.ready),
      };
    },
    save(input, expected, takeOver = false) {
      return locked(async () => {
        check(expected);
        if (state.source === "deployment" && !takeOver)
          throw new ValidationError(
            "Übernimm zuerst die Verwaltung des Versandprofils in den Einstellungen.",
          );
        const candidate = takeOver
          ? { ...deployment }
          : cleanProfile(input, state.candidate || state.active);
        candidate.revision = state.revision + 1;
        await persist({
          ...state,
          revision: candidate.revision,
          source: "admin",
          candidate,
          validation: null,
        });
        return publicState();
      });
    },
    async test(expected, recipient) {
      const p = await locked(async () => {
        check(expected);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
          throw new ValidationError("Gib eine gültige Testadresse ein.");
        if (!state.candidate && !state.active)
          throw new ValidationError("Speichere zuerst ein Versandprofil.");
        return structuredClone(state.candidate || state.active);
      });
      let failure = null;
      try {
        await verify(p);
        await deliver(
          p,
          {
            to: recipient,
            subject: "Campaign email setup test",
            html: "<p>This is your campaign email setup test. Confirm receipt in the administration.</p>",
          },
          `setup-${p.revision}-${randomUUID()}`,
        );
      } catch (e) {
        failure = diagnostic(e);
      }
      return locked(async () => {
        check(expected);
        await persist({
          ...state,
          validation: failure
            ? null
            : {
                id: randomUUID(),
                recipient,
                revision: expected,
                profileRevision: p.revision,
                accepted: true,
                received: false,
                checkedAt: new Date().toISOString(),
              },
          setupFailure: failure,
        });
        return publicState();
      });
    },
    confirmReceipt(expected, testId) {
      return locked(async () => {
        check(expected);
        if (
          !identifiedEmailTest(state.validation) ||
          state.validation.revision !== state.revision ||
          state.validation.id !== testId
        )
          throw new ValidationError(
            "Diese Testnachricht ist veraltet oder nicht eindeutig zugeordnet. Lade den aktuellen Stand und prüfe Adresse und Zeitpunkt. Sende bei fehlenden Angaben einen neuen Test.",
          );
        await persist({
          ...state,
          validation: { ...state.validation, received: true },
        });
        return publicState();
      });
    },
    activate(expected) {
      return locked(async () => {
        check(expected);
        if (
          !identifiedEmailTest(state.validation) ||
          !state.validation.received ||
          state.validation.revision !== state.revision
        )
          throw new ValidationError(
            "Bestätige vor der Aktivierung den Empfang der Testnachricht für dieses Profil.",
          );
        const next = {
          ...state,
          active: state.candidate || state.active,
          candidate: null,
          ready: true,
          failure: null,
          setupFailure: null,
          validation: null,
          retired: [
            ...(state.retired || []),
            ...(state.candidate &&
            state.active &&
            state.candidate.revision !== state.active.revision
              ? [state.active]
              : []),
          ],
        };
        await persist(next);
        return publicState();
      });
    },
    async completed(scope) {
      const key = createHash("sha256").update(scope).digest("hex");
      return (
        (
          await connection
            .query("SELECT status FROM email_attempts WHERE scope=?")
            .get(key)
        )?.status === "delivered"
      );
    },
    async send(
      payload,
      {
        priority = "transactional",
        scope,
        eligible = async () => true,
        onAccepted,
      } = {},
    ) {
      if (inDatabaseTransaction())
        throw new Error("Dispatch mail after committing durable work");
      scope ||= deliveryContext.getStore()?.scope || `message-${randomUUID()}`;
      scope = createHash("sha256").update(scope).digest("hex");
      let profile;
      let attempt;
      let createdAttempt = false;
      const waitingSince = Date.now();
      const previous = await connection
        .query("SELECT * FROM email_attempts WHERE scope=?")
        .get(scope);
      if (previous?.status === "delivered") {
        if (onAccepted) await onAccepted(connection);
        return;
      }
      if (typeof payload === "function") payload = await payload();
      if (!payload) return;
      if (priority === "transactional") waitingTransactional++;
      try {
        for (;;) {
          const waitMs = await locked(() =>
            connection.transaction(
              async () => {
                if (!state.ready)
                  throw new DeliveryDeferred("email-unavailable", 300);
                attempt = await connection
                  .query("SELECT * FROM email_attempts WHERE scope=?")
                  .get(scope);
                if (attempt?.status === "delivered") return 0;
                if (inFlight.has(scope))
                  throw new DeliveryDeferred("delivery-in-progress", 5);
                if (
                  attempt?.status === "attempting" ||
                  (attempt?.status === "unresolved" &&
                    attempt.provider !== "resend")
                )
                  throw new DeliveryDeferred(
                    "provider-reconciliation-required",
                    3600,
                  );
                profile = attempt
                  ? [state.active, ...(state.retired || [])].find(
                      (p) =>
                        p?.revision === attempt.profile_revision &&
                        p.provider === attempt.provider,
                    )
                  : state.active;
                if (!profile)
                  throw new DeliveryDeferred(
                    "provider-reconciliation-required",
                    3600,
                  );
                const now = Date.now();
                const account = accountKey(profile);
                const quota = await connection
                  .query("SELECT * FROM email_quota WHERE account=?")
                  .get(account);
                if (quota?.cooldown_until > now)
                  throw new DeliveryDeferred(
                    "account-cooldown",
                    Math.max(1, Math.ceil((quota.cooldown_until - now) / 1000)),
                  );
                if (priority === "campaign" && waitingTransactional > 0)
                  return 100;
                if (quota?.next_at > now)
                  return Math.min(1500, quota.next_at - now);
                if (!(await eligible(connection))) return -1;
                await connection
                  .query(
                    "INSERT INTO email_quota /* public-neutral */ (account,next_at,cooldown_until) VALUES (?,?,0) ON CONFLICT(account) DO UPDATE SET next_at=excluded.next_at",
                  )
                  .run(
                    account,
                    now + (priority === "transactional" ? 550 : 1500),
                  );
                if (!attempt) {
                  createdAttempt = true;
                  attempt = {
                    correlation_id: randomUUID(),
                    status: "attempting",
                  };
                  const at = new Date().toISOString();
                  await connection
                    .query(
                      "INSERT INTO email_attempts /* public-neutral */ (scope,profile_revision,provider,status,correlation_id,updated_at,subject_hmac,created_at) VALUES (?,?,?,'attempting',?,?,?,?)",
                    )
                    .run(
                      scope,
                      profile.revision,
                      profile.provider,
                      attempt.correlation_id,
                      at,
                      emailHmac(payload.to),
                      at,
                    );
                } else {
                  await connection
                    .query(
                      "UPDATE email_attempts /* public-neutral */ SET status='attempting',updated_at=? WHERE scope=?",
                    )
                    .run(new Date().toISOString(), scope);
                }
                inFlight.add(scope);
                return 0;
              },
              { immediate: true },
            ),
          );
          if (waitMs < 0) return;
          if (!waitMs) break;
          if (Date.now() - waitingSince > 30000)
            throw new DeliveryDeferred("transactional-priority", 5);
          await sleep(waitMs);
        }
      } finally {
        if (priority === "transactional") waitingTransactional--;
      }
      if (attempt?.status === "delivered") {
        if (onAccepted) await onAccepted(connection);
        return;
      }
      if (!(await eligible(connection))) {
        inFlight.delete(scope);
        if (createdAttempt)
          await connection
            .query(
              "DELETE FROM email_attempts /* public-neutral */ WHERE scope=? AND status='attempting'",
            )
            .run(scope);
        else
          await connection
            .query(
              "UPDATE email_attempts /* public-neutral */ SET status=? WHERE scope=? AND status='attempting'",
            )
            .run(previous?.status || "retryable", scope);
        return;
      }
      let result;
      try {
        result = await deliver(
          profile,
          {
            ...payload,
            headers: {
              ...payload.headers,
              "X-Campaign-Correlation-ID": attempt.correlation_id,
            },
            messageId: `<${attempt.correlation_id}@campaign.invalid>`,
          },
          scope,
        );
        await locked(async () => {
          const at = new Date().toISOString();
          await connection
            .query(
              "UPDATE email_attempts /* public-neutral */ SET status='delivered',updated_at=? WHERE scope=?",
            )
            .run(at, scope);
          await persist({ ...state, lastSuccess: at });
        });
      } catch (e) {
        const d = { ...diagnostic(e), correlationId: attempt.correlation_id };
        await locked(async () => {
          await connection
            .query(
              "UPDATE email_attempts /* public-neutral */ SET status=?,diagnostic=?,updated_at=? WHERE scope=?",
            )
            .run(
              d.category === "quota" ||
                Number(e.responseCode || e.status) >= 400
                ? "retryable"
                : "unresolved",
              JSON.stringify(d),
              new Date().toISOString(),
              scope,
            );
          if (d.category === "quota")
            await connection
              .query(
                "UPDATE email_quota /* public-neutral */ SET cooldown_until=? WHERE account=?",
              )
              .run(
                Date.now() + (e.retryAfterS || 60) * 1000,
                accountKey(profile),
              );
          await persist({
            ...state,
            ...(identity(profile) === identity(state.active) &&
            [
              "authentication",
              "configuration",
              "encryption",
              "sender-authorization",
            ].includes(d.category)
              ? { ready: false }
              : {}),
            failure: d,
          });
        });
        if (d.category === "quota")
          throw new DeliveryDeferred("provider-quota", e.retryAfterS || 60);
        const error = new Error(`${d.category} (${d.correlationId})`);
        error.diagnostic = d;
        throw error;
      } finally {
        inFlight.delete(scope);
      }
      if (onAccepted) await onAccepted(connection);
      return result;
    },
    reconcile(scope, resolution, expected) {
      return locked(async () => {
        check(expected);
        if (!["delivered", "retryable"].includes(resolution))
          throw new ValidationError(
            "Wähle eine bestätigte Annahme oder die Freigabe für einen erneuten Versuch.",
          );
        if (inFlight.has(scope))
          throw new ValidationError(
            "Der Versand läuft noch. Warte auf das Ergebnis, bevor du ihn abgleichst.",
          );
        await connection
          .query(
            "UPDATE email_attempts /* public-neutral */ SET status=?,updated_at=? WHERE scope=? AND status IN ('unresolved','attempting')",
          )
          .run(resolution, new Date().toISOString(), scope);
        return manager.diagnostics();
      });
    },
    async diagnostics() {
      const jobs = await connection
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_honker_live'",
        )
        .get();
      const queue = jobs
        ? {
            available: true,
            queued: (
              await connection
                .query(
                  "SELECT COUNT(*) AS n FROM _honker_live WHERE queue='emails'",
                )
                .get()
            ).n,
            failed: (
              await connection
                .query(
                  "SELECT COUNT(*) AS n FROM _honker_dead WHERE queue='emails'",
                )
                .get()
            ).n,
          }
        : { available: false, queued: null, failed: null };
      return {
        ...publicState(),
        queue,
        messages: await connection
          .query(
            "SELECT status,COUNT(*) AS count FROM email_attempts GROUP BY status",
          )
          .all(),
        unresolved: await connection
          .query(
            "SELECT scope,provider,profile_revision,status,correlation_id FROM email_attempts WHERE status IN ('unresolved','attempting') ORDER BY updated_at LIMIT 100",
          )
          .all(),
      };
    },
    async purge() {
      return locked(async () => {
        const cutoff = new Date(
          Date.now() - resolvePrivacy(config).deliveryLogMs,
        ).toISOString();
        await connection
          .query(
            "DELETE FROM email_attempts /* public-neutral */ WHERE updated_at < ? OR (subject_hmac IS NULL AND created_at < ?)",
          )
          .run(cutoff, cutoff);
        const needed = await connection
          .query(
            "SELECT DISTINCT profile_revision,provider FROM email_attempts WHERE status != 'delivered'",
          )
          .all();
        await persist({
          ...state,
          retired: (state.retired || []).filter((p) =>
            needed.some(
              (n) =>
                n.profile_revision === p.revision && n.provider === p.provider,
            ),
          ),
        });
      });
    },
  };
  if (restored && state.restoreMarker === restored.value) await persist(state);
  return manager;
}
