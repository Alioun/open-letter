// SQLCipher connections use @journeyapps/sqlcipher through N-API.
// On Bun Linux, bun:sqlite ignores setCustomSQLite(), so PRAGMA key alone
// would not encrypt the database. Check cipher_version after applying the key.
//
// The callback-based driver is wrapped in promises:
//   query(sql).get(...params), .all(...params), and .run(...params)
//   run(sql, ...params), exec(sql), loadExtension(path), and close()
// Await every database call. Apply PRAGMA key before any other statement.
import sqlite3 from "@journeyapps/sqlcipher";
import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";
import "./env.js";

export const DB_PATH = process.env.DATABASE_PATH || "./data/diaetendeckel.db";
const DB_JOURNAL_MODE = (process.env.DATABASE_JOURNAL_MODE || "WAL")
  .trim()
  .toUpperCase();
const SUPPORTED_JOURNAL_MODES = new Set([
  "DELETE",
  "WAL",
  "TRUNCATE",
  "PERSIST",
  "MEMORY",
  "OFF",
]);
if (!SUPPORTED_JOURNAL_MODES.has(DB_JOURNAL_MODE)) {
  throw new Error(
    `Unsupported DATABASE_JOURNAL_MODE: ${DB_JOURNAL_MODE}. ` +
      `Supported modes are: ${[...SUPPORTED_JOURNAL_MODES].join(", ")}`,
  );
}

function requireKey(key) {
  const k = key ?? process.env.DATABASE_ENCRYPTION_KEY ?? "";
  if (!k) {
    throw new Error(
      "Set DATABASE_ENCRYPTION_KEY before opening the SQLCipher database.",
    );
  }
  return k;
}

// Adapt node-sqlite3 to the promise-based query API. Query objects can be reused.

// Callback fired after any statement that changes rows, so the server's read
// cache (server/cache.js) can drop stale entries. Registered by server/db.js;
// unset for setup/seed/migration, where nothing is cached.
let mutationHook = null;
export function onMutation(fn) {
  mutationHook = fn;
}
const MUTATION_RE = /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i;

// A write that provably cannot change any public response marks itself with
// this comment and is skipped (see PUBLIC_NEUTRAL in server/db.js). The marker
// lives in the statement text rather than in a flag around the call because
// requests interleave at every await: a time-scoped flag set by one request
// would swallow another request's invalidation.
const PUBLIC_NEUTRAL_RE = /\/\* public-neutral \*\//;

const PRIVATE_TABLES =
  /^(?:email_(?:attempts|quota|configuration)|publication(?:s|_assets|_asset_lifetimes|_asset_references)|analytics_\w+|zoom_pending|deletion_requests|mailing_deliveries|_honker_\w+)$/;
function neutralMutation(sql) {
  if (!PUBLIC_NEUTRAL_RE.test(sql)) return false;
  const plain = sql.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (plain.replace(/;\s*$/, "").includes(";")) return false;
  const table =
    /^(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(\w+)/i.exec(
      plain,
    )?.[1];
  if (table && PRIVATE_TABLES.test(table)) return true;
  if (table !== "signers") return false;
  if (/^INSERT/i.test(plain)) {
    const columns = /\(([^)]+)\)\s*VALUES/i.exec(plain)?.[1] || "";
    return !/\bverified\b/i.test(columns) && Boolean(columns);
  }
  if (/^UPDATE/i.test(plain)) {
    const assignments = /\bSET\s+([\s\S]+?)\s+WHERE\b/i.exec(plain)?.[1] || "";
    return (
      Boolean(assignments) &&
      !/\b(?:name|verified|newsletter|show_publicly|state|kreisverband|occupation)\s*=/i.test(
        assignments,
      )
    );
  }
  return false;
}
function noteMutation(sql) {
  if (!mutationHook) return;
  const plain = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  if (!MUTATION_RE.test(plain) || neutralMutation(sql)) return;
  mutationHook();
}

const transactionOwnership = new AsyncLocalStorage();
export function inDatabaseTransaction() {
  return Boolean(transactionOwnership.getStore()?.active);
}

const databaseQueues = new Map();
const databaseOwnership = new AsyncLocalStorage();

