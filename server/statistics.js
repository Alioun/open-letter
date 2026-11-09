import { createAnalytik } from "analytik/server";
import { memoryStorage } from "analytik/storage/memory";

export function statisticsPeriod(now = Date.now()) {
  const today = new Date(now);
  const dayStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return {
    from: dayStart - 29 * 86400000,
    to: now,
    interval: "day",
    tz: "UTC",
  };
}

export function eligibleRequest(req, languages) {
  const path = new URL(req.url).pathname;
  const publicPaths = ["/", ...languages.flatMap((l) => [`/${l}`, `/${l}/`])];
  if (req.method !== "GET" || !publicPaths.includes(path)) return false;
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1")
    return false;
  if (
    /prefetch|prerender/i.test(
      [
        req.headers.get("purpose"),
        req.headers.get("sec-purpose"),
        req.headers.get("x-moz"),
      ].join(" "),
    )
  )
    return false;
  if (
    /bot|crawler|spider|slurp|headless|preview|facebookexternalhit|whatsapp|telegram|curl|wget/i.test(
      req.headers.get("user-agent") || "",
    )
  )
    return false;
  return true;
}

export function referrerDomain(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

export async function createStatistics(connection, baseUrl) {
  // Bootstrap from the package's public storage interface; no private imports or unencrypted persistent database.
  const schema = memoryStorage();
  await schema.migrate();
  const definitions = await schema.query(
    "SELECT name,sql,type FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
  );
  const tables = definitions
    .filter((d) => d.type === "table")
    .map((d) => d.name);
  const identifiers = new RegExp(`\\b(${tables.join("|")})\\b`, "g");
  const rewrite = (sql) =>
    sql
      .split(/('(?:''|[^'])*')/g)
      .map((part, i) =>
        i % 2 ? part : part.replace(identifiers, "analytics_$1"),
      )
      .join("");
  for (const definition of definitions) {
    let sql = rewrite(definition.sql)
      .replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ")
      .replace(
        /^CREATE (UNIQUE )?INDEX /i,
        (_, unique = "") => `CREATE ${unique}INDEX IF NOT EXISTS `,
      );
    // Index names share the application's namespace as well.
    sql = sql.replace(/(INDEX IF NOT EXISTS )([\w]+)/, "$1analytics_$2");
    await connection.run(sql);
  }
  await schema.close();
  let serial = Promise.resolve();
  const lock = (fn) => {
    const run = serial.then(fn);
    serial = run.catch(() => {});
    return run;
  };
  const neutral = (sql) =>
    rewrite(sql).replace(
      /^(\s*(?:INSERT|UPDATE|DELETE|REPLACE))\b/i,
      "$1 /* public-neutral */",
    );
  const storage = {
    dialect: "sqlite",
    migrate: async () => ({ applied: [], version: "0009_vitals" }),
    query: (sql, params = []) =>
      lock(() => connection.query(neutral(sql)).all(...params)),
    run: (sql, params = []) =>
      lock(async () => ({
        changes: (await connection.query(neutral(sql)).run(...params)).changes,
      })),
    batch: (statements) =>
      lock(() =>
        connection.transaction(async () => {
          for (const s of statements)
            await connection.query(neutral(s.sql)).run(...(s.params || []));
        }),
      ),
  };
  const analytics = createAnalytik({
    storage,
    autoMigrate: false,
    admin: { verify: () => true },
    privacy: { mode: "strict", keepQuery: [], respectDoNotTrack: true },
    geo: () => null,
    trustProxy: false,
    updateCheck: false,
  });
  let sites = await (
    await analytics.app.request("http://internal/api/sites")
  ).json();
  sites = Array.isArray(sites) ? sites : sites.sites || [];
  let site = sites.find(
    (s) =>
      s.domain ===
      (new URL(baseUrl).hostname.includes(".")
        ? new URL(baseUrl).hostname
        : "local.campaign.invalid"),
  );
  if (!site) {
    const response = await analytics.app.request("http://internal/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Campaign",
        domain: new URL(baseUrl).hostname.includes(".")
          ? new URL(baseUrl).hostname
          : "local.campaign.invalid",
        privacyMode: "strict",
        retentionDays: 30,
        allowLocalhost: true,
        vitalsSample: 0,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Statistics site setup failed (${response.status}): ${await response.text()}`,
      );
    const result = await response.json();
    site = result.site || result;
  }
  // Always enforce policy, including databases restored from another configuration.
  await analytics.app.request(`http://internal/api/sites/${site.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      privacyMode: "strict",
      retentionDays: 30,
      vitalsSample: 0,
    }),
  });
  let pending = 0;
  return {
    track(req, ip) {
      if (pending >= 100) return;
      pending++;
      const url = new URL(req.url);
      return analytics
        .ingest({
          payload: {
            w: site.id,
            t: "pageview",
            u: `${new URL(baseUrl).origin}${url.pathname}`,
            r: referrerDomain(req.headers.get("referer")),
            m: "strict",
          },
          ip,
          userAgent: req.headers.get("user-agent"),
          geo: null,
        })
        .catch(() => {})
        .finally(() => pending--);
    },
    async report() {
      const query = statisticsPeriod();
      const [series, pages, referrers] = await Promise.all([
        analytics.stats.timeseries(site.id, query),
        analytics.stats.breakdown(site.id, "page", query),
        analytics.stats.breakdown(site.id, "referrer", query),
      ]);
      return {
        series,
        pages,
        referrers,
        from: query.from,
        to: query.to,
        timeZone: query.tz,
      };
    },
    purge() {
      return analytics.stats.purge(site.id, Date.now() - 30 * 86400000);
    },
  };
}
