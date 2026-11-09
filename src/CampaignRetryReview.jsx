import { DEFAULT_LANG } from "../config/letter.config.js";

export default function CampaignRetryReview({ review, paused }) {
  return (
    <span className="campaign-summary">
      <strong>Kampagne #{review.id} erneut freigeben?</strong>
      <span>
        {review.remaining} verbleibende Empfänger*innen von {review.eligible}{" "}
        aktuell verfügbaren Personen. {review.alreadyAccepted} bereits vom
        Anbieter angenommene Nachrichten werden anhand des Versandprotokolls
        übersprungen.
      </span>
      <span>
        Frisch geprüft um{" "}
        {new Date(review.checkedAt).toLocaleTimeString("de-DE", {
          hour12: false,
        })}
        .
      </span>
      {review.versions.map((version) => (
        <span key={version.language}>
          <strong>{version.language.toUpperCase()}</strong> · {version.count}{" "}
          verbleibende Empfänger*innen
          <small>
            {version.templateName} · Vorlage #{version.templateId}
          </small>
          <small>Beispielbetreff: {version.subjectExample}</small>
          {version.fallback && (
            <small>
              Vorlage der Standardsprache ({DEFAULT_LANG.toUpperCase()})
            </small>
          )}
        </span>
      ))}
      <small>
        Die Betreffzeilen zeigen Beispieldaten. Beim Versand setzt die Vorlage
        die Angaben der Person und die aktuellen Zahlen ein.
      </small>
      <small>
        Der neue Versuch verwendet die aktuell veröffentlichten Vorlagen. Beim
        Versand wird die Empfängergruppe erneut geprüft. Bei dynamischen Gruppen
        können weitere berechtigte Personen hinzukommen. Abgemeldete Personen
        und bereits vom Anbieter angenommene Nachrichten werden übersprungen.
        Die Zahlen können sich deshalb noch ändern.
      </small>
      <small>
        {paused
          ? "Der E-Mail-Versand ist pausiert. Nach seiner Reparatur können freigegebene, fällige Nachrichten automatisch versendet werden."
          : "Mit der Freigabe kann der automatische Versand starten."}{" "}
        Die Annahme durch den Anbieter bestätigt keinen Eingang im Postfach.
      </small>
    </span>
  );
}
