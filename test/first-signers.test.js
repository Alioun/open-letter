import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, resetDb, addVerifiedSigner } from "./helpers.js";
import * as q from "../server/db.js";
import cfg from "../config/letter.config.js";
import { invalidate } from "../server/cache.js";
import { openEncrypted } from "../db/connection.js";

beforeEach(resetDb);

describe("first signers and their public details", () => {
  async function withFeatures(features, run) {
    const before = cfg.features;
    cfg.features = { ...before, ...features };
    invalidate();
    try {
      return await run();
    } finally {
      cfg.features = before;
      invalidate();
    }
  }
  const person = async (name, showDetails) => {
    const signer = await addVerifiedSigner({ name, occupation: "Klinikum" });
    await db
      .query(
        "UPDATE signers SET signer_function = 'Sprecherin', show_signer_details = ? WHERE id = ?",
      )
      .run(showDetails, signer.id);
    return signer;
  };
  const pin = (signer, position) =>
    db
      .query(
        "INSERT INTO first_signer_pins (signer_id, position) VALUES (?, ?)",
      )
      .run(signer.id, position);
  const publicList = async () =>
    Object.fromEntries(
      (await q.getSigners({ sort: "asc" })).signers.map((signer) => [
        signer.name,
        signer.signerFunction,
      ]),
    );

  test("a first signer moves to the top and publishes nothing it had not agreed to", async () => {
    const undecided = await person("Undecided", null);
    const declined = await person("Declined", 0);
    const agreed = await person("Agreed", 1);
    await person("Unpinned agreed", 1);
    await pin(agreed, 1);
    await pin(undecided, 2);
    await pin(declined, 3);
    await db
      .query("UPDATE signers SET first_signer = 1 WHERE id IN (?, ?, ?)")
      .run(agreed.id, undecided.id, declined.id);

    await withFeatures(
      { publicSignerDetails: true, publicFirstSignerDetails: true },
      async () => {
        const { signers } = await q.getSigners({ sort: "asc" });
        expect(signers.slice(0, 3).map((signer) => signer.name)).toEqual([
          "Agreed",
          "Undecided",
          "Declined",
        ]);
        expect(await publicList()).toEqual({
          Agreed: "Sprecherin",
          Undecided: null,
          Declined: null,
          "Unpinned agreed": "Sprecherin",
        });
      },
    );
    // A letter that shows details for first signers only.
    await withFeatures(
      { publicSignerDetails: false, publicFirstSignerDetails: true },
      async () =>
        expect(await publicList()).toEqual({
          Agreed: "Sprecherin",
          Undecided: null,
          Declined: null,
          "Unpinned agreed": null,
        }),
    );
  });

  test("the upgrade keeps every signature with its id and allows entries without an address", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-letter-marks-"));
    const path = join(dir, "before.db");
    const setup = () => {
      const child = Bun.spawnSync([process.execPath, "db/setup.js"], {
        env: {
          ...process.env,
          DATABASE_PATH: path,
          LETTER_CONFIG: "example",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(child.exitCode, child.stderr.toString()).toBe(0);
      return child.stdout.toString();
    };
    try {
      const before = await openEncrypted(path);
      await before.run(
        readFileSync(
          new URL(
            "./fixtures/schema-before-first-signers.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      for (const name of ["first", "second", "plain", "deleted"])
        await before
          .query("INSERT INTO signers (name, email, verified) VALUES (?, ?, 1)")
          .run(name, `${name}@example.org`);
      await before.query("DELETE FROM signers WHERE name = 'deleted'").run();
      await before.close();

      expect(setup()).toContain("Rebuilt the signers table");
      expect(setup()).not.toContain("Rebuilt the signers table");

      const after = await openEncrypted(path);
      try {
        expect(
          await after
            .query(
              "SELECT id, name, email, first_signer AS mark FROM signers ORDER BY id",
            )
            .all(),
        ).toEqual([
          { id: 1, name: "first", email: "first@example.org", mark: 0 },
          { id: 2, name: "second", email: "second@example.org", mark: 0 },
          { id: 3, name: "plain", email: "plain@example.org", mark: 0 },
        ]);
        expect(
          (await after.query("PRAGMA table_info(signers)").all()).find(
            (column) => column.name === "email",
          ).notnull,
        ).toBe(0);
        const { id } = await after
          .query(
            "INSERT INTO signers (name, verified, newsletter) VALUES ('By hand', 1, 0) RETURNING id",
          )
          .get();
        // The deleted signature's id is not handed out again.
        expect(id).toBe(5);
        await expect(
          after
            .query(
              "INSERT INTO signers (name, verified, newsletter) VALUES ('Mailable', 1, 1)",
            )
            .run(),
        ).rejects.toThrow(/CHECK/);
        // A position goes with its signature.
        await after
          .query(
            "INSERT INTO first_signer_pins (signer_id, position) VALUES (1, 1), (2, 2)",
          )
          .run();
        await after.query("DELETE FROM signers WHERE id = 1").run();
        expect(
          await after.query("SELECT signer_id FROM first_signer_pins").all(),
        ).toEqual([{ signer_id: 2 }]);
      } finally {
        await after.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
