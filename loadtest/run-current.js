#!/usr/bin/env bun
// Owns one disposable Compose project. All results, including failures, are
// retained; cleanup can only remove this process's containers and volumes.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { cpus, totalmem, release, arch } from "node:os";
import assert from "node:assert/strict";

process.chdir(new URL(".", import.meta.url).pathname);
const project = `openletter-perf-${Date.now()}-${process.pid}`;
const out = resolve(
  process.env.OUT || `results/${new Date().toISOString().slice(0, 10)}-current`,
);
const raw = join(out, "raw");
mkdirSync(raw, { recursive: true });
const tiers = (process.env.TIERS || "0.5:512m 1:1g").split(/\s+/);
const repeats = Number(process.env.REPEATS || 5);
const dataset = Number(process.env.DATASET || 100000);
const hold = Number(process.env.HOLD || 60);
assert(
  Number.isInteger(dataset) && dataset > 0,
  "DATASET must be a positive integer",
);
assert(Number.isInteger(hold) && hold > 0, "HOLD must be a positive integer");
assert(
  Number.isInteger(repeats) && repeats > 0,
  "REPEATS must be a positive integer",
);
const port = Number(process.env.LOADTEST_PORT || 3900);
const mailPort = Number(process.env.MAILPIT_PORT || 3901);
const origin = `http://127.0.0.1:${port}`;
const mailOrigin = `http://127.0.0.1:${mailPort}`;
const env = {
  ...process.env,
  LOADTEST_IMAGE: process.env.LOADTEST_IMAGE || "openletter-loadtest:local",
};
env.LOADTEST_UID = String(process.getuid());
env.LOADTEST_GID = String(process.getgid());
const command = async (args, { file, allowFailure = false } = {}) => {
  const p = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (file) writeFileSync(file, stdout + stderr);
  if (code && !allowFailure)
    throw new Error(
      `${args[0]} ${args[1]} exited ${code}: ${stderr.slice(-2000)}`,
    );
  return { stdout, stderr, code };
};
const dc = (...args) => [
  "docker",
  "compose",
  "--project-name",
  project,
  "-f",
  "docker-compose.yml",
  ...(process.env.LOADTEST_OVERRIDE
    ? ["-f", process.env.LOADTEST_OVERRIDE]
    : []),
  ...(process.env.PROFILE ? ["-f", "profile-compose.yml"] : []),
  ...args,
];
const compose = (...args) => command(dc(...args));
const inspect = async (cid) =>
  JSON.parse((await command(["docker", "inspect", cid])).stdout)[0];
const sleep = (ms) => Bun.sleep(ms);
const getWork = async () =>
  JSON.parse(
    (
      await compose("exec", "-T", "app", "bun", "loadtest/inspect-work.js")
    ).stdout.trim(),
  );
