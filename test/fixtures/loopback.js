// Preload for servers started by tests: loopback only, whatever the entry
// file asks for.
const serve = Bun.serve.bind(Bun);
Bun.serve = (options) => serve({ ...options, hostname: "127.0.0.1" });
