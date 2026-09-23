import http from "k6/http";
import exec from "k6/execution";

export const BASE = __ENV.BASE_URL || "http://app:3000";

// A distinct client IP per VU (visitors) or per iteration (sign-ups), passed as
// X-Real-IP (app runs with TRUST_PROXY=true like behind Dokploy's proxy) so the
// per-IP rate limits behave as they would for many real people.
export function ipFor(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

// Label each request with the load step it ran in, so the summary can report
// latency per step. `steps` = [{ label, until }] with `until` in seconds.
export function stepLabel(steps) {
  const t = exec.instance.currentTestRunDuration / 1000;
  for (const s of steps) if (t < s.until) return s.label;
  return steps[steps.length - 1].label;
}

// Build a ramping-arrival-rate stage list plus matching labels: a short ramp to
// each target rate, then a hold. Only the hold is labelled with the step.
export function staircase(rates, holdS, rampS) {
  const stages = [];
  const steps = [];
  let t = 0;
  for (const r of rates) {
    stages.push({ target: r, duration: `${rampS}s` });
    t += rampS;
    steps.push({ label: "ramp", until: t });
    stages.push({ target: r, duration: `${holdS}s` });
    t += holdS;
    steps.push({ label: String(r), until: t });
  }
  return { stages, steps };
}

// Per-step thresholds that never fail; they exist so `--summary-export`
// includes the tagged sub-metrics. Real pass/fail comes from the caller.
export function stepThresholds(steps, metrics) {
  const th = {};
  for (const s of steps) {
    if (s.label === "ramp") continue;
    for (const m of metrics) {
      th[`${m}{step:${s.label}}`] =
        m === "http_req_failed" ? ["rate<=1"] : m === "http_reqs" ? ["count>=0"] : ["p(95)>=0"];
    }
  }
  return th;
}

const tokens = {};
export function sessionToken(ip, tags) {
  const now = Date.now();
  const cached = tokens[ip];
  if (cached && cached.exp > now) return cached.token;
  const res = http.get(`${BASE}/api/session`, {
    headers: { "X-Real-IP": ip },
    tags: { ...tags, name: "/api/session" },
  });
  if (res.status !== 200) return null;
  const token = res.json("token");
  tokens[ip] = { token, exp: now + 25 * 60 * 1000 };
  return token;
}
