export function createRequestDrain() {
  let closing = false;
  const active = new Set();
  const wrap = (handler) =>
    function (...args) {
      if (closing)
        return new Response("Service is restarting", {
          status: 503,
          headers: { "Retry-After": "5" },
        });
      const operation = Promise.resolve().then(() => handler.apply(this, args));
      active.add(operation);
      operation.finally(() => active.delete(operation)).catch(() => {});
      return operation;
    };
  return {
    options(options) {
      return {
        ...options,
        fetch: options.fetch && wrap(options.fetch),
        routes: Object.fromEntries(
          Object.entries(options.routes).map(([path, methods]) => [
            path,
            typeof methods === "function"
              ? wrap(methods)
              : Object.fromEntries(
                  Object.entries(methods).map(([method, handler]) => [
                    method,
                    typeof handler === "function" ? wrap(handler) : handler,
                  ]),
                ),
          ]),
        ),
      };
    },
    async close() {
      closing = true;
      await Promise.allSettled([...active]);
    },
  };
}
