import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, resetDb, addVerifiedSigner, setUnsubToken } from "./helpers.js";
import { HIDE_SIGNER_DETAILS, readErasureLog } from "../db/erasure-log.js";
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

  test("a signer who shows only their name publishes no region, on a letter that asks for name or details", async () => {
    const add = async (name, kreisverband, showDetails) => {
      const signer = await addVerifiedSigner({
        name,
        kreisverband,
        state: kreisverband,
        occupation: "",
      });
      await db
        .query("UPDATE signers SET show_signer_details = ? WHERE id = ?")
        .run(showDetails, signer.id);
    };
    await add("Nur Name", "Berlin", 0);
    await add("Mit Angaben", "Hamburg", 1);
    const regions = async (options = {}) =>
      Object.fromEntries(
        (await q.getSigners({ sort: "asc", ...options })).signers.map(
          (signer) => [signer.name, [signer.kreisverband, signer.state]],
        ),
      );

    await withFeatures(
      { publicSignerDetails: true, kreisverbandField: true },
      async () => {
        expect(await regions()).toEqual({
          "Nur Name": ["", ""],
          "Mit Angaben": ["Hamburg", "Hamburg"],
        });
        // Neither a search for the region nor the "with region" view may
        // give away where a name-only signer is from.
        expect(await regions({ search: "Berlin" })).toEqual({});
        expect(await regions({ search: "berlim" })).toEqual({});
        expect(Object.keys(await regions({ search: "Hamburg" }))).toEqual([
          "Mit Angaben",
        ]);
        expect(Object.keys(await regions({ filter: "kv" }))).toEqual([
          "Mit Angaben",
        ]);
        expect(
          (await q.exportPublicSigners()).map((row) => [
            row.name,
            row.kreisverband,
            row.state,
          ]),
        ).toEqual([
          ["Nur Name", "", ""],
          ["Mit Angaben", "Hamburg", "Hamburg"],
        ]);
      },
    );

    // A letter with one checkbox, "my name (and region) may be shown", keeps
    // showing the region with every public name.
    await withFeatures(
      { publicSignerDetails: false, kreisverbandField: true },
      async () => {
        expect(await regions()).toEqual({
          "Nur Name": ["Berlin", "Berlin"],
          "Mit Angaben": ["Hamburg", "Hamburg"],
        });
        expect(Object.keys(await regions({ search: "Berlin" }))).toEqual([
          "Nur Name",
        ]);
        expect(Object.keys(await regions({ filter: "kv" }))).toEqual([
          "Nur Name",
          "Mit Angaben",
        ]);
      },
    );
  });

  test("a first signer can take back, and give again, the choice to show their details on their settings page", async () => {
    const first = await person("First", 1);
    const other = await person("Other", 1);
    await db
      .query("UPDATE signers SET first_signer = 1 WHERE id = ?")
      .run(first.id);
    await setUnsubToken(first.id, "first-token");
    await setUnsubToken(other.id, "other-token");
    const settings = (token) =>
      q.getUnifiedUnsubscribeState(token, "newsletter");
    const save = (signer, showSignerDetails) =>
      q.updateSignerByEmail(signer.email, {
        name: signer.name,
        kreisverband: "",
        occupation: "Klinikum",
        newsletter: true,
        showPublicly: true,
        showSignerDetails,
      });
    const stored = async (signer) =>
      (
        await db
          .query("SELECT show_signer_details FROM signers WHERE id = ?")
          .get(signer.id)
      ).show_signer_details;

    // A letter that shows details for first signers only.
    await withFeatures(
      { publicSignerDetails: false, publicFirstSignerDetails: true },
      async () => {
        expect((await settings("first-token")).showSignerDetails).toBe(true);
        expect(await publicList()).toMatchObject({ First: "Sprecherin" });

        await save(first, false);
        expect(await publicList()).toMatchObject({ First: null });
        expect((await settings("first-token")).showSignerDetails).toBe(false);
        // A restored backup must not bring the details back.
        expect((await readErasureLog(db)).map((entry) => entry.kind)).toContain(
          HIDE_SIGNER_DETAILS,
        );

        await save(first, true);
        expect(await publicList()).toMatchObject({ First: "Sprecherin" });

        // Nobody else's details are public on this letter, so they are not
        // asked, and saving their settings changes nothing about them.
        expect(await settings("other-token")).not.toHaveProperty(
          "showSignerDetails",
        );
        await save(other, false);
        expect(await stored(other)).toBe(1);
      },
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
