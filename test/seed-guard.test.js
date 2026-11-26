// The demo seed (db/seed.js) and the databases it must not write into.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openEncrypted } from "../db/connection.js";

const root = resolve(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "open-letter-seed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const envFor = (path, NODE_ENV) => ({
  ...process.env,
  NODE_ENV,
  DATABASE_PATH: path,
});

function setUp(name) {
  const path = join(dir, name);
  const setup = Bun.spawnSync([process.execPath, "db/setup.js"], {
    cwd: root,
    env: envFor(path, "development"),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(setup.exitCode, setup.stderr.toString()).toBe(0);
  return path;
}

async function sql(path, run) {
  const database = await openEncrypted(path);
  try {
    return await run(database);
  } finally {
    await database.close();
  }
}

const addRealSigner = (path) =>
  sql(path, (database) =>
    database
      .query(
        "INSERT INTO signers (name, email, verified) VALUES ('Real Person', 'real@example.org', 1)",
      )
      .run(),
  );

const signers = (path) =>
  sql(path, (database) =>
    database
      .query(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(email LIKE '%@demo.local'), 0) AS demo,
                (SELECT COUNT(*) FROM first_signer_pins) AS pins
         FROM signers`,
      )
      .get(),
  );

// The seed keeps adding a signer every few seconds once it has seeded, so a
// run that got that far is stopped there.
async function seed(path, NODE_ENV, args = []) {
  const child = Bun.spawn([process.execPath, "db/seed.js", ...args], {
    cwd: root,
    env: envFor(path, NODE_ENV),
    stdout: "pipe",
    stderr: "pipe",
  });
  let out = "";
  let err = "";
  (async () => {
    for await (const bytes of child.stdout) {
      out += new TextDecoder().decode(bytes);
      if (out.includes("Press Ctrl+C")) child.kill("SIGTERM");
    }
  })();
  (async () => {
    for await (const bytes of child.stderr)
      err += new TextDecoder().decode(bytes);
  })();
  const code = await child.exited;
  return { seeded: out.includes("Press Ctrl+C"), code, err };
}

test("the seed refuses a production environment before it opens the database", async () => {
  const path = setUp("production.db");
  await addRealSigner(path);

  for (const args of [[], ["--force"]]) {
    const run = await seed(path, "production", args);
    expect(run.seeded).toBe(false);
    expect(run.code).toBe(1);
    expect(run.err).toContain("NODE_ENV");
  }
  expect(await signers(path)).toEqual({ total: 1, demo: 0, pins: 0 });

  const untouched = join(dir, "never-opened.db");
  expect((await seed(untouched, "production")).code).toBe(1);
  expect(existsSync(untouched)).toBe(false);
}, 120_000);

test("the seed refuses a database that holds signers it did not create, unless forced", async () => {
  const path = setUp("real-signers.db");
  await addRealSigner(path);

  const refused = await seed(path, "development");
  expect(refused.seeded).toBe(false);
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("--force");
  expect(await signers(path)).toEqual({ total: 1, demo: 0, pins: 0 });

  const forced = await seed(path, "development", ["--force"]);
  expect(forced.seeded).toBe(true);
  expect(await signers(path)).toMatchObject({ demo: 204, pins: 4 });
}, 120_000);

test("the seed fills an empty database and one that holds only its own signers", async () => {
  const path = setUp("development.db");

  expect((await seed(path, "development")).seeded).toBe(true);
  expect(await signers(path)).toMatchObject({ total: 204, demo: 204, pins: 4 });

  expect((await seed(path, "development")).seeded).toBe(true);
  expect((await signers(path)).total).toBeGreaterThan(204);
}, 120_000);
