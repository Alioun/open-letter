// Small server-rendered HTML pages (Treffen sign-up results, mail-link
// interstitials). These never load the analytics script, so a token in the URL
// stays on our server.

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// First word of a stored name, escaped for HTML text. Names pass sanitize() on
// the way in, but that strips only complete tags — `<svg/onload=…//` survives —
// so anything reflected into a page is escaped here, on output.
export function firstNameHtml(name) {
  return escapeHtml(String(name ?? "").split(/\s/)[0]);
}

export function simplePage(inner) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Zoom-Verteiler — Gehaltsdeckel jetzt</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f4f1ec; color:#6f003c; font-family:Inter,Arial,sans-serif; padding:24px; }
  .card { max-width:520px; background:#fff; border:1px solid #6f003c; box-shadow:10px 10px 0 #ff0000; padding:40px; }
  h1 { font-family:"Work Sans",Arial,sans-serif; font-weight:900; font-size:28px; margin:0 0 16px; }
  p { font-size:16px; line-height:1.6; margin:0 0 16px; }
  button { font-family:"Work Sans",Arial,sans-serif; font-weight:700; font-size:15px; color:#fff; background:#ff0000; border:none; padding:14px 22px; cursor:pointer; }
  button:hover { background:#cc0000; }
</style></head><body><div class="card">${inner}</div></body></html>`;
}
