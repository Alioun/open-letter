export function meetingDeliveryImpact(saved, proposed, now = Date.now()) {
  const reset = saved.eventAt !== proposed.eventAt;
  if (
    !reset &&
    (saved.link || "") === proposed.zoomLink.trim() &&
    saved.linkOffsetHours === proposed.linkOffsetHours &&
    saved.reminderOffsetHours === proposed.reminderOffsetHours
  )
    return null;
  const eventTime = new Date(proposed.eventAt).getTime();
  return {
    reset,
    eventAt: proposed.eventAt,
    mailings: [
      ["link", "Link-E-Mail mit Kalendereintrag", proposed.linkOffsetHours],
      ["reminder", "Erinnerung", proposed.reminderOffsetHours],
    ].map(([kind, label, hours]) => {
      const previous = saved.mailings?.find((mailing) => mailing.kind === kind);
      const startsAt = eventTime - hours * 3600000;
      const retainedStatus = !reset && previous?.status;
      const state =
        eventTime <= now
          ? "ended"
          : retainedStatus === "sent"
            ? "sent"
            : retainedStatus === "aborted"
              ? "stopped"
              : retainedStatus === "sending"
                ? "sending"
                : kind === "link" && !proposed.zoomLink.trim()
                  ? "no-link"
                  : startsAt <= now
                    ? "due"
                    : "scheduled";
      return { kind, label, startsAt: new Date(startsAt).toISOString(), state };
    }),
  };
}

const dateLabel = (iso) =>
  new Date(iso).toLocaleString("de-DE", {
    hour12: false,
    timeZoneName: "short",
  });
const STATE_LABELS = {
  ended: "Der Termin liegt in der Vergangenheit. Kein automatischer Versand.",
  sent: "Bereits versendet. Wird durch diese Änderung nicht erneut gesendet.",
  stopped: "Angehalten. Wird durch diese Änderung nicht neu gestartet.",
  sending: "Der Versand läuft bereits.",
  "no-link":
    "Wartet auf einen Zoom-Link. Ohne Link wird diese Mail nicht gesendet.",
  due: "Das Versandfenster ist offen. Der Versand kann unmittelbar nach dem Speichern beginnen.",
  scheduled: "Automatischer Versand ab diesem Zeitpunkt bis zum Termin.",
};

export default function MeetingDeliveryReview({
  impact,
  audience,
  templates,
  defaultLanguage,
  ready,
}) {
  return (
    <span className="campaign-summary">
      <strong>Termin speichern und automatischen Versand freigeben?</strong>
      <span>Termin: {dateLabel(impact.eventAt)}</span>
      {impact.reset && (
        <span>
          Das neue Datum setzt den Versandstatus und die Zustellprotokolle
          zurück. Personen, die bereits eine Link-E-Mail oder Erinnerung
          erhalten haben, können sie erneut bekommen.
        </span>
      )}
      <span>
        Aktuell {audience.count.toLocaleString("de-DE")} angemeldete Personen
        {" · geprüft um "}
        {audience.checkedAt.toLocaleTimeString("de-DE", { hour12: false })}
      </span>
      {Object.entries(audience.byLanguage).map(([language, count]) => (
        <span key={language}>
          {language.toUpperCase()}: {count}{" "}
          {count === 1 ? "Person" : "Personen"}
          {language !== defaultLanguage &&
            impact.mailings.map(({ kind, label }) => (
              <small key={kind}>
                {label}:{" "}
                {templates.some((t) => t.slug === `zoom_${kind}.${language}`)
                  ? `Vorlage ${language.toUpperCase()}`
                  : `Vorlage der Standardsprache (${defaultLanguage.toUpperCase()})`}
              </small>
            ))}
        </span>
      ))}
      {impact.mailings.map((mailing) => (
        <span key={mailing.kind}>
          <strong>{mailing.label}</strong>
          {" · "}
          {dateLabel(mailing.startsAt)}
          <small>{STATE_LABELS[mailing.state]}</small>
        </span>
      ))}
      {!ready && (
        <span>
          Der E-Mail-Versand ist derzeit pausiert. Nach der Reparatur können
          fällige Nachrichten automatisch beginnen.
        </span>
      )}
      <small>
        Die Zahlen können sich bis zum Versand ändern. Die E-Mails gehen an die
        dann angemeldeten Personen und verwenden die dann veröffentlichten
        Vorlagen. Abgemeldete Personen erhalten keine Nachricht.
      </small>
    </span>
  );
}