let token;
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  assert(r.ok, `${path}: ${r.status} ${await r.clone().text()}`);
  return r.json();
}
async function healthy(cid) {
  for (let i = 0; i < 120; i++) {
    const state = (await inspect(cid)).State;
    if (!state.Running)
      throw new Error(
        `Startup stopped: OOM=${state.OOMKilled}, exit=${state.ExitCode}`,
      );
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("Startup exceeded 120 seconds");
}
const runs = [];
writeFileSync(
  join(out, "claim.txt"),
  `Determine the smallest tested app quota that completes ${hold}s of ${process.env.TABS || 1000} equivalent polling tabs, one search/s, ${process.env.SIGNUP_RATE || 1} signature/s, five admin reads/5s, built-in statistics and a ten-recipient campaign on ${dataset} seeded signers. Require k6 checks/thresholds, every successful document request recorded in statistics, persisted signatures, all mail accepted by authenticated TLS Mailpit, no pending/dead mail, completed campaign, no OOM/restarts, and no dropped iterations. No external delivery or browser rendering is measured.\n`,
);
try {
  await command(["./gen-env.sh"]);
  const secrets = Object.fromEntries(
    readFileSync(".env.loadtest", "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
  if (!process.env.SKIP_BUILD)
    await command(dc("build", "app"), { file: join(raw, "build.log") });
  writeFileSync(
    join(out, "environment.json"),
    JSON.stringify(
      {
        project,
        date: new Date().toISOString(),
        profile: Boolean(process.env.PROFILE),
        cpus: cpus(),
        totalMemory: totalmem(),
        kernel: release(),
        arch: arch(),
        dataset,
        tiers,
        repeats,
        hold,
        tabs: Number(process.env.TABS || 1000),
        signupRate: Number(process.env.SIGNUP_RATE || 1),
        journal: process.env.DATABASE_JOURNAL_MODE || "WAL",
        uptime: (await command(["uptime"])).stdout,
        docker: (
          await command(["docker", "version", "--format", "{{json .Server}}"])
        ).stdout,
        image: (
          await command([
            "docker",
            "image",
            "inspect",
            env.LOADTEST_IMAGE,
            "--format",
            "{{json .Id}}",
          ])
        ).stdout,
        packages: JSON.parse(readFileSync("../package.json", "utf8")),
      },
      null,
      2,
    ),
  );
  if (process.env.SEED_PATH) {
    const seed = resolve(process.env.SEED_PATH);
    assert(
      seed.startsWith(resolve("results") + "/"),
      "SEED_PATH must be under loadtest/results",
    );
    await compose(
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "app",
      "cp",
      "/app/loadtest/" + seed.slice(resolve(".").length + 1),
      "/app/data/seed.db",
    );
  } else {
    await command(
      dc(
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "app",
        "sh",
        "-c",
        `bun db/setup.js && bun loadtest/seed-bulk.js ${dataset} && cp /app/data/diaetendeckel.db /app/data/seed.db`,
      ),
      { file: join(raw, "seed.log") },
    );
  }
  await compose("up", "-d", "mailpit");
  // A,B,A,B ordering gives both configurations the same host/cache drift.
  for (let rep = 1; rep <= repeats; rep++)
    for (const tier of tiers) {
      const [cpu, memory] = tier.split(":");
      assert(/^[\d.]+$/.test(cpu) && /^\d+[mg]$/.test(memory), "Invalid quota");
      const name = `current-n${dataset}-cpu${cpu}-mem${memory}-r${rep}`;
      console.log(`Starting ${name}`);
      const result = {
        name,
        cpu: Number(cpu),
        memory,
        repetition: rep,
        started: new Date().toISOString(),
        hostUptimeBefore: (await command(["uptime"])).stdout.trim(),
      };
      let sampler, sampling, cid;
      try {
        await command(dc("stop", "app"), { allowFailure: true });
        await compose(
          "run",
          "--rm",
          "--no-deps",
          "-T",
          "app",
          "sh",
          "-c",
          "rm -f /app/data/diaetendeckel.db-wal /app/data/diaetendeckel.db-shm /app/data/diaetendeckel.db-journal && cp /app/data/seed.db /app/data/diaetendeckel.db",
        );
        env.APP_CPUS = cpu;
        env.APP_MEM = memory;
        const boot = Date.now();
        await compose("up", "-d", "--no-deps", "--force-recreate", "app");
        cid = (await compose("ps", "-aq", "app")).stdout.trim();
        const limits = await inspect(cid);
        result.limits = {
          nanoCpus: limits.HostConfig.NanoCpus,
          memory: limits.HostConfig.Memory,
          swap: limits.HostConfig.MemorySwap,
        };
        assert.equal(result.limits.nanoCpus, Number(cpu) * 1e9);
        const expectedMemory =
          Number(memory.slice(0, -1)) *
          (memory.endsWith("g") ? 1024 ** 3 : 1024 ** 2);
        assert.equal(result.limits.memory, expectedMemory);
        assert.equal(result.limits.swap, expectedMemory);
        const statsFile = Bun.file(join(raw, `${name}.stats.jsonl`)).writer();
        sampler = Bun.spawn(
          ["docker", "stats", "--format", "{{json .}}", cid],
          { stdout: "pipe", stderr: "ignore" },
        );
        sampling = (async () => {
          for await (const b of sampler.stdout) statsFile.write(b);
          await statsFile.end();
        })();
        await healthy(cid);
        result.startupMs = Date.now() - boot;
        result.startupResources = (
          await command([
            "docker",
            "stats",
            "--no-stream",
            "--format",
            "{{json .}}",
            cid,
          ])
        ).stdout.trim();
        token = (
          await api("/api/admin/login", {
            method: "POST",
            body: { password: secrets.ADMIN_PASSWORD },
          })
        ).token;
        assert(token);
        const publication = await api("/api/admin/publication");
        await api("/api/admin/statistics", {
          method: "PUT",
          body: { mode: "builtin", expectedRevision: publication.revision },
        });
        const email = await api("/api/admin/email");
        const tested = await api("/api/admin/email", {
          method: "POST",
          body: {
            action: "test",
            expectedRevision: email.revision,
            recipient: "transport-check@load.test",
          },
        });
        assert(
          tested.validation?.accepted,
          `SMTP preflight failed: ${JSON.stringify(tested.setupFailure)}`,
        );
        result.smtpVerified = true;
        const initial = await getWork();
        assert.equal(initial.signers, dataset);
        assert.equal(initial.recipients.length, 10);
        assert(initial.templateId, "Broadcast template missing from seed");
        // Measure steady traffic after warming the admin aggregates. Startup
        // timing and resource samples still include the fresh container.
        await api("/api/admin/stats");
        await api("/api/admin/statistics");
        const cleared = await fetch(mailOrigin + "/api/v1/messages", {
          method: "DELETE",
        });
        assert(cleared.ok);
        env.ADMIN_TOKEN = token;
        env.RUN_ID = crypto.randomUUID();
        await sleep(3000);
        const start = Date.now();
        result.cpuBefore = (
          await compose("exec", "-T", "app", "cat", "/sys/fs/cgroup/cpu.stat")
        ).stdout;
        const k6args = [
          "run",
          "--quiet",
          "--summary-export",
          `/results/${out.split("/").at(-1)}/raw/${name}.json`,
          "-e",
          `HOLD=${hold}`,
          "-e",
          `TABS=${process.env.TABS || 1000}`,
          "-e",
          `SIGNUP_RATE=${process.env.SIGNUP_RATE || 1}`,
          "-e",
          `TEMPLATE_ID=${initial.templateId}`,
          "-e",
          `RECIPIENT_IDS=${JSON.stringify(initial.recipients)}`,
          "/scripts/current.js",
        ];
        // --name lets resource sampling include the generator without guessing IDs.
        const generatorName = `${project}-generator`;
        const generatorFile = Bun.file(
          join(raw, `${name}.generator.jsonl`),
        ).writer();
        let generating = true;
        const generatorSamples = (async () => {
          while (generating) {
            const sample = await command(
              [
                "docker",
                "stats",
                "--no-stream",
                "--format",
                "{{json .}}",
                generatorName,
              ],
              { allowFailure: true },
            );
            if (sample.stdout.trim()) generatorFile.write(sample.stdout);
            await sleep(1000);
          }
          await generatorFile.end();
        })();
        const load = await command(
          dc(
            "--profile",
            "k6",
            "run",
            "--rm",
            "--no-deps",
            "--name",
            generatorName,
            "-T",
            "k6",
            ...k6args,
          ),
          { file: join(raw, `${name}.k6.log`), allowFailure: true },
        );
        generating = false;
        await generatorSamples;
        result.loadMs = Date.now() - start;
        result.k6Exit = load.code;
        result.cpuAfter = (
          await compose("exec", "-T", "app", "cat", "/sys/fs/cgroup/cpu.stat")
        ).stdout;
        result.endLoadResources = (
          await command([
            "docker",
            "stats",
            "--no-stream",
            "--format",
            "{{json .}}",
            cid,
          ])
        ).stdout.trim();
        const summary = JSON.parse(
          readFileSync(join(raw, `${name}.json`), "utf8"),
        );
        const accepted = summary.metrics.accepted_signups?.count || 0;
        result.expectedPageviews =
          summary.metrics.successful_page_loads?.count || 0;
        const deadline = Date.now() + 240000;
        let work, messages;
        do {
          work = await getWork();
          messages = await (
            await fetch(mailOrigin + "/api/v1/messages?limit=1")
          ).json();
          if (!work.pending && work.campaigns.every((c) => c.status === "sent"))
            break;
          await sleep(1000);
        } while (Date.now() < deadline);
        result.drainMs = Date.now() - start - result.loadMs;
        result.work = work;
        result.mailpitMessages = messages.total;
        result.accepted = accepted;
        const state = await inspect(cid);
        result.state = {
          oom: state.State.OOMKilled,
          running: state.State.Running,
          restarts: state.RestartCount,
        };
        result.memoryPeakBytes = Number(
          (
            await compose(
              "exec",
              "-T",
              "app",
              "cat",
              "/sys/fs/cgroup/memory.peak",
            )
          ).stdout.trim(),
        );
        result.memoryEvents = (
          await compose(
            "exec",
            "-T",
            "app",
            "cat",
            "/sys/fs/cgroup/memory.events",
          )
        ).stdout.trim();
        result.statistics = await api("/api/admin/statistics");
        assert.equal(result.statistics.mode, "builtin");
        assert(!result.statistics.unavailable);
        result.pageviews = result.statistics.series.reduce(
          (n, day) => n + day.pageviews,
          0,
        );
        assert(
          result.pageviews > 0,
          "Statistics must record real visitor work",
        );
        assert.equal(
          result.pageviews,
          result.expectedPageviews,
          "Statistics must account for every successful document request",
        );
        assert.equal(load.code, 0, "k6 thresholds or execution failed");
        assert(
          accepted >= hold * Number(process.env.SIGNUP_RATE || 1),
          "Missing signup iterations",
        );
        assert.equal(work.newSigners, accepted);
        assert.equal(work.signers, dataset + accepted);
        assert.equal(work.pending, 0);
        assert.equal(work.dead, 0);
        assert.equal(work.campaigns.length, 1);
        assert.equal(work.campaigns[0].status, "sent");
        assert.equal(work.campaigns[0].sent_count, 10);
        assert.equal(messages.total, accepted + 10);
        assert.equal(
          work.attempts.reduce(
            (n, a) => n + (a.status === "delivered" ? a.n : 0),
            0,
          ),
          messages.total,
        );
        assert(
          !result.state.oom && result.state.running && !result.state.restarts,
        );
        result.passed = true;
        sampler.kill();
        await sampler.exited;
        await sampling;
        sampler = null;
      } catch (error) {
        result.passed = false;
        result.error = error.message;
      } finally {
        if (sampler) {
          sampler.kill();
          await sampler.exited;
          await sampling;
        }
        if (cid) {
          if (process.env.PROFILE) {
            await command(dc("stop", "app"), { allowFailure: true });
            await command(
              [
                "docker",
                "cp",
                `${cid}:/app/data/server.cpuprofile`,
                join(raw, `${name}.cpuprofile`),
              ],
              { allowFailure: true },
            );
            await command(
              [
                "docker",
                "cp",
                `${cid}:/app/data/server.md`,
                join(raw, `${name}.profile.md`),
              ],
              { allowFailure: true },
            );
            await command(
              [
                "docker",
                "cp",
                `${cid}:/app/data/server.cpuprofile.md`,
                join(raw, `${name}.profile.md`),
              ],
              { allowFailure: true },
            );
          }
          const state = await inspect(cid);
          result.finalState = {
            oom: state.State.OOMKilled,
            exit: state.State.ExitCode,
            running: state.State.Running,
          };
          await command(dc("logs", "--no-log-prefix", "app"), {
            file: join(raw, `${name}.app.log`),
            allowFailure: true,
          });
        }
        runs.push(result);
        result.hostUptimeAfter = (await command(["uptime"])).stdout.trim();
        writeFileSync(
          join(raw, `${name}.work.json`),
          JSON.stringify(result, null, 2),
        );
        writeFileSync(join(out, "runs.json"), JSON.stringify(runs, null, 2));
        console.log(
          `${name}: ${result.passed ? "PASS" : "FAIL " + result.error}`,
        );
      }
    }
} finally {
  await command(dc("down", "--volumes", "--remove-orphans"), {
    file: join(raw, "cleanup.log"),
    allowFailure: true,
  });
}
if (runs.some((r) => !r.passed)) process.exitCode = 1;
