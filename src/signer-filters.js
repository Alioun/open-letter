export function signerDateRange(
  preset,
  fromDay = "",
  toDay = "",
  now = Date.now(),
) {
  if (preset === "24h")
    return { from: new Date(now - 24 * 3600e3).toISOString(), to: null };
  if (preset === "7d")
    return { from: new Date(now - 7 * 24 * 3600e3).toISOString(), to: null };
  if (preset === "custom") {
    if (fromDay && toDay && fromDay > toDay)
      return {
        error:
          'Das Startdatum liegt nach dem Enddatum. Wähle unter "Bis" denselben oder einen späteren Tag. Deine Auswahl bleibt erhalten.',
      };
    return {
      from: fromDay ? new Date(fromDay + "T00:00:00").toISOString() : null,
      to: toDay ? new Date(toDay + "T23:59:59.999").toISOString() : null,
    };
  }
  return { from: null, to: null };
}
