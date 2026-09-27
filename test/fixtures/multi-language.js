// Preload for test/person-lang.test.js: a child process whose letter has
// features.multiLanguage on (de + en), with an English verification template.
// Runs before config/letter.config.js is imported, so the letter is read with
// the flag on. Opens its own throwaway database like test/setup.js.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import letter from "../../config/letters/gehaltsdeckel/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = mkdtempSync(join(tmpdir(), "diaet-lang-test-"));
process.env.DATABASE_PATH = join(tmp, "test.db");
process.env.DATABASE_ENCRYPTION_KEY = "test-encryption-key-123";
process.env.BACKUP_ENCRYPTION_KEY = "test-encryption-key-123";
process.env.HONKER_EXTENSION_PATH ??= join(
  repoRoot,
  process.platform === "darwin"
    ? "vendor/libhonker_ext.dylib"
    : "vendor/libhonker_ext.so",
);

letter.features = { ...letter.features, multiLanguage: true };
letter.languages = ["de", "en"];
letter.i18n = {
  en: {
    email: {
      templates: {
        verification: {
          subject: "Confirm your signature, {{firstName}}",
          htmlBody:
            '<p>Hello {{firstName}}, <a href="{{confirmUrl}}">confirm</a>.</p>',
        },
      },
    },
  },
};

const { db } = await import("../../db/connection.js");
await db.run(readFileSync(join(repoRoot, "db/schema.sql"), "utf-8"));
process.on("exit", () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});
