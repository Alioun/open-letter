// The real server on a throwaway database, for tests of what an HTTP caller
// sees. Listens on loopback only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openEncrypted } from "../../db/connection.js";

const root = resolve(import.meta.dir, "../..");
const DB_KEY = "http-fixture-db-key";
export const ADMIN_PATH = "verwaltung-fixture";
export const ADMIN_PASSWORD = "http-fixture-admin-password";

export async function startAdminServer({
  jobs = true,
  env: extra = {},
  preload = [],
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "open-letter-http-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const origin = `http://127.0.0.1:${port}`;
  const databasePath = join(dir, "http.db");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    LETTER_CONFIG: "example",
    DATABASE_PATH: databasePath,
    DATABASE_ENCRYPTION_KEY: DB_KEY,
    BACKUP_ENCRYPTION_KEY: "http-fixture-backup-key",
    BACKUP_DIR: join(dir, "backups"),
    ADMIN_PATH,
    ADMIN_PASSWORD,
    ADMIN_JWT_SECRET: "http-fixture-admin-secret-with-32-characters",
    API_TOKEN_SECRET: "http-fixture-public-secret-with-32-characters",
    BASE_URL: origin,
    PORT: String(port),
    TRUST_PROXY: "false",
    EMAIL_PROVIDER: "",
    RESEND_API_KEY: "",
    SMTP_HOST: "",
    ...(jobs ? {} : { HONKER_EXTENSION_PATH: join(dir, "missing.so") }),
    ...extra,
  };
  const setup = Bun.spawnSync([process.execPath, "db/setup.js"], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (setup.exitCode !== 0) throw new Error(setup.stderr.toString());

  let logs = "";
  const child = Bun.spawn(
    [
      process.execPath,
      "--preload",
      "./test/fixtures/loopback.js",
      ...preload.flatMap((path) => ["--preload", path]),
      "server/index.js",
    ],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" },
  );
  for (const stream of [child.stdout, child.stderr])
    (async () => {
      for await (const bytes of stream) logs += new TextDecoder().decode(bytes);
    })();
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server exited\n${logs}`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`Server did not start\n${logs}`);
    }
    try {
      // Without jobs the health check stays 503; a listener is all there is.
      const health = await fetch(`${origin}/api/health`);
      if (health.ok || !jobs) break;
    } catch {}
    await Bun.sleep(100);
  }

  // No connection reuse: on a slow machine a test can pause for longer than
  // the server keeps an idle connection open, and the next request on that
  // connection would be reset.
  const request = (path, { token, headers, body, ...options } = {}) =>
    fetch(origin + path, {
      keepalive: false,
      ...options,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      ...(body !== undefined && {
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    });
  return {
    origin,
    request,
    logs: () => logs,
    async login(headers) {
      const response = await request("/api/admin/login", {
        method: "POST",
        headers,
        body: { password: ADMIN_PASSWORD },
      });
      if (!response.ok) throw new Error(`Login failed: ${response.status}`);
      return (await response.json()).token;
    },
    // A statement against the server's database, from outside the server.
    async sql(run) {
      const database = await openEncrypted(databasePath, DB_KEY);
      try {
        return await run(database);
      } finally {
        await database.close();
      }
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await child.exited;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
