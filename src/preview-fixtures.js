export const fixtureBoot = {
  stats: { total: 1234, today: 27, week: 142, kvCount: 12 },
  zoom: {
    count: 42,
    mode: "online",
    showDelegierter: false,
    navLabel: "Meeting",
  },
};
export async function fixtureFetch(path, options = {}) {
  let body = {};
  try {
    body = JSON.parse(options.body || "{}");
  } catch {}
  const data = path.startsWith("/api/stats")
    ? fixtureBoot.stats
    : path.startsWith("/api/signers")
      ? {
          total: 3,
          signers: ["Alex Example", "Sam Sample", "Robin Demo"].map(
            (name, i) => ({
              name,
              kreisverband: "",
              created_at: new Date(Date.now() - i * 3600000).toISOString(),
            }),
          ),
        }
      : path.startsWith("/api/zoom-count")
        ? fixtureBoot.zoom
        : path.startsWith("/api/occupations")
          ? [
              { occupation: "Teacher", count: 12 },
              { occupation: "Designer", count: 8 },
            ]
          : path.startsWith("/api/kreisverband")
            ? [
                { kreisverband: "Berlin-Mitte", state: "Berlin", count: 34 },
                { kreisverband: "Hamburg", state: "Hamburg", count: 22 },
              ]
            : {
                ok: true,
                name: body.name || "Alex Example",
                email: "preview@example.invalid",
              };
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
