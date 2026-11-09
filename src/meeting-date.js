export function isoToLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function meetingDateForSave(input, savedIso) {
  if (savedIso && input === isoToLocalInput(savedIso))
    return new Date(savedIso).toISOString();
  const match = /^(\d{2})\.(\d{2})\.(\d{4}), ([01]\d|2[0-3]):([0-5]\d)$/.exec(
    input,
  );
  const date =
    match &&
    new Date(`${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}`);
  if (!date || Number.isNaN(date.getTime()) || isoToLocalInput(date) !== input)
    throw new Error(
      "Gib einen gültigen Termin als TT.MM.JJJJ, HH:MM ein. Verwende die Uhrzeit von 00:00 bis 23:59.",
    );
  return date.toISOString();
}
