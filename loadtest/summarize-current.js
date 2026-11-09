// Regenerate the current-workload report from the captured k6, work and Docker data.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const directory = resolve(process.argv[2]);
const raw = join(directory, "raw");
const environment = JSON.parse(
  readFileSync(join(directory, "environment.json")),
);
const runs = JSON.parse(readFileSync(join(directory, "runs.json")));
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const range = (values) => ({
  median: median(values),
  min: Math.min(...values),
  max: Math.max(...values),
});
const peak = (values) => (values.length ? Math.max(...values) : null);
const samples = (file) => {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        const match = line
          .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
          .match(/\{.*\}/);
        return match ? [JSON.parse(match[0])] : [];
      });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
const memoryMiB = (value) => {
  const used = value.split("/")[0];
  const n = parseFloat(used);
  return (
    n * (used.includes("GiB") ? 1024 : used.includes("KiB") ? 1 / 1024 : 1)
  );
};
const cpuCounter = (value, key) =>
  Number(
    value
      .split("\n")
      .find((line) => line.startsWith(key + " "))
      .split(" ")[1],
  );
const measurements = runs.map((run) => {
  const app = samples(join(raw, `${run.name}.stats.jsonl`));
  const generator = samples(join(raw, `${run.name}.generator.jsonl`));
  const summaryPath = join(raw, `${run.name}.json`);
  const summary = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath)).metrics
    : null;
  return {
    ...run,
    appCpuPeak: peak(app.map((s) => parseFloat(s.CPUPerc))),
    appMemoryPeakMiB: peak(app.map((s) => memoryMiB(s.MemUsage))),
    generatorCpuPeak: peak(generator.map((s) => parseFloat(s.CPUPerc))),
    generatorMemoryPeakMiB: peak(generator.map((s) => memoryMiB(s.MemUsage))),
    ...(run.memoryPeakBytes && {
      memoryChargedPeakMiB: run.memoryPeakBytes / 1024 ** 2,
    }),
    ...(run.cpuAfter && {
      appCpuMean:
        (100 *
          (cpuCounter(run.cpuAfter, "usage_usec") -
            cpuCounter(run.cpuBefore, "usage_usec"))) /
        (run.loadMs * 1000),
      cpuThrottledMs:
        (cpuCounter(run.cpuAfter, "throttled_usec") -
          cpuCounter(run.cpuBefore, "throttled_usec")) /
        1000,
    }),
    ...(summary && {
      p95: Object.fromEntries(
        ["visitors", "signatures", "searches", "admin"].map((name) => [
          name,
          summary[`http_req_duration{scenario:${name}}`]["p(95)"],
        ]),
      ),
      requests: summary.http_reqs.count,
      failedRequests: summary.http_req_failed.passes,
      checksFailed: summary.checks.fails,
      droppedIterations: summary.dropped_iterations?.count || 0,
      failedThresholds: Object.entries(summary).flatMap(([name, metric]) =>
        Object.entries(metric.thresholds || {})
          .filter(([, failed]) => failed)
          .map(([condition]) => `${name}: ${condition}`),
      ),
    }),
  };
});
const configurations = environment.tiers.map((tier) => {
  const [cpu, memory] = tier.split(":");
  const all = measurements.filter(
    (r) => r.cpu === Number(cpu) && r.memory === memory,
  );
  const measured = all.filter((r) => r.p95);
  const stat = (key) => {
    const values = all.map((r) => r[key]).filter(Number.isFinite);
    return values.length ? range(values) : null;
  };
  return {
    tier,
    runs: all.length,
    passed: all.filter((r) => r.passed).length,
    measured: measured.length,
    startupMs: stat("startupMs"),
    memoryPeakMiB: stat("appMemoryPeakMiB"),
    appCpuPeak: stat("appCpuPeak"),
    appCpuMean: stat("appCpuMean"),
    cpuThrottledMs: stat("cpuThrottledMs"),
    memoryChargedPeakMiB: stat("memoryChargedPeakMiB"),
    generatorCpuPeak: stat("generatorCpuPeak"),
    drainMs: stat("drainMs"),
    ...(measured.length && {
      p95: Object.fromEntries(
        ["visitors", "signatures", "searches", "admin"].map((name) => [
          name,
          range(measured.map((r) => r.p95[name])),
        ]),
      ),
      requests: measured.reduce((sum, r) => sum + r.requests, 0),
      failedRequests: measured.reduce((sum, r) => sum + r.failedRequests, 0),
      droppedIterations: measured.reduce(
        (sum, r) => sum + r.droppedIterations,
        0,
      ),
      signatures: measured.reduce(
        (sum, r) => sum + (r.work?.newSigners || 0),
        0,
      ),
      mailAccepted: measured.reduce(
        (sum, r) => sum + (r.mailpitMessages || 0),
        0,
      ),
      pageviews: measured.reduce((sum, r) => sum + (r.pageviews || 0), 0),
      expectedPageviews: measured.reduce(
        (sum, r) => sum + (r.expectedPageviews || 0),
        0,
      ),
    }),
  };
});
const report = { environment, configurations, measurements };
writeFileSync(join(directory, "report.json"), JSON.stringify(report, null, 2));
const format = (value, divisor = 1) =>
  value
    ? `${(value.median / divisor).toFixed(1)} [${(value.min / divisor).toFixed(1)}, ${(value.max / divisor).toFixed(1)}]`
    : "Not measured";
