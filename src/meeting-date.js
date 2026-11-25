export function isoToLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Accepts "3.12.2026, 9:30" as well as "03.12.2026, 09:30"; the comma is
// optional.
export function meetingDateForSave(input, storedIso) {
  if (storedIso && input === isoToLocalInput(storedIso))
    return new Date(storedIso).toISOString();
  const match =
    /^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*([01]?\d|2[0-3]):([0-5]\d)$/.exec(
      input.trim(),
    );
  const [day, month, year, hour, minute] = (match || []).slice(1).map(Number);
  const date = match && new Date(year, month - 1, day, hour, minute);
  if (
    date &&
    date.getDate() === day &&
    date.getMonth() === month - 1 &&
    (date.getHours() !== hour || date.getMinutes() !== minute)
  )
    throw new Error(
      "Diese Uhrzeit gibt es an diesem Tag wegen der Zeitumstellung nicht. Wähle eine andere Uhrzeit.",
    );
  if (!date || date.getDate() !== day || date.getMonth() !== month - 1)
    throw new Error(
      "Gib einen gültigen Termin als TT.MM.JJJJ, HH:MM ein, z. B. 3.12.2026, 18:30. Verwende die Uhrzeit von 00:00 bis 23:59.",
    );
  return date.toISOString();
}
