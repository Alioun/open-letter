// scripts/deploy.sh against a throwaway "GitHub" and server checkout, with a
// stand-in for docker that only notes what it was asked to build.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/deploy.sh", import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), "open-letter-deploy-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const bin = join(root, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "docker"), '#!/bin/sh\necho "$@" >> "$DOCKER_CALLS"\n');
chmodSync(join(bin, "docker"), 0o755);

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.org",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.org",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function git(cwd, ...args) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, ...identity },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function commit(cwd, name) {
  writeFileSync(join(cwd, name), name);
  git(cwd, "add", name);
  git(cwd, "commit", "-q", "-m", name);
  return git(cwd, "rev-parse", "HEAD");
}

// A "GitHub" with one commit on main, and a server checkout cloned from it.
function setup(name) {
  const dir = join(root, name);
  const github = join(dir, "github");
  const checkout = join(dir, "checkout");
  mkdirSync(github, { recursive: true });
  git(github, "init", "-q", "-b", "main");
  commit(github, "first");
  git(dir, "clone", "-q", github, checkout);
  mkdirSync(join(checkout, "scripts"));
  cpSync(script, join(checkout, "scripts/deploy.sh"));
  const calls = join(dir, "docker-calls");
  const deploy = () => {
    const result = Bun.spawnSync(["sh", "scripts/deploy.sh"], {
      cwd: checkout,
      env: {
        ...process.env,
        ...identity,
        PATH: `${bin}:${process.env.PATH}`,
        DOCKER_CALLS: calls,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      output: result.stdout.toString() + result.stderr.toString(),
      built: existsSync(calls) ? readFileSync(calls, "utf8") : "",
    };
  };
  return { github, checkout, deploy };
}

describe("scripts/deploy.sh", () => {
  test("a checkout behind main on GitHub is updated and built at that commit", () => {
    const { github, checkout, deploy } = setup("behind");
    const latest = commit(github, "second");

    const result = deploy();
    expect(result.output).toContain("Deployed");
    expect(result.exitCode).toBe(0);
    expect(git(checkout, "rev-parse", "HEAD")).toBe(latest);
    expect(result.built).toContain(`GIT_COMMIT=${latest}`);
  });

  test("a checkout with commits main on GitHub lacks is not built", () => {
    const { checkout, deploy } = setup("ahead");
    const local = commit(checkout, "local-only");

    const result = deploy();
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(local.slice(0, 7));
    expect(result.output).not.toContain("Deployed");
    expect(result.built).toBe("");
  });

  test("another branch that already contains main is not built", () => {
    const { checkout, deploy } = setup("branch");
    git(checkout, "checkout", "-q", "-b", "experiment");
    commit(checkout, "experiment");

    const result = deploy();
    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain("Deployed");
    expect(result.built).toBe("");
  });
});