const lines = [
  environment.profile ? "# Profiling run" : "# Current workload results",
  "",
  environment.profile
    ? "Diagnostic only. CPU profiling was enabled. Exclude these timings from hardware comparisons."
    : configurations.some(
          (c) => c.runs === environment.repeats && c.passed === c.runs,
        )
      ? `Every run passed at ${configurations
          .filter((c) => c.runs === environment.repeats && c.passed === c.runs)
          .map((c) => c.tier)
          .join(", ")}. These are tested quotas, not a universal minimum.`
      : "No tested quota met every benchmark target in every run.",
  "",
  `Measured ${environment.date}. ${environment.dataset.toLocaleString("en")} seeded signers, ${environment.tabs} equivalent polling tabs, and ${environment.signupRate} signature submission${environment.signupRate === 1 ? "" : "s"} per second. Each run holds the workload for ${environment.hold} seconds. Values show median [minimum, maximum] across all available measurements, including failed runs. Startup failures have no latency measurement.`,
  "",
  "| App quota | Passed | Visitor p95, ms | Signup p95, ms | Admin p95, ms | Peak container memory, MiB | Startup, s | Queue drain after load, s |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const c of configurations)
  lines.push(
    c.p95
      ? `| ${c.tier} | ${c.passed}/${c.runs} | ${format(c.p95.visitors)} | ${format(c.p95.signatures)} | ${format(c.p95.admin)} | ${format(c.memoryPeakMiB)} | ${format(c.startupMs, 1000)} | ${format(c.drainMs, 1000)} |`
      : `| ${c.tier} | ${c.passed}/${c.runs} | Not measured | Not measured | Not measured | ${format(c.memoryPeakMiB)} | ${format(c.startupMs, 1000)} | ${format(c.drainMs, 1000)} |`,
  );
lines.push(
  "",
  "| App quota | Requests / HTTP failures | Dropped iterations | Persisted signatures | Mail accepted | Page views / expected | Peak generator CPU, percent of one core |",
  "| --- | --- | --- | --- | --- | --- | --- |",
);
for (const c of configurations.filter((c) => c.measured))
  lines.push(
    `| ${c.tier} | ${c.requests} / ${c.failedRequests} | ${c.droppedIterations} | ${c.signatures} | ${c.mailAccepted} | ${c.pageviews} / ${c.expectedPageviews} | ${format(c.generatorCpuPeak)} |`,
  );
lines.push(
  "",
  "| App quota | Mean app CPU, percent of one core | CPU throttled during load, ms | Peak cgroup memory charge, MiB |",
  "| --- | --- | --- | --- |",
);
for (const c of configurations)
  lines.push(
    `| ${c.tier} | ${format(c.appCpuMean)} | ${format(c.cpuThrottledMs)} | ${format(c.memoryChargedPeakMiB)} |`,
  );
lines.push(
  "",
  "An equivalent tab polls twice every ten seconds. Ten percent of ticks fetch the document, its linked bundles and public data. Each run adds signatures, one search per second, five admin reads every five seconds, built-in statistics, and a ten-recipient campaign. HTTP signup timing ends at the durable enqueue. Queue drain timing continues until all expected mail is accepted by the local TLS server.",
  "",
  "Passing requires k6 thresholds and checks, no dropped iterations, matching signer/mail/page-view counts, ten completed campaign deliveries, no pending or dead email jobs, and no app OOM or restarts. Container memory is Docker's sampled working set, not process RSS. The cgroup peak records the highest total memory charge, including cache and startup, without sampling. The generator and Mailpit run outside the app quota.",
  "",
);
for (const r of measurements.filter((r) => !r.passed))
  lines.push(
    `- ${r.name}: ${r.failedThresholds?.length ? r.failedThresholds.join(", ") : r.error.replace(/\s+/g, " ")}`,
  );
writeFileSync(join(directory, "SUMMARY.md"), lines.join("\n").trimEnd() + "\n");
console.log(lines.join("\n"));

const plotted = configurations.filter((c) => c.p95);
if (plotted.length) {
  const ceiling =
    Math.ceil(Math.max(1000, ...plotted.map((c) => c.p95.admin.max)) / 500) *
    500;
  const percent = (value) => (100 * value) / ceiling;
  const rows = plotted
    .map((c, i) => {
      const value = c.p95.admin;
      return `<div class="row"><div class="label">${c.tier.split(":")[0]} CPU<small>${c.tier.split(":")[1].replace(/m$/, " MiB").replace(/g$/, " GiB")}</small></div><div class="plot" role="img" aria-label="Admin p95 median ${Math.round(value.median)} milliseconds, range ${Math.round(value.min)} to ${Math.round(value.max)}"><span class="target" style="left:${percent(1000)}%"></span><span class="range" style="left:${percent(value.min)}%;width:${percent(value.max - value.min)}%;background:var(--chart-${i + 1},var(--primary,#4964df))"></span><span class="dot" style="left:${percent(value.median)}%;background:var(--chart-${i + 1},var(--primary,#4964df))"></span></div><div class="value">${Math.round(value.median)} ms<small>${Math.round(value.min)} to ${Math.round(value.max)}</small></div><p class="outcome">${c.passed} of ${c.runs} runs met all checks</p></div>`;
    })
    .join("");
  const memory = measurements
    .map((r) => r.memoryChargedPeakMiB)
    .filter(Number.isFinite);
  writeFileSync(
    join(directory, "chart.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{font-family:var(--font-sans,system-ui);color:var(--foreground,#202431);font-size:14px}body{margin:0}p{margin:0 0 12px;line-height:1.5}.title{font-size:18px;font-weight:600}.muted,small{color:var(--muted-foreground,#697183)}small{display:block;font-size:12px;margin-top:3px}.row{display:grid;grid-template-columns:64px 1fr 98px;gap:0 12px;align-items:center;margin-bottom:16px}.label{font-weight:600}.plot{position:relative;height:36px;border-bottom:1px solid var(--border,#d9dde5)}.range{position:absolute;top:15px;height:6px;min-width:2px;border-radius:3px}.dot{position:absolute;top:11px;width:14px;height:14px;border-radius:50%;transform:translateX(-50%);outline:2px solid var(--background,#fff)}.target{position:absolute;top:0;bottom:0;border-left:1px dashed var(--muted-foreground,#697183)}.value{font-variant-numeric:tabular-nums}.outcome{grid-column:2/4;font-size:12px;color:var(--muted-foreground,#697183);margin:6px 0 0}.legend{font-size:12px;color:var(--muted-foreground,#697183)}
</style></head><body><p class="title">Admin response time</p><p class="muted">${environment.dataset.toLocaleString("en")} signers, ${environment.tabs} equivalent polling tabs, ${environment.signupRate} signature/s, analytics and campaign delivery.</p>${rows}<p class="legend">Dots show the median p95. Lines show the run-to-run range. The dashed line marks the 1,000 ms target. Failed runs remain included; startup failures have no latency measurement.</p>${memory.length ? `<p class="legend">Highest cgroup memory charge: ${Math.max(...memory).toFixed(1)} MiB, including startup, cache, and verification helpers.</p>` : ""}</body></html>`,
  );
}
