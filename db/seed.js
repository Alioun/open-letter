import { db, nowIso } from "./connection.js";
import cfg from "../config/letter.config.js";
import { regionLabels } from "../config/region.js";

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

// Seed with the letter's fixed regions (e.g. Berlin Bezirke) when it has them.
const REGIONS = regionLabels(cfg).options ?? KVS;

const ORGANISATIONS = [
  "Riverside School","City Library","Tenants' Association","Community Health Centre",
  "Food Bank","Cycling Club","Youth Theatre","Neighbourhood Garden","Student Union",
];

const ROLES = [
  "Teacher","Nurse","Volunteer","Chair","Treasurer","Coordinator","Student","Librarian","Organiser",
];

// Shown above everyone else in the default list view, in this order. Their
// role and organisation appear only when the letter publishes them
// (features.publicSignerDetails or publicFirstSignerDetails).
const FIRST_SIGNERS = [
  { name: "Amara Okafor", role: "Director", organisation: "Community Health Centre" },
  { name: "Jonas Lindqvist", role: "Chair", organisation: "Tenants' Association" },
  { name: "Priya Raman", role: "Head teacher", organisation: "Riverside School" },
  { name: "Tomás Ferreira", role: "Coordinator", organisation: "Food Bank" },
];

// Role and organisation only for the fields the letter asks for.
const asksOrganisation = Boolean(cfg.features.occupationField);
const asksRole = Boolean(cfg.sign.fields.signerFunction);

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeSigner(minutesAgo) {
  const name = pick(VORNAMEN) + " " + pick(NACHNAMEN);
  const kv = Math.random() < 0.85 ? pick(REGIONS) : "";
  const email = name.toLowerCase().replace(/\s+/g, ".").replace(/[äöüß]/g, c => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c] || c)) + "+" + Date.now() + Math.random().toString(36).slice(2, 6) + "@demo.local";
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  const organisation = asksOrganisation && Math.random() < 0.5 ? pick(ORGANISATIONS) : "";
  const role = asksRole && Math.random() < 0.5 ? pick(ROLES) : "";
  const showDetails = (organisation || role) && Math.random() < 0.7 ? 1 : 0;
  return { name, email, kv, organisation, role, showDetails, createdAt };
}

const INITIAL_COUNT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRICKLE_INTERVAL_MS = 6000;

console.log(`Seeding ${INITIAL_COUNT} verified signers...`);

const batch = [];
for (let i = 0; i < INITIAL_COUNT; i++) {
  const minutesAgo = Math.floor(i * i * 0.4 + i * 3 + 2);
  batch.push(makeSigner(minutesAgo));
}

const insert = db.query(
  `INSERT INTO signers (name, email, kreisverband, occupation, signer_function, show_signer_details, newsletter, verified, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (email) DO NOTHING`,
);
const insertSigner = (s, createdAt) =>
  insert.run(s.name, s.email, s.kv, s.organisation, s.role, s.showDetails, Math.random() > 0.3 ? 1 : 0, createdAt);

for (const s of batch) {
  await insertSigner(s, s.createdAt.toISOString());
}

console.log(`Seeded ${INITIAL_COUNT} signers.`);

const pin = db.query(
  `INSERT INTO first_signer_pins (signer_id, position)
   SELECT id, ? FROM signers WHERE email = ? ON CONFLICT DO NOTHING`,
);
for (const [i, f] of FIRST_SIGNERS.entries()) {
  const email = `first-signer-${i + 1}@demo.local`;
  const createdAt = new Date(Date.now() - (30 - i) * DAY_MS).toISOString();
  await insertSigner({ ...f, email, kv: "", showDetails: 1 }, createdAt);
  await db.query("UPDATE signers SET first_signer = 1 WHERE email = ?").run(email);
  await pin.run(i + 1, email);
}

console.log(`Marked ${FIRST_SIGNERS.length} first signers.`);
console.log(`Adding a signer every ${TRICKLE_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.\n`);

setInterval(async () => {
  const s = makeSigner(0);
  await insertSigner(s, nowIso());
  console.log(`+ ${s.name}${s.kv ? ` (KV ${s.kv})` : ""}`);
}, TRICKLE_INTERVAL_MS);
