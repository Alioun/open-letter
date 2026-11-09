import { test, expect, spyOn } from "bun:test";
import {
  eligibleRequest,
  referrerDomain,
  statisticsPeriod,
} from "../server/statistics.js";

test("daily statistics cover 30 UTC dates, including the partial current day", () => {
  for (const now of [
    "2026-11-08T23:59:59.000Z",
    "2026-03-29T01:30:00.000Z",
    "2026-10-25T01:30:00.000Z",
  ]) {
    const report = statisticsPeriod(Date.parse(now));
    expect(report.tz).toBe("UTC");
    expect(new Date(report.from).toISOString()).toEndWith("T00:00:00.000Z");
    expect(Math.floor(report.to / 86400000) - report.from / 86400000).toBe(29);
    expect(report.to).toBe(Date.parse(now));
  }
  expect(
    new Date(
      statisticsPeriod(Date.parse("2026-11-09T00:00:01Z")).from,
    ).toISOString(),
  ).toBe("2026-10-11T00:00:00.000Z");
});
test("only eligible public requests enter analytics; privacy signals win", () => {
  const request = (path, headers = {}) =>
    new Request(`https://example.org${path}`, {
      headers: { "user-agent": "Mozilla/5.0", ...headers },
    });
  expect(eligibleRequest(request("/"), ["en"])).toBe(true);
  expect(eligibleRequest(request("/en/?token=private"), ["en"])).toBe(true); // pathname is the only stored page value
  for (const path of [
    "/api/sign",
    "/abmelden/secret",
    "/i/code",
    "/admin",
    "/assets/a.png",
    "/api/admin/publication/preview",
  ])
    expect(eligibleRequest(request(path), ["en"])).toBe(false);
  for (const headers of [
    { dnt: "1" },
    { "sec-gpc": "1" },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
    { "user-agent": "Googlebot" },
  ])
    expect(eligibleRequest(request("/", headers), ["en"])).toBe(false);
  expect(
    referrerDomain(
      "https://ref.example/private/token?email=person@example.org#token",
    ),
  ).toBe("https://ref.example");
});

import { createStatistics } from "../server/statistics.js";
import { openEncrypted, DB_PATH } from "../db/connection.js";
import { cached, cacheSize, invalidate } from "../server/cache.js";
import "../server/db.js";

test("real Analytik ingestion stores only sanitized data and leaves public caches warm", async () => {
  const connection = await openEncrypted(DB_PATH);
  const now = Date.now();
  const clock = spyOn(Date, "now").mockReturnValue(now);
  try {
    const statistics = await createStatistics(
      connection,
      "https://campaign.example.org",
    );
    invalidate();
    const sentinel = { total: 42 };
    await cached("analytics-neutral-proof", async () => sentinel);
    const before = cacheSize();
    await statistics.track(
      new Request("https://campaign.example.org/?token=never-store-me#secret", {
        headers: {
          "user-agent": "Mozilla/5.0 fixture-ua-never-store-me",
          referer:
            "https://referrer.example/private/person@example.org?token=secret",
        },
      }),
      "192.0.2.122",
    );
    expect(cacheSize()).toBe(before);
    const sessions = await connection
      .query("SELECT * FROM analytics_sessions")
      .all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].entry_page).toBe("/");
    expect(sessions[0].referrer_domain).toBe("referrer.example");
    expect(sessions[0].country).toBeNull();
    expect(sessions[0].lat).toBeNull();
    expect(JSON.stringify(sessions)).not.toMatch(
      /192\.0\.2\.122|fixture-ua|never-store-me|person@example|private/,
    );
    const atBoundary = await statistics.report();
    expect(atBoundary.series.reduce((n, row) => n + row.pageviews, 0)).toBe(0);
    clock.mockReturnValue(now + 1);
    const report = await statistics.report();
    expect(report.to).toBe(now + 1);
    expect(report.timeZone).toBe("UTC");
    expect(report.series).toHaveLength(30);
    expect(report.series[0].ts).toBe(report.from);
    expect(report.series.at(-1).ts).toBe(
      Math.floor(report.to / 86400000) * 86400000,
    );
    expect(report.series.reduce((n, row) => n + row.pageviews, 0)).toBe(1);
    expect(report.pages[0].key).toBe("/");
    expect(report.referrers[0].key).toBe("referrer.example");
    await connection
      .query(
        "UPDATE analytics_sessions /* public-neutral */ SET started_at=0,last_seen_at=0",
      )
      .run();
    await statistics.purge();
    expect(
      await connection.query("SELECT * FROM analytics_sessions").all(),
    ).toHaveLength(0);
  } finally {
    clock.mockRestore();
    await connection.close();
  }
}, 30000);
