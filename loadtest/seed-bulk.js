// Bulk seeder for load tests: inserts N signers into the (encrypted) database in
// batched transactions. ~95% verified, ~70% newsletter, Kreisverbände taken from
// the local KV→state map with `state` pre-filled so the Nominatim worker has
// nothing to backfill (no external calls during a run).
//
//   bun loadtest/seed-bulk.js 100000
//
// Run against a stopped app (docker compose run --rm app bun loadtest/seed-bulk.js N).
import { readFileSync } from "fs";
import { db, nowIso } from "../db/connection.js";

const N = parseInt(process.argv[2] || "1000", 10);
const BATCH = 1000;

const VORNAMEN = [
  "Linnea","Jonas","Mahsa","Kerem","Sebastian","Anna-Lena","Mira","Tobias","Cem","Helena",
  "Paul","Yusra","Frieda","Lukas","Selma","Theo","Nora","Ben","Leyla","Jakob","Sophie",
  "Mats","Carla","Aaron","Pia","Henning","Esra","Mathilda","Niklas","Saskia","Erik",
  "Hannah","Felix","Bahar","Lena","Malte","Lilly","Tim","Greta","Yannick","Inga","Davide",
];
const NACHNAMEN = [
  "Berger","Klein","Wagner","Demir","Yıldız","Schulze","Hoffmann","Becker","Özdemir","Krüger",
  "Hartmann","Werner","Schmidt","Bauer","Lange","Richter","Vogel","Kowalski","Neumann","Fischer",
  "Weber","Meyer","Pohl","Schuster","Fuchs","Reich","Brandt","Lemke","Kraus","Schäfer","Albers",
];
const OCCUPATIONS = [
  "Pflegekraft","Lehrerin","Lehrer","Erzieherin","Softwareentwickler","Student","Studentin",
  "Rentner","Rentnerin","Busfahrer","Ärztin","Sozialarbeiterin","Verkäuferin","Elektriker",
  "Ingenieurin","Journalist","Kassiererin","Handwerker","Doktorandin","Arbeitslos",
];

// Pull the plain string entries out of server/states.js (the map isn't exported).
const statesSrc = readFileSync(new URL("../server/states.js", import.meta.url), "utf-8");
const KVS = [...statesSrc.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

await db.run(await Bun.file(new URL("../db/schema.sql", import.meta.url)).text());

const start = Date.now();
const spanMs = 60 * 24 * 60 * 60 * 1000; // spread over the last 60 days
const cols = 8;
const runId = Date.now().toString(36);

for (let done = 0; done < N; done += BATCH) {
  const n = Math.min(BATCH, N - done);
  const values = [];
  const params = [];
  for (let i = 0; i < n; i++) {
    const idx = done + i;
    const hasKv = Math.random() < 0.85;
    const [kv, state] = hasKv ? pick(KVS) : ["", ""];
    const verified = Math.random() < 0.95 ? 1 : 0;
    const newsletter = Math.random() < 0.7 ? 1 : 0;
    const created = new Date(Date.now() - Math.random() * spanMs).toISOString();
    values.push(`(${new Array(cols).fill("?").join(",")})`);
    params.push(
      `${pick(VORNAMEN)} ${pick(NACHNAMEN)}`,
      `seed-${runId}-${idx}@load.test`,
      kv,
      state,
      Math.random() < 0.6 ? pick(OCCUPATIONS) : "",
      newsletter,
      verified,
      created,
    );
  }
  await db.transaction(() =>
    db
      .query(
        `INSERT INTO signers (name, email, kreisverband, state, occupation, newsletter, verified, created_at)
         VALUES ${values.join(",")}`,
      )
      .run(...params),
  );
}

// Unsubscribe tokens for newsletter subscribers, as real sign-ups would have.
await db.run(
  `UPDATE signers SET unsubscribe_token = lower(hex(randomblob(16))), unsubscribe_token_created_at = ?
   WHERE newsletter = 1 AND unsubscribe_token IS NULL`,
  nowIso(),
);

const { total } = await db.query("SELECT COUNT(*) AS total FROM signers").get();
console.log(`seeded ${N} signers in ${((Date.now() - start) / 1000).toFixed(1)}s (table now ${total})`);
await db.close();
