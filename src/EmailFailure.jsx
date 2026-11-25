import TechnicalReport from "./TechnicalReport.jsx";
import { temporaryFailureAdvice } from "./delivery-advice.js";
const repairs = {
  "missing-template": [
    "Vorlage nicht mehr verfügbar",
    "Wähle eine andere Vorlage und prüfe ihre Sprachvarianten. Erstelle damit einen neuen Versandauftrag. Die bisherige Kampagne braucht ihre gelöschte Vorlage und kann nicht fortgesetzt werden.",
  ],
  "message-preparation": [
    "Nachricht konnte nicht vorbereitet werden",
    "Prüfe die Vorlage und ihre Platzhalter in allen Versandsprachen. Öffne die Vorschau und sende eine Testnachricht, bevor du die Kampagne erneut versuchst.",
  ],
  "delivery-tracking-expired": [
    "Zeitraum für erneuten Versand abgelaufen",
    "Das Zustellprotokoll reicht für einen erneuten Versand nicht mehr aus. Prüfe beim Anbieter, welche Nachrichten er angenommen hat, bevor du einen neuen Versandauftrag erstellst.",
  ],
  unknown: [
    "Abbruchgrund nicht aufgezeichnet",
    "Prüfe den Anbieterstatus und das Versandprofil in den Einstellungen. Sende eine Testnachricht. Kläre ungewisse Zustellungen beim Anbieter, bevor du den Versand erneut startest.",
  ],
  authentication: [
    "Anmeldung fehlgeschlagen",
    "Prüfe die Hauptadresse und ersetze das App-Passwort oder den API-Schlüssel. Speichere das Profil und sende erneut eine Testnachricht.",
  ],
  encryption: [
    "Sichere Verbindung fehlgeschlagen",
    "Prüfe Servername und TLS-Einstellung. Verwende ein gültiges Serverzertifikat. TLS darf nicht abgeschaltet werden.",
  ],
  "sender-authorization": [
    "Absender noch nicht freigegeben",
    "Bestätige die Absenderadresse oder Domain beim Anbieter. Registriere bei mailbox.org den Alias im Konto. Sende danach eine neue Testnachricht.",
  ],
  configuration: [
    "Verbindungseinstellungen prüfen",
    "Korrigiere Server, Port und Konto oder den API-Schlüssel. Speichere das vollständige Profil und teste es erneut.",
  ],
  "restore-revalidation": [
    "Nach Wiederherstellung erneut prüfen",
    "Sende eine neue Testnachricht, bestätige ihren Empfang und aktiviere das geprüfte Profil. Erst danach wird der Versand fortgesetzt.",
  ],
  quota: [
    "Versandlimit erreicht",
    "Der Versand wartet, bis der Anbieter wieder Nachrichten annimmt. Prüfe dein Kontingent beim Anbieter. Abgelaufene Links werden nicht gesendet.",
  ],
  "recipient-rejected": [
    "Empfängeradresse abgelehnt",
    "Prüfe die Empfängeradresse. Der Versand an andere Adressen kann weiterlaufen. Details findest du beim Anbieter.",
  ],
  "temporary-delivery": [
    "Anbieter vorübergehend nicht erreichbar",
    "Prüfe den Anbieterstatus und die Netzwerkverbindung. Nachrichten werden innerhalb ihrer Gültigkeit erneut versucht.",
  ],
};
// `profile` (the active mail profile) lets the advice name the server and
// port the send could not reach.
export default function EmailFailure({ failure, title, profile }) {
  if (!failure) return null;
  const temporary = temporaryFailureAdvice(failure, profile);
  const [heading, advice] = temporary
    ? [temporary.heading, temporary.text]
    : repairs[failure.category] || [
        "Versand prüfen",
        "Prüfe das Versandprofil und sende erneut eine Testnachricht. Gleiche unklare Zustellungen anhand der Vorgangs-ID beim Anbieter ab.",
      ];
  return (
    <div className="email-failure" role="alert">
      <strong>
        {title ? `${title}: ` : ""}
        {heading}
      </strong>
      <p>{advice}</p>
      {temporary && (
        <>
          <ol className="email-failure-steps">
            {temporary.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>{temporary.meanwhile}</p>
        </>
      )}
      <TechnicalReport
        lines={[
          `${title ? `${title}: ` : ""}${heading}`,
          failure.at && `Zeitpunkt: ${failure.at}`,
          `Kategorie: ${failure.category}`,
          `Fehlercode: ${failure.protocol || failure.code || "–"}`,
          profile?.host && `Server: ${profile.host}:${profile.port}`,
          profile?.provider && `Anbieter: ${profile.provider}`,
          `Vorgangs-ID: ${failure.correlationId || "–"}`,
        ].filter(Boolean)}
      />
    </div>
  );
}
