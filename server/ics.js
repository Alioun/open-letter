// Minimal RFC 5545 iCalendar (VEVENT) builder — no dependencies.

function pad(n) {
  return String(n).padStart(2, "0");
}

// Format a Date as UTC iCal timestamp: YYYYMMDDTHHMMSSZ
function toIcsUtc(date) {
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Fold long lines to 75 octets per RFC 5545 (simple char-based fold).
function fold(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

export function buildZoomIcs({
  start,
  durationMin = 90,
  summary,
  description = "",
  url = "",
  location = "",
  uid,
}) {
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gehaltsdeckel jetzt//Treffen//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(startDate)}`,
    `DTEND:${toIcsUtc(endDate)}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    url ? `URL:${escapeIcs(url)}` : null,
    `LOCATION:${escapeIcs(location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.map(fold).join("\r\n") + "\r\n";
}
