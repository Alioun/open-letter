import { describe, expect, test } from "bun:test";
import { operationsHealth } from "../server/health.js";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const hoursAgo = (hours) => new Date(NOW - hours * 3600_000).toISOString();
const working = {
  db: true,
  jobs: { ready: true, failure: null },
  mail: {
    ready: true,
    lastSuccess: hoursAgo(1),
    queue: { available: true, queued: 2, failed: 0 },
  },
  backup: { lastSuccessAt: hoursAgo(0.5), lastErrorAt: null },
  uptimeMs: 86400_000,
  now: NOW,
};
const check = (change) => operationsHealth({ ...working, ...change });

describe("what an uptime monitor is told", () => {
  test("all is well when mail goes out and the last backup is recent", () => {
    expect(check({})).toMatchObject({
      ok: true,
      checks: { app: "ok", mail: "ok", mailQueue: "ok", backup: "ok" },
      details: { failedMails: 0, queuedMails: 2, lastBackupAgeHours: 0.5 },
    });
  });

  test("each problem names itself in one word and turns ok off", () => {
    const states = (change) => {
      const health = check(change);
      expect(health.ok).toBe(false);
      return health.checks;
    };
    expect(states({ db: false }).app).toBe("down");
    expect(
      states({ jobs: { ready: false, failure: "shutting-down" } }).app,
    ).toBe("down");
    expect(states({ mail: { ...working.mail, ready: false } }).mail).toBe(
      "not-ready",
    );
    expect(
      states({
        mail: {
          ...working.mail,
          queue: { available: true, queued: 0, failed: 3 },
        },
      }).mailQueue,
    ).toBe("failed");
    expect(
      states({
        backup: { lastSuccessAt: hoursAgo(5), lastErrorAt: hoursAgo(1) },
      }).backup,
    ).toBe("failed");
    expect(
      states({ backup: { lastSuccessAt: hoursAgo(4), lastErrorAt: null } })
        .backup,
    ).toBe("stale");
  });

  test("a backup that worked again after a failure is fine", () => {
    expect(
      check({
        backup: { lastSuccessAt: hoursAgo(0.2), lastErrorAt: hoursAgo(2) },
      }).checks.backup,
    ).toBe("ok");
  });

  test("a fresh install is given time for its first backup, not forever", () => {
    const never = { lastSuccessAt: null, lastErrorAt: null };
    expect(check({ backup: never, uptimeMs: 600_000 }).checks.backup).toBe(
      "ok",
    );
    expect(check({ backup: never, uptimeMs: 4 * 3600_000 }).checks.backup).toBe(
      "stale",
    );
  });

  test("the public part carries states only", () => {
    const { checks } = check({
      mail: {
        ...working.mail,
        queue: { available: true, queued: 9, failed: 4 },
      },
    });
    for (const state of Object.values(checks))
      expect(state).toMatch(/^[a-z-]+$/);
  });
});
