import { DeliveryDeferred } from "./email-setup.js";
import { meetingMailing, meetingScope } from "./meeting-repository.js";

export function createMeetingService({
  repository,
  registrations,
  durableWork,
  getConfig,
  dispatchEmail,
  buildMail,
  getRecipientIdentity,
  authorizeRecipient,
  issueUnsubscribeTokenForRecipient,
  markDeliveredForRecipient,
  retentionMs,
  maxRecipientsPerRun = 100,
  canContinue = () => true,
  clock = Date.now,
  logger = console,
}) {
  let running = false;
  const current = (config) => repository.isCurrent(config.generation);
  const linkWindowOpen = (config) =>
    config.dateSet &&
    clock() >= config.eventAt.getTime() - config.linkOffsetHours * 3_600_000 &&
    clock() < config.eventAt.getTime();

  async function send(kind, config, recipient, priority) {
    const identity = {
      source: "meeting",
      id: recipient.id,
      email: recipient.email,
      createdAt: recipient.createdAt ?? recipient.created_at,
    };
    const mailing = meetingMailing(kind, config.generation);
    await dispatchEmail(
      async () => {
        if (
          !(await current(config)) ||
          !(await authorizeRecipient(identity, { audience: "zoom" }))
        )
          return null;
        const token = await issueUnsubscribeTokenForRecipient(identity);
        return token ? buildMail(kind, recipient, token, config) : null;
      },
      {
        scope: meetingScope(kind, config, recipient),
        priority,
        eligible: async (connection) =>
          (await repository.isCurrent(config.generation, { connection })) &&
          (await authorizeRecipient(identity, {
            audience: "zoom",
            connection,
          })),
        onAccepted: (connection) =>
          repository.forGeneration(
            config.generation,
            (transactionConnection) =>
              markDeliveredForRecipient(mailing, identity, {
                connection: transactionConnection,
              }),
            { connection },
          ),
      },
    );
  }

  async function sendMailing(kind, config) {
    const recipients = await registrations.getZoomRecipients();
    const delivered = await repository.delivered(kind, config.generation);
    let failure;
    const todo = recipients.filter(
      (recipient) => !delivered.has(recipient.email),
    );
    for (const recipient of todo.slice(0, maxRecipientsPerRun)) {
      if (!canContinue()) throw new DeliveryDeferred("worker-stopping", 5);
      if (!(await current(config))) break;
      try {
        await send(kind, config, recipient, "campaign");
      } catch (error) {
        if (error.defer && error.message !== "provider-reconciliation-required")
          throw error;
        failure ||= error;
        logger.error(`[zoom-mail] ${kind} delivery failed`, error);
      }
      await repository.touch(kind, config.generation);
    }
    if (failure) throw failure;
    return {
      count: await repository.count(kind, config.generation),
      incomplete: todo.length > maxRecipientsPerRun,
    };
  }

  return {
    async register({ signerToken, delegierter, force = false }) {
      return durableWork.run(async () => {
        const signer = await registrations.getSignerForZoomInvite(signerToken);
        if (!signer) return null;
        const existing = await registrations.getCurrentZoomRegistrationByEmail(
          signer.email,
        );
        if (existing && !force) return { reg: existing, isNew: false };
        const reg = await registrations.insertZoomRegistration({
          name: signer.name,
          email: signer.email,
          kv: signer.kreisverband,
          delegierter,
          lang: signer.lang,
        });
        if (!existing)
          await durableWork.email("meeting-signup", {
            registrationId: reg.id,
            generation: await repository.generation(),
          });
        return { reg, isNew: !existing };
      });
    },
    async confirm(token) {
      return durableWork.run(async () => {
        const reg = await registrations.confirmZoomPending(token);
        if (reg)
          await durableWork.email("meeting-signup", {
            registrationId: reg.id,
            generation: await repository.generation(),
          });
        return reg;
      });
    },
    async sendSignup({ registrationId, generation }) {
      const recipient =
        await registrations.getZoomRegistrationForMail(registrationId);
      if (!recipient) return;
      const identity = await getRecipientIdentity("meeting", registrationId);
      if (
        !identity ||
        identity.email !== recipient.email ||
        identity.createdAt !== recipient.created_at
      )
        return;
      const config = await getConfig();
      for (const event of new Set([generation, config.generation]))
        for (const sentKind of ["confirmation", "link", "reminder"])
          if (
            (await repository.delivered(sentKind, event)).has(recipient.email)
          )
            return;
      const mailings = await repository.list(config.generation);
      const sent = (kind) =>
        mailings.some((row) => row.kind === kind && row.status === "sent");
      const kind = sent("reminder")
        ? "reminder"
        : sent("link") || (linkWindowOpen(config) && config.link)
          ? "link"
          : "confirmation";
      await send(kind, config, recipient, "transactional");
      if (!(await current(config)))
        throw new DeliveryDeferred("meeting-date-changed", 1);
    },
    async runWorker() {
      if (running) return;
      running = true;
      try {
        const config = await getConfig();
        if (!config.dateSet || Number.isNaN(config.eventAt.getTime())) return;
        await repository.forGeneration(config.generation, async () => {
          await registrations.purgePreviousTreffenRegistrations();
          await registrations.purgeZoomRegistrationsAfter(
            new Date(config.eventAt.getTime() + retentionMs),
          );
        });
        for (const kind of ["link", "reminder"]) {
          const offset =
            kind === "link"
              ? config.linkOffsetHours
              : config.reminderOffsetHours;
          const now = clock();
          if (
            now < config.eventAt.getTime() - offset * 3_600_000 ||
            now >= config.eventAt.getTime()
          )
            continue;
          if (kind === "link" && !config.link) continue;
          if (!(await repository.claim(kind, config.generation))) continue;
          try {
            const { count, incomplete } = await sendMailing(kind, config);
            if (incomplete) await repository.defer(kind, config.generation);
            else await repository.mark(kind, config.generation, "sent", count);
          } catch (error) {
            logger.error(`[zoom-mail] ${kind} mailing failed`, error);
            if (error.defer)
              await repository.defer(kind, config.generation, error.diagnostic);
            else
              await repository.mark(
                kind,
                config.generation,
                "failed",
                await repository.count(kind, config.generation),
                error.diagnostic || { category: "unknown" },
              );
          }
        }
      } finally {
        running = false;
      }
    },
  };
}
