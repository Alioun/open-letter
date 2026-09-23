import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { BASE, ipFor, sessionToken } from "./lib.js";

let assetPaths = null;

// A new visitor opening the page: HTML + bundle, token, then the same API calls
// src/App.jsx makes on mount (stats + signers in parallel, zoom count, KV and
// occupation lists).
export function pageLoad(ip, tags) {
  const html = http.get(`${BASE}/`, { headers: { "X-Real-IP": ip }, tags: { ...tags, name: "/" } });
  check(html, { "page 200": (r) => r.status === 200 });
  if (assetPaths === null && html.status === 200) {
    assetPaths = [...String(html.body).matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  }
  if (assetPaths && assetPaths.length) {
    http.batch(
      assetPaths.map((p) => ["GET", `${BASE}${p}`, null, { responseType: "none", tags: { ...tags, name: "asset" } }]),
    );
  }
  const token = sessionToken(ip, tags);
  const params = (name) => ({ headers: { "X-Real-IP": ip, "X-Api-Token": token }, tags: { ...tags, name } });
  const rs = http.batch([
    ["GET", `${BASE}/api/stats`, null, params("/api/stats")],
    ["GET", `${BASE}/api/signers?filter=alle&search=&limit=18&offset=0&sort=asc`, null, params("/api/signers")],
    ["GET", `${BASE}/api/zoom-count`, null, params("/api/zoom-count")],
  ]);
  const rs2 = http.batch([
    ["GET", `${BASE}/api/kreisverband-stats`, null, params("/api/kreisverband-stats")],
    ["GET", `${BASE}/api/occupations`, null, params("/api/occupations")],
  ]);
  check([...rs, ...rs2], { "api 200": (all) => all.every((r) => r.status === 200) });
}

// The 10-second poll every visible tab runs.
export function poll(ip, tags) {
  const token = sessionToken(ip, tags);
  const params = (name) => ({ headers: { "X-Real-IP": ip, "X-Api-Token": token }, tags: { ...tags, name } });
  const rs = http.batch([
    ["GET", `${BASE}/api/stats`, null, params("/api/stats")],
    ["GET", `${BASE}/api/signers?filter=alle&search=&limit=18&offset=0&sort=asc`, null, params("/api/signers")],
  ]);
  check(rs, { "poll 200": (all) => all.every((r) => r.status === 200) });
}

// Someone typing into the signer search box (JS fuzzy scan over all signers).
const TERMS = ["lena", "berlin", "schmidt", "köln", "jonas we", "hamburg", "mira", "fischer"];
export function search(ip, tags) {
  const token = sessionToken(ip, tags);
  const term = TERMS[Math.floor(Math.random() * TERMS.length)];
  const res = http.get(
    `${BASE}/api/signers?filter=alle&search=${encodeURIComponent(term)}&limit=18&offset=0&sort=asc`,
    { headers: { "X-Real-IP": ip, "X-Api-Token": token }, tags: { ...tags, name: "/api/signers?search" } },
  );
  check(res, { "search 200": (r) => r.status === 200 });
}

// A sign-up: DB upsert, unsubscribe token, template render (incl. a newsletter
// stats query), CSS inlining and an SMTP round-trip to Mailpit, all inline.
const KVS = ["Berlin-Neukölln", "Hamburg", "Köln", "Pankow", "Bremen", "Lichtenberg", ""];
export function signup(tags) {
  const n = exec.scenario.iterationInTest;
  const ip = ipFor(2_000_000 + n);
  const res = http.post(
    `${BASE}/api/sign`,
    JSON.stringify({
      name: `Last Test ${n}`,
      email: `lt-${exec.vu.idInTest}-${n}-${Date.now()}@load.test`,
      kv: KVS[n % KVS.length],
      occupation: n % 2 ? "Pflegekraft" : "",
      newsletter: n % 3 !== 0,
      agree: true,
    }),
    { headers: { "Content-Type": "application/json", "X-Real-IP": ip }, tags: { ...tags, name: "/api/sign" } },
  );
  check(res, { "sign 200": (r) => r.status === 200 });
}
