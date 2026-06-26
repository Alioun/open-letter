import { db, nowIso } from "./connection.js";

const VORNAMEN = [
  "Linnea","Jonas","Mahsa","Kerem","Sebastian","Anna-Lena","Mira","Tobias","Cem","Helena",
  "Paul","Yusra","Frieda","Lukas","Selma","Theo","Nora","Ben","Leyla","Jakob","Sophie",
  "Mats","Carla","Aaron","Pia","Henning","Esra","Mathilda","Niklas","Saskia","Erik",
  "Hannah","Felix","Bahar","Lena","Malte","Lilly","Tim","Greta","Yannick","Inga","Davide",
  "Antonia","Robin","Khaled","Marie","Levin","Ronja","Jelena","Hendrik","Cosima","Florian","Sina",
];

const NACHNAMEN = [
  "Berger","Klein","Wagner","Demir","Yıldız","Schulze","Hoffmann","Becker","Özdemir","Krüger",
  "Hartmann","Werner","Schmidt","Bauer","Lange","Richter","Vogel","Kowalski","Neumann","Fischer",
  "Weber","Meyer","Pohl","Schuster","Fuchs","Reich","Brandt","Lemke","Kraus","Schäfer","Albers",
  "Voigt","Petrov","Nowak","Engel","Kohl","Roth","Pham","Park","Nguyen","Heller","Sommer","Mai",
];

const KVS = [
  "Berlin-Mitte","Berlin-Neukölln","Berlin-Friedrichshain-Kreuzberg","Hamburg-Altona","Hamburg-Mitte",
  "Leipzig","Dresden","Köln","Düsseldorf","Frankfurt am Main","München","Stuttgart","Bremen",
  "Hannover","Nürnberg","Rostock","Erfurt","Magdeburg","Kiel","Saarbrücken","Mainz","Potsdam",
  "Aachen","Bonn","Karlsruhe","Freiburg","Heidelberg","Halle (Saale)","Jena","Chemnitz",
  "Dortmund","Essen","Duisburg","Münster","Göttingen","Kassel","Tübingen","Konstanz",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeSigner(minutesAgo) {
  const name = pick(VORNAMEN) + " " + pick(NACHNAMEN);
  const kv = Math.random() < 0.85 ? pick(KVS) : "";
  const email = name.toLowerCase().replace(/\s+/g, ".").replace(/[äöüß]/g, c => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c] || c)) + "+" + Date.now() + Math.random().toString(36).slice(2, 6) + "@demo.local";
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  return { name, email, kv, createdAt };
}

const INITIAL_COUNT = 200;
const TRICKLE_INTERVAL_MS = 6000;

console.log(`Seeding ${INITIAL_COUNT} verified signers...`);

const batch = [];
for (let i = 0; i < INITIAL_COUNT; i++) {
  const minutesAgo = Math.floor(i * i * 0.4 + i * 3 + 2);
  batch.push(makeSigner(minutesAgo));
}

const insert = db.query(
  `INSERT INTO signers (name, email, kreisverband, newsletter, verified, created_at)
   VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (email) DO NOTHING`,
);

for (const s of batch) {
  await insert.run(s.name, s.email, s.kv, Math.random() > 0.3 ? 1 : 0, s.createdAt.toISOString());
}

console.log(`Seeded ${INITIAL_COUNT} signers.`);
console.log(`Trickling new signers every ${TRICKLE_INTERVAL_MS / 1000}s — press Ctrl+C to stop.\n`);

setInterval(async () => {
  const s = makeSigner(0);
  await insert.run(s.name, s.email, s.kv, Math.random() > 0.3 ? 1 : 0, nowIso());
  console.log(`+ ${s.name}${s.kv ? ` (KV ${s.kv})` : ""}`);
}, TRICKLE_INTERVAL_MS);
