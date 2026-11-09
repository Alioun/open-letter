import { useEffect, useRef } from "react";
import { Button } from "@base-ui/react/button";

const FIELDS = [
  ["provider", "Anbieter"],
  ["from", "Absender"],
  ["host", "SMTP-Server"],
  ["user", "Adresse für die Anmeldung"],
  ["port", "SMTP-Port"],
  ["secure", "Verschlüsselung"],
  ["processor", "Betreiber des Versanddienstes"],
  ["region", "Verarbeitungsregion"],
];
function display(profile, key) {
  if (
    ["host", "user", "port", "secure"].includes(key) &&
    profile.provider === "resend"
  )
    return "Bei Resend nicht erforderlich";
  if (key === "secure")
    return profile.secure
      ? "TLS ab Verbindungsaufbau"
      : "STARTTLS erforderlich";
  return String(profile[key] ?? "") || "Nicht gesetzt";
}
export default function EmailProfileReview({
  saved,
  local,
  revision,
  onContinue,
}) {
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [revision]);
  const differences = FIELDS.filter(
    ([key]) => display(saved, key) !== display(local, key),
  );
  return (
    <section
      className="email-profile-review"
      aria-labelledby="email-profile-review-heading"
    >
      <h3 id="email-profile-review-heading" tabIndex={-1} ref={heading}>
        Versandprofile vergleichen · Revision {revision}
      </h3>
      <p>
        Vergleiche das gespeicherte Profil mit deinen Eingaben, bevor du ein
        Ersatzprofil speicherst.
      </p>
      {differences.length ? (
        differences.map(([key, label]) => (
          <div className="email-profile-difference" key={key}>
            <h4>{label}</h4>
            <dl>
              <div>
                <dt>Aktuell gespeichert</dt>
                <dd>{display(saved, key)}</dd>
              </div>
              <div>
                <dt>Deine Eingabe</dt>
                <dd>{display(local, key)}</dd>
              </div>
            </dl>
          </div>
        ))
      ) : (
        <p>
          Die hier angezeigten Angaben stimmen überein. Zugangsdaten oder andere
          Einstellungen können sich geändert haben.
        </p>
      )}
      <p>
        Zugangsdaten werden nicht angezeigt.{" "}
        {local.secret
          ? "Deine neu eingegebenen Zugangsdaten bleiben im Formular erhalten."
          : "In deinem Formular sind keine neuen Zugangsdaten eingetragen."}{" "}
        Vor dem Aktivieren ist erneut ein Test mit Empfangsbestätigung nötig.
      </p>
      <Button type="button" className="admin-button" onClick={onContinue}>
        Mit meinen Eingaben weiterarbeiten
      </Button>
      <p className="admin-muted">
        Deine Eingaben werden erst mit "Ersatzprofil speichern" gespeichert.
      </p>
    </section>
  );
}
