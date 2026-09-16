// Sign-up bursts (e.g. right after a share on social media or a newsletter).
// Rate climbs in steps of sign-ups per second, each labelled.
//
// Env: RATES="1,5,10,25,50" HOLD=40 RAMP=5
import { signup } from "./actions.js";
import { staircase, stepLabel, stepThresholds } from "./lib.js";

const RATES = (__ENV.RATES || "1,5,10,25,50").split(",").map(Number);
const { stages, steps } = staircase(RATES, Number(__ENV.HOLD || 40), Number(__ENV.RAMP || 5));

export const options = {
  scenarios: {
    signups: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 20,
      maxVUs: 1000,
      stages,
    },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  thresholds: {
    http_req_duration: [{ threshold: "p(95)<5000", abortOnFail: true, delayAbortEval: "15s" }],
    http_req_failed: [{ threshold: "rate<0.2", abortOnFail: true, delayAbortEval: "15s" }],
    ...stepThresholds(steps, ["http_req_duration", "http_req_failed", "http_reqs"]),
  },
};

export default function () {
  signup({ step: stepLabel(steps) });
}
