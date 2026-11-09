import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openEncrypted } from "../db/connection.js";

test("production setup upgrades the pre-publishing schema to the current columns and indexes", async () => {
  const dir = mkdtempSync("/tmp/open-letter-schema-upgrade-");
  const upgraded = join(dir, "upgraded.db"),
    fresh = join(dir, "fresh.db");
  const run = (path) => {
    const child = Bun.spawnSync([process.execPath, "db/setup.js"], {
      env: { ...process.env, DATABASE_PATH: path },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(
      child.exitCode,
      child.stderr.toString() + child.stdout.toString(),
    ).toBe(0);
  };
  const shape = async (path) => {
    const connection = await openEncrypted(path);
    try {
      const tables = await connection
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      const out = {};
      for (const { name } of tables)
        out[name] = (await connection.query(`PRAGMA table_info(${name})`).all())
          .map((c) => ({
            name: c.name,
            type: c.type,
            notnull: c.notnull,
            pk: c.pk,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      out.indexes = (
        await connection
          .query(
            "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all()
      ).map((r) => r.name);
      return out;
    } finally {
      await connection.close();
    }
  };
  try {
    const old = await openEncrypted(upgraded);
    await old.run(
      readFileSync(
        new URL("./fixtures/schema-before-publishing.sql", import.meta.url),
        "utf8",
      ),
    );
    await old
      .query(
        "INSERT INTO signers(name,email,verified) VALUES ('Legacy Person','legacy@example.invalid',1)",
      )
      .run();
    await old.close();
    run(upgraded);
    run(fresh);
    expect(await shape(upgraded)).toEqual(await shape(fresh));
    const checked = await openEncrypted(upgraded);
    try {
      expect(
        (
          await checked
            .query(
              "SELECT name FROM signers WHERE email='legacy@example.invalid'",
            )
            .get()
        ).name,
      ).toBe("Legacy Person");
    } finally {
      await checked.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
