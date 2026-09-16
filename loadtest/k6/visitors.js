// Concurrent open tabs. An open tab polls stats + signers every 10 s, so it
// produces 0.1 "ticks" per second; 1 tick/s ≈ 10 open tabs. The rate climbs in
// steps and each step is labelled with its tab count.
//
// Each tick is a poll, or (LOAD_SHARE, default 10%) a fresh page load.
// MIX=1 adds sign-ups (SIGNUP_RATE/s) and searches (SEARCH_RATE/s) on top —
// the "letter went viral" case.
//
// Env: TABS="50,200,500,1000,2000,4000" HOLD=60 RAMP=10
import { pageLoad, poll, search, signup } from "./actions.js";
import { ipFor, staircase, stepLabel, stepThresholds } from "./lib.js";

const TABS = (__ENV.TABS || "50,200,500,1000,2000,4000").split(",").map(Number);
const HOLD = Number(__ENV.HOLD || 60);
const RAMP = Number(__ENV.RAMP || 10);
const LOAD_SHARE = Number(__ENV.LOAD_SHARE || 0.1);
const MIX = __ENV.MIX === "1";

const { stages, steps } = staircase(TABS.map((t) => t / 10), HOLD, RAMP);
// Label steps by tab count rather than tick rate.
for (const s of steps) if (s.label !== "ramp") s.label = String(Number(s.label) * 10);
const totalS = steps[steps.length - 1].until;

const scenarios = {
  tabs: {
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 1500,
    stages,
    exec: "tabs",
  },
};
if (MIX) {
  scenarios.signups = {
    executor: "constant-arrival-rate",
    rate: Number(__ENV.SIGNUP_RATE || 2),
    timeUnit: "1s",
    duration: `${totalS}s`,
    preAllocatedVUs: 10,
    maxVUs: 300,
    exec: "signups",
  };
  scenarios.searches = {
    executor: "constant-arrival-rate",
    rate: Number(__ENV.SEARCH_RATE || 1),
    timeUnit: "1s",
    duration: `${totalS}s`,
    preAllocatedVUs: 10,
    maxVUs: 300,
    exec: "searches",
  };
}

export const options = {
  scenarios,
  discardResponseBodies: false,
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  thresholds: {
    // Stop once the server is clearly overwhelmed; later steps would only be worse.
    http_req_duration: [{ threshold: "p(95)<3000", abortOnFail: true, delayAbortEval: "20s" }],
    http_req_failed: [{ threshold: "rate<0.2", abortOnFail: true, delayAbortEval: "20s" }],
    ...stepThresholds(steps, ["http_req_duration", "http_req_failed", "http_reqs"]),
  },
};

export function tabs() {
  const step = stepLabel(steps);
  const tags = { step };
  // Spread ticks over as many client IPs as there are simulated tabs.
  const pool = Math.max(1, Number(step) || TABS[0]);
  const ip = ipFor(1 + Math.floor(Math.random() * pool));
  if (Math.random() < LOAD_SHARE) pageLoad(ip, tags);
  else poll(ip, tags);
}

export function signups() {
  signup({ step: stepLabel(steps) });
}

export function searches() {
  search(ipFor(3_000_000 + Math.floor(Math.random() * 5000)), { step: stepLabel(steps) });
}
