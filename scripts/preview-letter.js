import { buildFrontend, documentHtml } from "../server/frontend.js";
import config, { LETTER_NAME } from "../config/letter.config.js";

const port = Number(process.env.PORT || 3000);
const frontend = await buildFrontend();
const notice =
  config.brand.lang === "de"
    ? "LOKALE VORSCHAU · Beispieldaten · Keine Speicherung, kein E-Mail-Versand"
    : "LOCAL DESIGN PREVIEW · Demo signatures · No data saved or emails sent";
const html = documentHtml(config, LETTER_NAME, frontend.entries, {
  preview: true,
  privatePage: true,
}).replace(
  "<body>",
  `<body><div class="local-preview-bar" style="padding:8px 16px;background:${config.theme.colors.akzent};color:${config.theme.colors.fond};text-align:center;font:11px/1.5 system-ui,sans-serif;letter-spacing:.04em">${notice}</div>`,
);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("This preview does not accept submissions.", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    const path = new URL(request.url).pathname;
    const asset = frontend.assets.get(path);
    if (asset)
      return new Response(asset.bytes, {
        headers: { "Content-Type": asset.type },
      });
    if (path !== "/") return new Response("Not found", { status: 404 });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  },
});

console.log(`Local ${LETTER_NAME} preview: ${server.url}`);
console.log("Demo data only. No database, email transport, or admin service.");
