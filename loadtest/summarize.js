// Turns loadtest/results/<date>/raw/* into markdown tables.
//
//   bun loadtest/summarize.js loadtest/results/2026-09-16
//
// "Max OK" is the largest step that stayed under the pass criteria:
// p95 < 500 ms and < 1% failed requests (sign-ups: p95 < 1000 ms).
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const dir = process.argv[2] || "loadtest/results/" + new Date().toISOString().slice(0, 10);
const raw = join(dir, "raw");
const P95_OK = { visitors: 500, mixed: 500, signup: 1000 };
// Seconds each step is held, used to derive per-step request rates (k6's own
// `rate` is averaged over the whole run). Defaults match the k6 scripts; pass
// the same HOLD you ran with (HOLD=45 bun loadtest/summarize.js …) to override.
const HOLD = process.env.HOLD
  ? { visitors: +process.env.HOLD, mixed: +process.env.HOLD, signup: +process.env.HOLD }
  : { visitors: 60, mixed: 60, signup: 40 };

const num = (s) => parseFloat(String(s).replace(/[^\d.]/g, "")) || 0;
const parseName = (f) => {
  const m = f.match(/^(visitors|signup|mixed)-n(\d+)-cpu([\d.]+)-mem(\w+)\.json$/);
  return m && { scenario: m[1], n: +m[2], cpus: m[3], mem: m[4], base: f.replace(/\.json$/, "") };
};

const runs = [];
for (const f of readdirSync(raw).filter((f) => f.endsWith(".json")).sort()) {
  const id = parseName(f);
  if (!id) continue;
  const metrics = JSON.parse(readFileSync(join(raw, f), "utf-8")).metrics || {};
  const steps = new Map();
  for (const [key, val] of Object.entries(metrics)) {
    const m = key.match(/^(http_req_duration|http_req_failed|http_reqs)\{step:(\d+)\}$/);
    if (!m) continue;
    const s = steps.get(+m[2]) || {};
    if (m[1] === "http_req_duration") { s.p95 = val["p(95)"]; s.p99 = val["p(99)"]; s.med = val.med; }
    if (m[1] === "http_req_failed") s.failRate = val.value ?? val.rate ?? 0;
    // k6 reports `rate` over the whole test run, so derive the step's own
    // request rate from its count and the hold duration.
    if (m[1] === "http_reqs") { s.reqs = val.count; s.rps = val.count / HOLD[id.scenario]; }
    steps.set(+m[2], s);
  }
  // CPU / memory samples
  const csv = join(raw, `${id.base}.stats.csv`);
  let cpuMax = 0, memMax = 0;
  if (existsSync(csv)) {
    for (const line of readFileSync(csv, "utf-8").trim().split("\n").slice(1)) {
      const [, cpu, mem] = line.split(",");
      cpuMax = Math.max(cpuMax, num(cpu));
      // "50.51MiB / 512MiB" -> usage only; GiB values normalised to MiB.
      const used = String(mem).split("/")[0];
      memMax = Math.max(memMax, num(used) * (/GiB/i.test(used) ? 1024 : 1));
    }
  }
  const meta = Object.fromEntries(
    (existsSync(join(raw, `${id.base}.meta`)) ? readFileSync(join(raw, `${id.base}.meta`), "utf-8") : "")
      .trim().split("\n").filter(Boolean).map((l) => l.split("=")),
  );
  // Steps with no traffic (the run aborted before reaching them) prove nothing.
  for (const [k, s] of [...steps] ) if (!s.reqs) steps.delete(k);
  // A run that never produced a labelled step (killed before its first hold)
  // has nothing to report; skip it rather than printing an empty row.
  if (steps.size === 0) continue;
  const ok = [...steps.entries()]
    .filter(([, s]) => s.p95 < P95_OK[id.scenario] && (s.failRate ?? 0) < 0.01)
    .map(([k]) => k);
  runs.push({
    ...id,
    steps: [...steps.entries()].sort((a, b) => a[0] - b[0]),
    maxOk: ok.length ? Math.max(...ok) : 0,
    reached: steps.size ? Math.max(...steps.keys()) : 0,
    cpuMax, memMax, meta,
    total: metrics.http_reqs?.count ?? 0,
  });
}

const fmt = (v, d = 0) => (v === undefined ? "-" : v.toFixed(d));
const byScenario = (sc) => runs.filter((r) => r.scenario === sc);

for (const [sc, unit] of [["visitors", "open tabs"], ["mixed", "open tabs (+ sign-ups & searches)"], ["signup", "sign-ups/s"]]) {
  const rs = byScenario(sc);
  if (!rs.length) continue;
  console.log(`\n## ${sc}: ${unit}\n`);
  console.log("| signers | CPU | RAM | max OK | tested up to | p95 @ max OK | peak CPU | peak RSS | notes |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rs.sort((a, b) => a.n - b.n || parseFloat(a.cpus) - parseFloat(b.cpus))) {
    const at = r.steps.find(([k]) => k === r.maxOk)?.[1];
    const notes = [
      r.meta.oom_killed === "true" ? "**OOM-killed**" : null,
      r.meta.running === "false" ? "**app died**" : null,
      r.maxOk === 0 ? "failed at lowest step" : null,
      r.maxOk === r.reached ? "no ceiling found" : null,
    ].filter(Boolean).join(", ");
    console.log(
      `| ${r.n.toLocaleString("en-US")} | ${r.cpus} | ${r.mem} | ${r.maxOk || "-"} | ${r.reached} | ` +
      `${at ? fmt(at.p95) + " ms" : "-"} | ${fmt(r.cpuMax)}% | ${fmt(r.memMax)} MiB | ${notes || ""} |`,
    );
  }
}

console.log("\n## per-step detail\n");
for (const r of runs) {
  console.log(
    `\n**${r.scenario} · ${r.n.toLocaleString("en-US")} signers · ${r.cpus} CPU / ${r.mem}** ` +
    `(peak CPU ${fmt(r.cpuMax)}%, peak RSS ${fmt(r.memMax)} MiB)\n`,
  );
  console.log("| step | req/s | p50 | p95 | p99 | failed |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const [step, s] of r.steps) {
    console.log(
      `| ${step} | ${fmt(s.rps, 1)} | ${fmt(s.med)} ms | ${fmt(s.p95)} ms | ${fmt(s.p99)} ms | ${fmt((s.failRate ?? 0) * 100, 1)}% |`,
    );
  }
}
