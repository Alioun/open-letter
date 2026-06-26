// Shared SQLCipher-backed database connection.
//
// Encryption at rest is provided by @journeyapps/sqlcipher — a node-sqlite3
// build that statically bundles SQLCipher. `bun:sqlite` cannot be used for this:
// its `Database.setCustomSQLite()` is a silent no-op on Bun's Linux builds (Bun
// statically links its own SQLite), so `PRAGMA key` is ignored and the database
// is left unencrypted. @journeyapps/sqlcipher loads via N-API and works
// identically on macOS and Linux, eliminating that dev/prod skew.
//
// node-sqlite3's API is asynchronous (callbacks), so this module exposes a thin
// promise-returning wrapper whose shape mirrors the old bun:sqlite surface:
//   db.query(sql).get(...params) / .all(...params) / .run(...params)  -> Promise
//   db.run(sql, ...params)   (parameterised single statement)         -> Promise
//   db.run(sql)              (no params; DDL / multi-statement / PRAGMA) -> Promise
//   db.exec(sql) / db.loadExtension(path) / db.close()                 -> Promise
// Every call site therefore `await`s its database access.
//
// `PRAGMA key` MUST be the first statement on every connection; stock SQLite
// would silently ignore it and return an empty `cipher_version`, which we treat
// as a fatal misconfiguration (fail closed).
import sqlite3 from "@journeyapps/sqlcipher";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

export const DB_PATH = process.env.DATABASE_PATH || "./data/diaetendeckel.db";

function requireKey(key) {
  const k = key ?? process.env.DATABASE_ENCRYPTION_KEY ?? "";
  if (!k) {
    throw new Error(
      "DATABASE_ENCRYPTION_KEY is required — the database is encrypted at rest (SQLCipher).",
    );
  }
  return k;
}

// Wrap a raw node-sqlite3 Database in the promise-returning surface used across
// the app. Statement objects returned by `query()` are cheap and may be reused.
function wrap(raw) {
  const stmt = (sql) => ({
    get: (...params) =>
      new Promise((resolve, reject) =>
        raw.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))),
      ),
    all: (...params) =>
      new Promise((resolve, reject) =>
        raw.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))),
      ),
    run: (...params) =>
      new Promise((resolve, reject) =>
        raw.run(sql, params, function (err) {
          // `this` carries lastID / changes (node-sqlite3 RunResult).
          return err ? reject(err) : resolve(this);
        }),
      ),
  });

  return {
    raw,
    query: stmt,
    // Parameterised single statement when args are given; otherwise exec(), which
    // handles bare PRAGMAs, DDL and multi-statement scripts (e.g. schema.sql).
    run: (sql, ...args) =>
      args.length
        ? new Promise((resolve, reject) =>
            raw.run(sql, args, function (err) {
              return err ? reject(err) : resolve(this);
            }),
          )
        : new Promise((resolve, reject) =>
            raw.exec(sql, (err) => (err ? reject(err) : resolve())),
          ),
    exec: (sql) =>
      new Promise((resolve, reject) =>
        raw.exec(sql, (err) => (err ? reject(err) : resolve())),
      ),
    loadExtension: (path) =>
      new Promise((resolve, reject) =>
        raw.loadExtension(path, (err) => (err ? reject(err) : resolve())),
      ),
    close: () =>
      new Promise((resolve, reject) =>
        raw.close((err) => (err ? reject(err) : resolve())),
      ),
    // Minimal async transaction helper (used by the one-shot pg migration).
    async transaction(fn) {
      await this.run("BEGIN");
      try {
        const result = await fn();
        await this.run("COMMIT");
        return result;
      } catch (err) {
        await this.run("ROLLBACK").catch(() => {});
        throw err;
      }
    },
  };
}

// Apply the encryption key + standard pragmas. The key MUST be applied before
// any other statement, and journal_mode only after keying.
export async function applyKeyAndPragmas(database, key) {
  const k = requireKey(key);
  await database.run(`PRAGMA key = '${k.replace(/'/g, "''")}'`);
  const row = await database.query("PRAGMA cipher_version").get();
  if (!row || !row.cipher_version) {
    throw new Error(
      "SQLCipher is not active (empty cipher_version). The database driver is " +
        "not SQLCipher-enabled — encryption at rest cannot be guaranteed.",
    );
  }
  await database.run("PRAGMA journal_mode = WAL");
  await database.run("PRAGMA foreign_keys = ON");
  await database.run("PRAGMA busy_timeout = 5000");
  return database;
}

// Open a fresh encrypted connection to an arbitrary path (used by backup,
// restore and migration which need their own short-lived handles).
export function openEncrypted(path, key) {
  mkdirSync(dirname(path), { recursive: true });
  return new Promise((resolve, reject) => {
    const raw = new sqlite3.Database(path, (err) => {
      if (err) return reject(err);
      const database = wrap(raw);
      applyKeyAndPragmas(database, key).then(
        () => resolve(database),
        (e) => reject(e),
      );
    });
  });
}

// The process-wide shared connection used by the app, setup and seed.
export const db = await openEncrypted(DB_PATH);

export function nowIso() {
  return new Date().toISOString();
}

// ISO-8601 string for a moment `ms` milliseconds in the past (replaces
// Postgres `NOW() - INTERVAL '…'`). ISO-8601 UTC strings compare correctly
// with lexicographic `>` since all stored timestamps use the same format.
export function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}
