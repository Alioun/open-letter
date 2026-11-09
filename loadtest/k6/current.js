// Current end-to-end workload: visitors, search, signatures, admin reads and a
// ten-recipient campaign. The runner verifies persistence and mail afterward.
import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { pageLoad, poll, search, signup } from "./actions.js";
import { BASE, ipFor } from "./lib.js";

const duration = `${__ENV.HOLD || 60}s`;
const token = __ENV.ADMIN_TOKEN;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
export const options = {
  scenarios: {
    visitors: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.TABS || 1000) / 10,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: 150,
      maxVUs: 150,
      exec: "visitors",
    },
    signatures: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.SIGNUP_RATE || 1),
      timeUnit: "1s",
      duration,
      preAllocatedVUs: 5,
      maxVUs: 30,
      exec: "signatures",
    },
    searches: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: 3,
      maxVUs: 20,
      exec: "searches",
    },
    admin: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "5s",
      duration,
      preAllocatedVUs: 2,
      maxVUs: 10,
      exec: "admin",
    },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate==1"],
    "http_req_duration{scenario:visitors}": ["p(95)<500"],
    "http_req_duration{scenario:signatures}": ["p(95)<1000"],
    "http_req_duration{scenario:admin}": ["p(95)<1000"],
    "http_req_duration{scenario:searches}": ["p(95)<1000"],
    dropped_iterations: ["count==0"],
  },
};

export function setup() {
  const response = http.post(
    `${BASE}/api/admin/campaigns`,
    JSON.stringify({
      request_key: __ENV.RUN_ID,
      template_id: Number(__ENV.TEMPLATE_ID),
      subject: "Local load test",
      send_now: true,
      audience: "selection",
      recipient_ids: JSON.parse(__ENV.RECIPIENT_IDS),
    }),
    { headers },
  );
  if (response.status !== 201)
    throw new Error(
      `Campaign setup failed: ${response.status} ${response.body}`,
    );
}
export function visitors() {
  const n = exec.scenario.iterationInTest;
  const ip = ipFor(1 + (n % Number(__ENV.TABS || 1000)));
  const tags = { name: "visitor" };
  if (n % 10 === 0) pageLoad(ip, tags);
  else poll(ip, tags);
}
export function signatures() {
  signup({ name: "signup" });
}
export function searches() {
  search(ipFor(3_000_000 + exec.scenario.iterationInTest), { name: "search" });
}
export function admin() {
  const responses = http.batch(
    ["stats", "campaigns", "email", "statistics", "publication"].map((path) => [
      "GET",
      `${BASE}/api/admin/${path}`,
      null,
      { headers, tags: { name: `/api/admin/${path}` } },
    ]),
  );
  check(responses, {
    "admin reads succeed": (all) =>
      all.every((r) => r.status === 200 && r.body.length > 2),
  });
}