// A read transaction cannot upgrade its snapshot after another connection
// commits. Keep complete transactions and Honker's write functions in one
// queue per database file, including work from the analytics connection.
function databaseOperation(path, operation) {
  const ownership = databaseOwnership.getStore();
  if (ownership?.get(path)?.active) return operation();
  const previous = databaseQueues.get(path) || Promise.resolve();
  const next = previous.then(async () => {
    const lease = { active: true };
    const owned = new Map(ownership);
    owned.set(path, lease);
    try {
      return await databaseOwnership.run(owned, operation);
    } finally {
      lease.active = false;
    }
  });
  databaseQueues.set(
    path,
    next.catch(() => {}),
  );
  return next;
}

function wrap(raw, path) {
  // Finish each statement, including its cursor finalization, before starting
  // another on this handle. Honker writes cannot run beside RETURNING cursors.
  raw.serialize();
  // Calling into the driver after close() aborts the process at the NAPI layer
  // rather than raising a catchable error, so anything still in flight at
  // shutdown (a cache refresh, a job handler) must be rejected here instead.
  let closed = false;
  const ifOpen = (fn) => {
    const owner = transactionOwnership.getStore();
    if (owner?.active && owner.path === path && owner.raw !== raw)
      return Promise.reject(
        new Error("Use the transaction's connection for every statement"),
      );
    return databaseOperation(path, () =>
      closed
        ? Promise.reject(new Error("database connection is closed"))
        : new Promise(fn),
    );
  };

  const stmt = (sql) => ({
    // get/all also carry mutations: writes with a RETURNING clause read back
    // their row through them. Consume the cursor to SQLITE_DONE before
    // releasing the database queue, including for a single-row result.
    get: (...params) =>
      ifOpen((resolve, reject) =>
        raw.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          noteMutation(sql);
          return resolve(rows[0]);
        }),
      ),
    all: (...params) =>
      ifOpen((resolve, reject) =>
        raw.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          noteMutation(sql);
          return resolve(rows);
        }),
      ),
    run: (...params) =>
      ifOpen((resolve, reject) =>
        raw.run(sql, params, function (err) {
          // `this` carries lastID / changes (node-sqlite3 RunResult).
          if (err) return reject(err);
          noteMutation(sql);
          return resolve(this);
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
        ? ifOpen((resolve, reject) =>
            raw.run(sql, args, function (err) {
              if (err) return reject(err);
              noteMutation(sql);
              return resolve(this);
            }),
          )
        : ifOpen((resolve, reject) =>
            raw.exec(sql, (err) => {
              if (err) reject(err);
              else {
                noteMutation(sql);
                resolve();
              }
            }),
          ),
    exec: (sql) =>
      ifOpen((resolve, reject) =>
        raw.exec(sql, (err) => {
          if (err) reject(err);
          else {
            noteMutation(sql);
            resolve();
          }
        }),
      ),
    loadExtension: (extensionPath) =>
      ifOpen((resolve, reject) =>
        raw.loadExtension(extensionPath, (err) =>
          err ? reject(err) : resolve(),
        ),
      ),
    close: () =>
      databaseOperation(
        path,
        () =>
          new Promise((resolve, reject) => {
            closed = true;
            raw.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    transaction(fn, { immediate = false } = {}) {
      if (inDatabaseTransaction())
        return Promise.reject(
          new Error(
            "Join the existing transaction instead of nesting transactions",
          ),
        );
      return databaseOperation(path, async () => {
        await this.run(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
        try {
          const lease = { active: true, path, raw };
          let result;
          try {
            result = await transactionOwnership.run(lease, fn);
          } finally {
            lease.active = false;
          }
          await this.run("COMMIT");
          return result;
        } catch (err) {
          await this.run("ROLLBACK").catch(() => {});
          throw err;
        }
      });
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
      "SQLCipher is not active. PRAGMA cipher_version returned no version. The driver is " +
        "not SQLCipher-enabled. Refusing to open the database.",
    );
  }
  await database.run(`PRAGMA journal_mode = ${DB_JOURNAL_MODE}`);
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
      const database = wrap(raw, resolvePath(path));
      applyKeyAndPragmas(database, key).then(
        () => resolve(database),
        async (e) => {
          await database.close().catch(() => {});
          reject(e);
        },
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
