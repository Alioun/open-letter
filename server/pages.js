// Small server-rendered HTML pages (Treffen sign-up results, mail-link
// interstitials). These never load the analytics script, so a token in the URL
// stays on our server.
//
// Their copy comes from the letter config (`pages`), merged over the German
// defaults below. Copy strings are trusted HTML from the config; `{name}`
// placeholders are filled with values the caller has already escaped.

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// First word of a stored name, escaped for HTML text. Names pass sanitize() on
// the way in, but that strips only complete tags (`<svg/onload=…//` survives),
// so anything reflected into a page is escaped here, on output.
export function firstNameHtml(name) {
  return escapeHtml(String(name ?? "").split(/\s/)[0]);
}

export const DEFAULT_PAGE_COPY = {
  title: "{siteName}",
  error: {
    heading: "Fehler",
    text: "Etwas ist schiefgelaufen. Bitte versuche es später erneut.",
  },
  // {home} = link to the Treffen section of the site.
  expired: {
    heading: "Link abgelaufen",
    text: "Dieser Link ist leider nicht mehr gültig. Du kannst dich auf {home} erneut anmelden.",
  },
  confirmSignature: {
    heading: "Unterschrift bestätigen",
    intro: "Bitte prüfe deine Angaben und bestätige deine Unterschrift.",
    nameLabel: "Name",
    publicLabel: "Name öffentlich anzeigen",
    newsletterLabel: "Newsletter",
    inviteNameLabel: "Vorname auf deinem Einladungslink",
    yes: "ja",
    no: "nein",
    button: "Unterschrift bestätigen",
    note: "Stimmt etwas nicht? Dann bestätige nicht – nicht bestätigte Eintragungen löschen wir automatisch.",
  },
  deleteData: {
    heading: "Daten löschen",
    text: "Mit dem Klick auf den Button löschen wir alle Daten, die wir zu deiner E-Mail-Adresse gespeichert haben – deine Unterschrift und deine Anmeldung zum Treffen, falls vorhanden. Das kann nicht rückgängig gemacht werden.",
    button: "Endgültig löschen",
    note: "Wenn du die Löschung nicht angefordert hast, schließe diese Seite einfach.",
  },
  // {firstName}, {when} (" am 12. Juli, 19 Uhr" or "").
  treffenConfirm: {
    heading: "Anmeldung bestätigen",
    intro: "Hallo <strong>{firstName}</strong>, bitte bestätige deine Anmeldung zum Treffen{when}.",
    nameLabel: "Name",
    delegate: "Du meldest dich als <strong>Delegierte*r</strong> an.",
    button: "Anmeldung bestätigen",
  },
  treffenInvite: {
    heading: "Zum Treffen anmelden",
    askNew: "Hallo <strong>{firstName}</strong>, möchtest du dich zum Treffen{when} anmelden?",
    askNewDelegate: "Hallo <strong>{firstName}</strong>, möchtest du dich zum Treffen{when} als <strong>Delegierte*r</strong> anmelden?",
    askToDelegate: "Hallo <strong>{firstName}</strong>, möchtest du deine Anmeldung auf <strong>Delegierte*r</strong> ändern?",
    askToRegular: "Hallo <strong>{firstName}</strong>, möchtest du deine Anmeldung auf <strong>einfache*r Teilnehmer*in</strong> ändern?",
    buttonNew: "Jetzt anmelden",
    buttonChange: "Anmeldung ändern",
  },
  // {status} = one of the status strings, or "" while the delegate field is off.
  treffenAlready: {
    heading: "Du bist bereits angemeldet",
    text: "Hallo <strong>{firstName}</strong>, du bist bereits{status} für das Treffen registriert.",
    statusDelegate: " als <strong>Delegierte*r</strong>",
    statusRegular: " als einfache*r Teilnehmer*in",
    toDelegate: "Als Delegierte*r anmelden",
    toRegular: "Nicht als Delegierte*r anmelden",
    unsubscribe: "Abmelden",
  },
  treffenDone: {
    heading: "Du bist dabei!",
    text: "Wir haben deine Anmeldung für das Treffen gespeichert, <strong>{firstName}</strong>.",
    delegate: "Du hast dich als <strong>Delegierte*r</strong> angemeldet.",
    updated: "Deine Anmeldung wurde aktualisiert.",
  },
};

// The letter's page copy, section by section over the defaults.
export function pageCopy(cfg) {
  const own = cfg?.pages || {};
  const out = { ...DEFAULT_PAGE_COPY, ...own };
  for (const [key, value] of Object.entries(DEFAULT_PAGE_COPY)) {
    if (value && typeof value === "object") out[key] = { ...value, ...(own[key] || {}) };
  }
  return out;
}

// Replace {name} placeholders with the (already HTML-safe) values.
export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, key) =>
    key in vars ? String(vars[key]) : m,
  );
}

export function simplePage(inner, cfg) {
  const c = cfg?.theme?.colors || {};
  const fonts = cfg?.theme?.fonts || {};
  const lang = escapeHtml(cfg?.brand?.lang || "de");
  const title = fill(pageCopy(cfg).title, {
    siteName: escapeHtml(cfg?.meta?.siteName || cfg?.brand?.name || ""),
  });
  // Theme values come from the config; strip anything that could end the
  // <style> block.
  const css = (v, fallback) => String(v ?? fallback).replace(/[<>{};]/g, "");
  const accent = css(c.akzent, "#6f003c");
  const red = css(c.rot, "#ff0000");
  const redText = css(c.rotText, "#cc0000");
  // Letters without offset shadows set style.shadowOffset to "none".
  const offset = css(cfg?.theme?.style?.shadowOffset, "10px 10px 0");
  const shadow = offset === "none" ? "none" : `${offset} ${red}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:${css(c.fond, "#f4f1ec")}; color:${accent}; font-family:${css(fonts.body, "Inter, Arial, sans-serif")}; padding:24px; }
  .card { max-width:520px; background:${css(c.weiss, "#fff")}; border:1px solid ${accent}; box-shadow:${shadow}; padding:40px; }
  h1 { font-family:${css(fonts.display, "Arial, sans-serif")}; font-weight:900; font-size:28px; margin:0 0 16px; }
  p { font-size:16px; line-height:1.6; margin:0 0 16px; }
  button { font-family:${css(fonts.display, "Arial, sans-serif")}; font-weight:700; font-size:15px; color:${css(c.weiss, "#fff")}; background:${red}; border:none; padding:14px 22px; cursor:pointer; }
  button:hover { background:${redText}; }
</style></head><body><div class="card">${inner}</div></body></html>`;
}
