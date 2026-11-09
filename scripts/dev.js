import { watch } from "node:fs";
import { resolve } from "node:path";
let child;
let timer;
let restarting = Promise.resolve();
function restart() {
  restarting = restarting.then(async () => {
    if (child) {
      child.kill("SIGTERM");
      await child.exited;
    }
    child = Bun.spawn([process.execPath, "server/index.js"], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: process.env,
    });
  });
}
for (const path of ["src", "config", "server", "db", "public"])
  watch(resolve(path), { recursive: true }, (_, name) => {
    if (!name || /\.(jsx?|css|sql|html|png|jpe?g|webp)$/.test(name)) {
      clearTimeout(timer);
      timer = setTimeout(restart, 150);
    }
  });
for (const path of [
  "index.template.html",
  "admin.template.html",
  "package.json",
  "bunfig.toml",
])
  watch(resolve(path), () => {
    clearTimeout(timer);
    timer = setTimeout(restart, 150);
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    child?.kill(signal);
    process.exit(0);
  });
restart();
