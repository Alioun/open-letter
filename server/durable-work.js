import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export class JobsUnavailable extends Error {
  constructor() {
    super(
      "Hintergrundverarbeitung ist nicht bereit. Bitte später erneut versuchen.",
    );
    this.status = 503;
  }
}

export function createDurableWork(
  connection,
  { enqueue, ttl, prepare = async () => ({}) },
) {
  const context = new AsyncLocalStorage();
  let ready = false;
  let failure = "initializing";
  return {
    get status() {
      return { ready, failure };
    },
    available() {
      ready = true;
      failure = null;
    },
    unavailable(reason = "unavailable") {
      ready = false;
      failure = reason;
    },
    async run(operation) {
      if (!ready) throw new JobsUnavailable();
      return connection.transaction(
        async () => {
          if (!ready) throw new JobsUnavailable();
          return context.run(true, operation);
        },
        { immediate: true },
      );
    },
    async email(kind, args) {
      if (!ready) throw new JobsUnavailable();
      if (!context.getStore())
        throw new Error("Queue mail inside durableWork.run");
      const payload = {
        kind,
        ...args,
        messageId: randomUUID(),
        ...(await prepare(kind, args)),
      };
      return enqueue("emails", payload, {
        maxAttempts: 5,
        expires: ttl,
        connection,
      });
    },
  };
}
