export function campaignSchedule(body, now = Date.now()) {
  if (body.send_now === true) return new Date(now);
  const date = new Date(body.scheduled_at);
  if (Number.isNaN(date.getTime()) || date.getTime() <= now)
    throw new Error(
      'Wähle einen zukünftigen Versandtermin. Wenn du sofort senden möchtest, wähle "Jetzt senden".',
    );
  return date;
}
