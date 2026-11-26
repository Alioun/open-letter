// The Caddy proxy has to forward to the port the app listens on, whatever
// PORT is set to in .env. Both files are resolved the way Compose and Caddy
// resolve them.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

// A service's environment as its container sees it: Compose fills ${NAME}
// and ${NAME:-default} from .env.
function containerEnv(file, service, dotenv) {
  const lines = Bun.YAML.parse(read(file)).services[service].environment;
  return Object.fromEntries(
    lines.map((line) => {
      const [name, ...rest] = line.split("=");
      const value = rest
        .join("=")
        .replace(
          /\$\{(\w+)(?::[-?]([^}]*))?\}/g,
          (_, key, fallback) => dotenv[key] || fallback || "",
        );
      return [name, value];
    }),
  );
}

// Where the Caddyfile sends requests: Caddy fills {$NAME} and {$NAME:default}
// from its own container's environment.
function caddyUpstream(env) {
  const [, upstream] = /reverse_proxy\s+(\S+)/.exec(read("Caddyfile"));
  return upstream.replace(
    /\{\$(\w+)(?::([^}]*))?\}/g,
    (_, key, fallback) => env[key] || fallback || "",
  );
}

test("the proxy forwards to the port the app listens on", () => {
  for (const dotenv of [{}, { PORT: "3000" }, { PORT: "8080" }]) {
    const app = containerEnv("docker-compose.yml", "app", dotenv);
    const caddy = containerEnv("docker-compose.proxy.yml", "caddy", {
      DOMAIN: "example.org",
      ...dotenv,
    });
    expect([dotenv, caddyUpstream(caddy)]).toEqual([dotenv, `app:${app.PORT}`]);
  }
});
