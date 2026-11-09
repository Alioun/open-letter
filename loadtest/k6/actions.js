import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { BASE, ipFor, sessionToken } from "./lib.js";

let assetPaths = null;
let features = {};
export const acceptedSignups = new Counter("accepted_signups");
export const successfulPageLoads = new Counter("successful_page_loads");

// A new visitor opening the page: HTML + bundle, token, then the same API calls
// src/App.jsx makes on mount (stats + signers in parallel, zoom count, KV and
// occupation lists).
export function pageLoad(ip, tags) {
  const html = http.get(`${BASE}/`, {
    headers: {
      "X-Real-IP": ip,
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36",
    },
    tags: { ...tags, name: "/" },
  });
  check(html, { "page 200": (r) => r.status === 200 });
  if (html.status === 200) successfulPageLoads.add(1);
  if (assetPaths === null && html.status === 200) {
    assetPaths = [
      ...String(html.body).matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g),
    ].map((m) => m[1]);
    const data = String(html.body).match(
      /id="publication-data">([^<]+)<\/script>/,
    );
    if (data) features = JSON.parse(data[1]).config.features;
  }
  if (assetPaths && assetPaths.length) {
    const assets = http.batch(
      assetPaths.map((p) => [
        "GET",
        `${BASE}${p}`,
        null,
        { tags: { ...tags, name: "asset" } },
      ]),
    );
    check(assets, {
      "assets 200": (all) =>
        all.every((r) => r.status === 200 && r.body.length > 0),
    });
  }
  const token = sessionToken(ip, tags);
  const params = (name) => ({
    headers: { "X-Real-IP": ip, "X-Api-Token": token },
    tags: { ...tags, name },
  });
  const rs = http.batch([
    ["GET", `${BASE}/api/stats`, null, params("/api/stats")],
    [
      "GET",
      `${BASE}/api/signers?filter=alle&search=&limit=18&offset=0&sort=asc`,
      null,
      params("/api/signers"),
    ],
    ...(features.zoomEvent
      ? [["GET", `${BASE}/api/zoom-count`, null, params("/api/zoom-count")]]
      : []),
  ]);
  const rs2 = http.batch([
    ...(features.kreisverbandField
      ? [
          [
            "GET",
            `${BASE}/api/kreisverband-stats`,
            null,
            params("/api/kreisverband-stats"),
          ],
        ]
      : []),
    ...(features.occupationField
      ? [["GET", `${BASE}/api/occupations`, null, params("/api/occupations")]]
      : []),
  ]);
  check([...rs, ...rs2], {
    "api 200": (all) => all.every((r) => r.status === 200),
  });
}

// The 10-second poll every visible tab runs.
export function poll(ip, tags) {
  const token = sessionToken(ip, tags);
  const params = (name) => ({
    headers: { "X-Real-IP": ip, "X-Api-Token": token },
    tags: { ...tags, name },
  });
  const rs = http.batch([
    ["GET", `${BASE}/api/stats`, null, params("/api/stats")],
    [
      "GET",
      `${BASE}/api/signers?filter=alle&search=&limit=18&offset=0&sort=asc`,
      null,
      params("/api/signers"),
    ],
  ]);
  check(rs, { "poll 200": (all) => all.every((r) => r.status === 200) });
}

// Someone typing into the signer search box (JS fuzzy scan over all signers).
const TERMS = [
  "lena",
  "berlin",
  "schmidt",
  "köln",
  "jonas we",
  "hamburg",
  "mira",
  "fischer",
];
export function search(ip, tags) {
  const token = sessionToken(ip, tags);
  const term = TERMS[Math.floor(Math.random() * TERMS.length)];
  const res = http.get(
    `${BASE}/api/signers?filter=alle&search=${encodeURIComponent(term)}&limit=18&offset=0&sort=asc`,
    {
      headers: { "X-Real-IP": ip, "X-Api-Token": token },
      tags: { ...tags, name: "/api/signers?search" },
    },
  );
  check(res, { "search 200": (r) => r.status === 200 });
}

// The HTTP response covers the DB write and durable enqueue. The runner checks
// completed SMTP delivery and an empty queue separately after traffic stops.
const KVS = [
  "Berlin-Neukölln",
  "Hamburg",
  "Köln",
  "Pankow",
  "Bremen",
  "Lichtenberg",
  "",
];
export function signup(tags) {
  const n = exec.scenario.iterationInTest;
  const ip = ipFor(2_000_000 + n);
  const res = http.post(
    `${BASE}/api/sign`,
    JSON.stringify({
      name: `Last Test ${n}`,
      email: `lt-${__ENV.RUN_ID || Date.now()}-${exec.vu.idInTest}-${n}@load.test`,
      kv: KVS[n % KVS.length],
      occupation: n % 2 ? "Pflegekraft" : "",
      newsletter: n % 3 !== 0,
      agree: true,
    }),
    {
      headers: { "Content-Type": "application/json", "X-Real-IP": ip },
      tags: { ...tags, name: "/api/sign" },
    },
  );
  const ok = res.status === 200 && res.json("ok") === true;
  check(res, { "sign accepted": () => ok });
  if (ok) acceptedSignups.add(1);
}
