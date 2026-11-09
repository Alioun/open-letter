import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = mkdtempSync(
  join(process.env.TMPDIR || "/tmp", "openletter-migration-verification-"),
);
console.log("Migration verification evidence: " + artifacts);
const source = resolve(process.argv[2] || repository);
const temp = mkdtempSync(join(artifacts, "fixture-"));
const copy = join(temp, "source");
mkdirSync(join(copy, "db"), { recursive: true });
mkdirSync(join(temp, "empty-init"));
const sourceHashes = {};
for (const file of [
  "db/migrate-pg-to-sqlite.js",
  "db/connection.js",
  "db/schema.sql",
]) {
  copyFileSync(join(source, file), join(copy, file));
  sourceHashes[file] = createHash("sha256")
    .update(readFileSync(join(source, file)))
    .digest("hex");
}
writeFileSync(join(copy, "package.json"), '{"type":"module"}');
symlinkSync(join(source, "node_modules"), join(copy, "node_modules"), "dir");
const container = "openletter-migration-review-" + randomUUID().slice(0, 12);
const pgImage = process.env.MIGRATION_PG_IMAGE || "imresamu/postgis:18-3.6";
const minimalEnv = {
  PATH: process.env.PATH,
  NODE_ENV: "test",
  DATABASE_ENCRYPTION_KEY: "synthetic-migration-key-20261109",
  DATABASE_PATH: join(temp, "unused.db"),
};
const results = [];
let sql;
async function command(
  args,
  { env = process.env, allowFailure = false, name, stdin } = {},
) {
  const p = Bun.spawn(args, {
    cwd: copy,
    env,
    stdout: "pipe",
    stderr: "pipe",
    ...(stdin && { stdin: new TextEncoder().encode(stdin) }),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  const record = { code, stdout, stderr };
  if (name)
    writeFileSync(
      join(artifacts, name + ".json"),
      JSON.stringify(record, null, 2),
    );
  if (code && !allowFailure)
    throw new Error(args.slice(0, 3).join(" ") + ": " + stderr);
  return record;
}
async function migration(database, target, name) {
  return command([process.execPath, "db/migrate-pg-to-sqlite.js"], {
    env: {
      ...minimalEnv,
      SOURCE_DATABASE_URL: sourceUrl(database),
      DATABASE_PATH: target,
    },
    allowFailure: true,
    name,
  });
}
const inspector = join(temp, "inspect.mjs");
writeFileSync(
  inspector,
  `import {db} from './source/db/connection.js';\nconst input=JSON.parse(process.env.INSPECT_SQL);\nlet result;\ntry {result=await db.query(input.sql).all(...(input.params||[])); console.log(JSON.stringify({result}));} catch(error) {console.log(JSON.stringify({error:error.message}));process.exitCode=1;}\nawait db.close();\n`,
);
async function inspect(target, query, params = []) {
  const r = await command([process.execPath, inspector], {
    env: {
      ...minimalEnv,
      DATABASE_PATH: target,
      INSPECT_SQL: JSON.stringify({ sql: query, params }),
    },
    allowFailure: true,
  });
  assert.equal(r.code, 0, r.stderr + " " + r.stdout);
  return JSON.parse(r.stdout).result;
}
const sourceUrl = (database) =>
  `postgres://migration:fixture-only@127.0.0.1:${port}/${database}?sslmode=disable`;
let port;
async function check(name, operation) {
  try {
    const evidence = await operation();
    const result = { name, passed: true, evidence };
    results.push(result);
    console.log("PASS " + name + " " + JSON.stringify(evidence));
  } catch (error) {
    const result = {
      name,
      passed: false,
      error: error.message,
      stack: error.stack,
    };
    results.push(result);
    console.log("FAIL " + name + " " + error.message);
  }
}
async function createDatabase(
  name,
  { omit = [], empty = false, nullable = false } = {},
) {
  await sql.unsafe(`CREATE DATABASE ${name}`);
  const { default: postgres } = await import(
    join(copy, "node_modules/postgres/src/index.js")
  );
  const connection = postgres(sourceUrl(name), { ssl: false });
  let schema = readFileSync(
    join(repository, "test/fixtures/migration-postgres.sql"),
    "utf8",
  );
  await connection.unsafe(schema);
  await connection.unsafe(`ALTER TABLE campaigns ADD COLUMN i18n JSONB;`);
  if (!empty) {
    await connection.unsafe(`
      INSERT INTO email_templates(id,slug,name,subject,html_body,updated_at) VALUES
      (17,'newsletter-fixture','Fixture','Hello','<p>hello</p>','2026-11-09T10:05:06.789+02'),
      (63,'newsletter-extra','Extra','Second','<p>second</p>',NULL);
      INSERT INTO signers(id,name,email,newsletter,show_publicly,verified,occupation,state,created_at,token_expires_at) VALUES
      (41,'Änne Müller','anne@fixture.test',true,false,true,'Lehrerin','Bayern','2026-11-09T10:05:06.789+02',NULL),
      (99,'Null Dates','null@fixture.test',false,true,false,NULL,'',NULL,'2026-11-10T01:02:03+05:30');
      INSERT INTO campaigns(id,template_id,subject,scheduled_at,sent_at,status,recipient_count,audience,sent_offset,recipient_ids,i18n,created_at) VALUES
      (23,17,'Selection','2026-11-10T14:01:02.345+01',NULL,'scheduled',2,'selection',0,ARRAY[41,99],'{"de":{"templateId":17,"subject":"Grüße"}}','2026-11-09T08:05:06.789Z'),
      (55,63,'Empty selection','2026-11-11T00:00:00Z','2026-11-11T00:01:00Z','sent',0,'selection',0,ARRAY[]::integer[],NULL,'2026-11-09T08:05:06.789Z'),
      (88,NULL,'No template','2026-11-12T00:00:00Z',NULL,'cancelled',NULL,'newsletter',0,NULL,NULL,'2026-11-09T08:05:06.789Z');
      INSERT INTO zoom_registrations(id,name,email,kreisverband,delegierter,created_at,unsubscribe_token) VALUES(71,'Meet Person','meet@fixture.test','München',true,'2026-11-09T08:05:06.789Z','fixture-zoom-token');
      INSERT INTO zoom_event_mailings(kind,status,recipient_count,sent_at,updated_at) VALUES('link','sent',1,'2026-11-09T08:05:06.789Z','2026-11-09T08:05:06.789Z');
      INSERT INTO app_settings(key,value,updated_at) VALUES('fixture','{"ok":true}',NULL);
      INSERT INTO kv_state_cache(kreisverband,state,source,resolved_at) VALUES('München','Bayern','fixture','2026-11-09T08:05:06.789Z');
      INSERT INTO kv_not_typo(canonical,outlier,created_at) VALUES('Berlin','Berln','2026-11-09T08:05:06.789Z');
      INSERT INTO occupation_not_typo(canonical,outlier,created_at) VALUES('Lehrer','Lerer','2026-11-09T08:05:06.789Z');
    `);
  }
  if (nullable)
    await connection.unsafe(
      `UPDATE signers SET newsletter=NULL,show_publicly=NULL,verified=NULL WHERE id=99`,
    );
  for (const table of omit) await connection.unsafe(`DROP TABLE ${table}`);
  await connection.end();
}
try {
  await command(
    [
      "docker",
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "-e",
      "POSTGRES_USER=migration",
      "-e",
      "POSTGRES_PASSWORD=fixture-only",
      "-e",
      "POSTGRES_DB=migration",
      "-e",
      "POSTGRES_INITDB_ARGS=--no-sync",
      "--mount",
      `type=bind,source=${join(temp, "empty-init")},target=/docker-entrypoint-initdb.d,readonly`,
      "-p",
      "127.0.0.1::5432",
      pgImage,
    ],
    { name: "container-start" },
  );
  const metadata = JSON.parse(
    (await command(["docker", "inspect", container])).stdout,
  )[0];
  port = metadata.NetworkSettings.Ports["5432/tcp"][0].HostPort;
  for (let i = 0; i < 120; i++) {
    const ready = await command(
      [
        "docker",
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "migration",
        "-d",
        "migration",
      ],
      { allowFailure: true },
    );
    if (!ready.code) break;
    if (i === 119) throw new Error("PostgreSQL did not become ready");
    await Bun.sleep(500);
  }
  const { default: postgres } = await import(
    join(copy, "node_modules/postgres/src/index.js")
  );
  sql = postgres(sourceUrl("migration"), { ssl: false });
  const version =
    await sql`SELECT version(), current_setting('server_version_num') AS num`;
  assert(Number(version[0].num) >= 180000 && Number(version[0].num) < 190000);
  writeFileSync(
    join(artifacts, "environment.json"),
    JSON.stringify(
      {
        bun: Bun.version,
        postgres: version,
        client: JSON.parse(
          readFileSync(join(copy, "node_modules/postgres/package.json")),
        ).version,
        driver: JSON.parse(
          readFileSync(
            join(copy, "node_modules/@journeyapps/sqlcipher/package.json"),
          ),
        ).version,
        image: metadata.Image,
        container,
        source,
        sourceHashes,
      },
      null,
      2,
    ),
  );
  await createDatabase("valid");
  const validTarget = join(temp, "valid.db");
  await check(
    "migration succeeds with real PostgreSQL18 and postgres4",
    async () => {
      const r = await migration("valid", validTarget, "valid-first");
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert(r.stdout.includes("migration complete"));
      return { code: r.code };
    },
  );
  await check(
    "IDs booleans timestamps arrays JSON and null values survive",
    async () => {
      const rows = await inspect(
        validTarget,
        "SELECT * FROM signers ORDER BY id",
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].id, 41);
      assert.equal(rows[0].name, "Änne Müller");
      assert.equal(rows[0].newsletter, 1);
      assert.equal(rows[0].show_publicly, 0);
      assert.equal(rows[0].verified, 1);
      assert.equal(rows[0].created_at, "2026-11-09T08:05:06.789Z");
      assert.equal(rows[0].token_expires_at, null);
      assert.equal(rows[1].occupation, null);
      assert.equal(rows[1].created_at, null);
      assert.equal(rows[1].token_expires_at, "2026-11-09T19:32:03.000Z");
      const campaigns = await inspect(
        validTarget,
        "SELECT * FROM campaigns ORDER BY id",
      );
      assert.deepEqual(
        campaigns.map((r) => r.id),
        [23, 55, 88],
      );
      assert.equal(campaigns[0].template_id, 17);
      assert.deepEqual(JSON.parse(campaigns[0].recipient_ids), [41, 99]);
      assert.deepEqual(JSON.parse(campaigns[0].i18n), {
        de: { templateId: 17, subject: "Grüße" },
      });
      assert.equal(campaigns[0].scheduled_at, "2026-11-10T13:01:02.345Z");
      assert.equal(campaigns[1].recipient_ids, "[]");
      assert.equal(campaigns[2].recipient_ids, null);
      assert.equal(campaigns[2].i18n, null);
      const zoom = await inspect(
        validTarget,
        "SELECT * FROM zoom_registrations",
      );
      assert.equal(zoom[0].id, 71);
      assert.equal(zoom[0].delegierter, 1);
      return {
        signers: rows.length,
        campaigns: campaigns.length,
        zoom: zoom.length,
      };
    },
  );
  await check("all nine table counts match and foreign keys hold", async () => {
    const counts = {};
    for (const table of [
      "email_templates",
      "campaigns",
      "signers",
      "zoom_registrations",
      "zoom_event_mailings",
      "app_settings",
      "kv_state_cache",
      "kv_not_typo",
      "occupation_not_typo",
    ])
      counts[table] = (
        await inspect(validTarget, `SELECT COUNT(*) AS n FROM ${table}`)
      )[0].n;
    assert.deepEqual(counts, {
      email_templates: 2,
      campaigns: 3,
      signers: 2,
      zoom_registrations: 1,
      zoom_event_mailings: 1,
      app_settings: 1,
      kv_state_cache: 1,
      kv_not_typo: 1,
      occupation_not_typo: 1,
    });
    assert.deepEqual(
      await inspect(validTarget, "PRAGMA foreign_key_check"),
      [],
    );
    const version = (await inspect(validTarget, "PRAGMA cipher_version"))[0]
      .cipher_version;
    assert(version);
    assert.notEqual(
      readFileSync(validTarget).subarray(0, 16).toString(),
      "SQLite format 3\0",
    );
    return { counts, cipher_version: version, header: "not plaintext SQLite" };
  });
  await check(
    "identical rerun preserves referenced templates and campaigns",
    async () => {
      const r = await migration("valid", validTarget, "valid-rerun");
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(
        await inspect(
          validTarget,
          "SELECT id, template_id FROM campaigns ORDER BY id",
        ),
        [
          { id: 23, template_id: 17 },
          { id: 55, template_id: 63 },
          { id: 88, template_id: null },
        ],
      );
      assert.deepEqual(
        await inspect(validTarget, "PRAGMA foreign_key_check"),
        [],
      );
      return { code: r.code };
    },
  );
  await check("new SQLite inserts advance past preserved IDs", async () => {
    const rows = await inspect(
      validTarget,
      `INSERT INTO signers(name,email) VALUES (?,?) RETURNING id`,
      ["After migration", "after@fixture.test"],
    );
    assert.equal(rows[0].id, 100);
    return rows[0];
  });
  await check(
    "row-count mismatch rejects a target with extra rows",
    async () => {
      const r = await migration("valid", validTarget, "count-mismatch");
      assert.notEqual(r.code, 0);
      assert(r.stderr.includes("Row counts differ"), r.stderr);
      return { code: r.code, error: r.stderr.trim() };
    },
  );
  await createDatabase("optional_missing", {
    omit: ["kv_state_cache", "kv_not_typo", "occupation_not_typo"],
  });
  await check("missing optional tables are explicitly skipped", async () => {
    const r = await migration(
      "optional_missing",
      join(temp, "optional.db"),
      "optional-missing",
    );
    assert.equal(r.code, 0, r.stderr);
    for (const t of ["kv_state_cache", "kv_not_typo", "occupation_not_typo"])
      assert(r.stderr.includes(`source table ${t} missing, skipped`));
    return { code: r.code };
  });
  await createDatabase("nullable", { nullable: true });
  await check(
    "nullable booleans from the original schema use destination defaults",
    async () => {
      const target = join(temp, "nullable.db");
      const r = await migration("nullable", target, "nullable-booleans");
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const [row] = await inspect(
        target,
        "SELECT newsletter,show_publicly,verified FROM signers WHERE id=99",
      );
      assert.deepEqual(row, { newsletter: 0, show_publicly: 1, verified: 0 });
      return { code: r.code, defaults: row };
    },
  );
  await createDatabase("empty_valid", { empty: true });
  await check(
    "an empty valid source schema migrates successfully",
    async () => {
      const target = join(temp, "empty-valid.db");
      const r = await migration("empty_valid", target, "empty-valid");
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(
        (await inspect(target, "SELECT COUNT(*) AS n FROM signers"))[0].n,
        0,
      );
      return { code: r.code };
    },
  );
  await check("a wrong target encryption key is rejected", async () => {
    const r = await command([process.execPath, "db/migrate-pg-to-sqlite.js"], {
      env: {
        ...minimalEnv,
        SOURCE_DATABASE_URL: sourceUrl("valid"),
        DATABASE_PATH: validTarget,
        DATABASE_ENCRYPTION_KEY: "wrong-fixture-key",
      },
      allowFailure: true,
      name: "wrong-key",
    });
    assert.notEqual(r.code, 0);
    assert.equal(
      (await inspect(validTarget, "SELECT COUNT(*) AS n FROM signers"))[0].n,
      3,
    );
    return { code: r.code, originalRows: 3 };
  });
  await sql.unsafe("CREATE DATABASE all_missing");
  await check("missing required source tables reject migration", async () => {
    const target = join(temp, "missing.db");
    const r = await migration("all_missing", target, "required-missing");
    assert.notEqual(
      r.code,
      0,
      "Migration reports success for an empty unrelated Postgres database: " +
        r.stdout +
        r.stderr,
    );
    assert(
      !existsSync(target),
      "Wrong source must not create a target database",
    );
    return { code: r.code };
  });
  await sql.unsafe("CREATE DATABASE malformed");
  const malformed = postgres(sourceUrl("malformed"), { ssl: false });
  await malformed.unsafe("CREATE TABLE signers(id INTEGER PRIMARY KEY)");
  await malformed.end();
  await check(
    "an unrelated signers table rejects migration before target creation",
    async () => {
      const target = join(temp, "malformed.db");
      const r = await migration("malformed", target, "malformed-source");
      assert.notEqual(r.code, 0);
      assert(r.stderr.includes("does not match"));
      assert(!existsSync(target));
      return { code: r.code };
    },
  );
  await check(
    "rerun restores source IDs when the target email has a different ID",
    async () => {
      const target = join(temp, "wrong-identities.db");
      assert.equal(
        (await migration("valid", target, "wrong-identities-first")).code,
        0,
      );
      await inspect(target, "UPDATE signers SET id=999 WHERE id=99");
      const r = await migration("valid", target, "wrong-identities-rerun");
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(
        await inspect(target, "SELECT id FROM signers ORDER BY id"),
        [{ id: 41 }, { id: 99 }],
      );
      return { code: r.code };
    },
  );
} finally {
  if (sql) await sql.end();
  await command(["docker", "logs", container], {
    allowFailure: true,
    name: "container-logs",
  });
  const cleanup = await command(
    ["docker", "rm", "--force", "--volumes", container],
    { allowFailure: true, name: "container-cleanup" },
  );
  writeFileSync(
    join(artifacts, "results.json"),
    JSON.stringify(
      {
        sourceHashes,
        results,
        cleanup: { code: cleanup.code, output: cleanup.stdout.trim() },
      },
      null,
      2,
    ),
  );
  rmSync(temp, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.passed);
console.log(
  `${results.length - failed.length} passed, ${failed.length} failed`,
);
if (failed.length) process.exitCode = 1;
