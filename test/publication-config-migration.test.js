import { test, expect } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("separate deployment processes reconcile language and field additions, retirement, recovery and restore", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "publication-config-"));
  const letterPath = join(fixture, "config/letters/example/index.js");
  try {
    for (const directory of ["config", "server", "db"])
      cpSync(join(root, directory), join(fixture, directory), {
        recursive: true,
      });
    cpSync(
      join(root, "test/fixtures/publication-config-process.js"),
      join(fixture, "worker.js"),
    );
    symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"));
    const original = readFileSync(letterPath, "utf8").replace(
      "export default {",
      "const letter = {",
    );
    const configure = (multi, badge) =>
      writeFileSync(
        letterPath,
        `${original}
      letter.features.multiLanguage = ${multi};
      letter.features.zoomEvent = ${multi};
      letter.languages = ["en", "de"];
      ${badge ? "" : "delete letter.zoom.form.badge;"}
      letter.brand.newField = "New default field";
      export default letter;
    `,
      );
    const env = {
      ...process.env,
      DATABASE_PATH: join(fixture, "fixture.db"),
      DATABASE_ENCRYPTION_KEY: "publication-process-fixture",
      BACKUP_ENCRYPTION_KEY: "publication-process-fixture",
      FIXTURE_BACKUP: join(fixture, "fixture-backup.sqlite"),
      EMAIL_PROVIDER: "",
      RESEND_API_KEY: "",
      SMTP_HOST: "",
    };
    async function run(script, ...args) {
      const child = Bun.spawn([process.execPath, script, ...args], {
        cwd: fixture,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ script, args, code, stderr }).toEqual({
        script,
        args,
        code: 0,
        stderr: "",
      });
      console.log(stdout.trim());
    }
    writeFileSync(letterPath, `${original}\nexport default letter;\n`);
    await run("worker.js", "seed");
    configure(true, false);
    await run("worker.js", "added");
    configure(false, false);
    await run("worker.js", "removed");
    configure(true, true);
    await run("worker.js", "returned");
    configure(true, false);
    await run("db/restore-backup.js", env.FIXTURE_BACKUP);
    await run("worker.js", "restored");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 60000);
