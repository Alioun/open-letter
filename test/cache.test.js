import { describe, test, expect, beforeEach } from "bun:test";
import { resetDb, addVerifiedSigner } from "./helpers.js";
import { cached, invalidate, cacheSize } from "../server/cache.js";
import * as q from "../server/db.js";

beforeEach(() => {
  invalidate();
  return resetDb();
});

describe("cache primitive", () => {
  test("reuses a value within the TTL", async () => {
    let calls = 0;
    const fn = async () => ++calls;

    expect(await cached("k", fn, 50)).toBe(1);
    expect(await cached("k", fn, 50)).toBe(1);
    expect(calls).toBe(1);
  });

  test("once stale, serves the old value and refreshes behind it", async () => {
    let calls = 0;
    const fn = async () => ++calls;

    expect(await cached("swr", fn, 30)).toBe(1);
    await Bun.sleep(40);

    // Stale: answered from the previous value, refresh starts in the background.
    expect(await cached("swr", fn, 30)).toBe(1);
    await Bun.sleep(10);
    expect(await cached("swr", fn, 30)).toBe(2);
    expect(calls).toBe(2);
  });

  test("a stale entry triggers only one refresh, not one per caller", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await Bun.sleep(20);
      return calls;
    };

    await cached("once", fn, 10);
    await Bun.sleep(20);
    await Promise.all(Array.from({ length: 25 }, () => cached("once", fn, 10)));
    expect(calls).toBe(2);
  });

  test("a failing refresh keeps serving the last good value", async () => {
    let calls = 0;
    const fn = async () => {
      if (++calls > 1) throw new Error("db down");
      return "good";
    };

    expect(await cached("resilient", fn, 10)).toBe("good");
    await Bun.sleep(20);
    expect(await cached("resilient", fn, 10)).toBe("good"); // refresh fails behind it
    await Bun.sleep(10);
    expect(await cached("resilient", fn, 10)).toBe("good");
  });

  test("single-flights concurrent callers into one call", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await Bun.sleep(20);
      return "v";
    };

    const all = await Promise.all(
      Array.from({ length: 50 }, () => cached("busy", fn, 1000)),
    );
    expect(all.every((v) => v === "v")).toBe(true);
    expect(calls).toBe(1);
  });

  test("does not cache a failed cold start", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("boom");
    };
    await expect(cached("bad", fn, 1000)).rejects.toThrow("boom");
    await expect(cached("bad", fn, 1000)).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });

  test("ttl <= 0 bypasses caching entirely", async () => {
    let calls = 0;
    const fn = async () => ++calls;
    await cached("off", fn, 0);
    await cached("off", fn, 0);
    expect(calls).toBe(2);
  });
});

describe("cached read endpoints", () => {
  test("a write is visible to the very next read", async () => {
    await addVerifiedSigner({ name: "Anna Berger", email: "a@example.org" });
    expect((await q.getStats()).total).toBe(1);
    expect((await q.getSigners({})).total).toBe(1);

    // The INSERT drops the cache (mutation hook): no TTL wait, no stale read.
    await addVerifiedSigner({ name: "Ben Klein", email: "b@example.org" });
    expect((await q.getStats()).total).toBe(2);

    const list = await q.getSigners({});
    expect(list.total).toBe(2);
    expect(list.signers.map((s) => s.name)).toContain("Ben Klein");
  });

  test("a confirmed signature shows up immediately, well inside the TTL", async () => {
    await q.insertSigner({
      name: "Cem Demir",
      email: "c@example.org",
      kv: "Berlin",
      occupation: "",
      newsletter: false,
      showPublicly: true,
      token: "tok-cache",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect((await q.getStats()).total).toBe(0);

    await q.confirmSigner("tok-cache");
    expect((await q.getStats()).total).toBe(1);
  });

  test("an unverified sign-up leaves the cache alone, confirming it does not", async () => {
    await addVerifiedSigner({ name: "Anna Berger", email: "a@example.org" });
    expect((await q.getStats()).total).toBe(1);
    const before = cacheSize();

    // A sign-up writes an unverified row + tokens: nothing public changes, so
    // the cached aggregates must survive it (this is what keeps a sign-up burst
    // from re-running every aggregate).
    await q.insertSigner({
      name: "Pending Person",
      email: "p@example.org",
      kv: "Berlin",
      occupation: "",
      newsletter: true,
      showPublicly: true,
      token: "tok-pending",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await q.issueUnsubscribeTokenByEmail("p@example.org");
    expect(cacheSize()).toBe(before);
    expect((await q.getStats()).total).toBe(1);

    // Confirming does change a public response, so it must drop the cache.
    await q.confirmSigner("tok-pending");
    expect(cacheSize()).toBe(0);
    expect((await q.getStats()).total).toBe(2);
  });

  test("different query parameters get separate cache entries", async () => {
    await addVerifiedSigner({ name: "Dana Fischer", email: "d@example.org", kreisverband: "Köln" });
    await addVerifiedSigner({ name: "Erik Vogel", email: "e@example.org", kreisverband: "" });

    const all = await q.getSigners({ filter: "alle" });
    const kvOnly = await q.getSigners({ filter: "kv" });
    expect(all.total).toBe(2);
    expect(kvOnly.total).toBe(1);
  });
});
