import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { useState } from "react";
import EmailFailure from "./EmailFailure.jsx";
import { Notice } from "./ui.jsx";

export default function ZoomMailingRecovery({
  mailing,
  eventAt,
  eventLabel,
  repair,
}) {
  const [feedback, setFeedback] = useState("");
  const label = mailing.kind === "link" ? "Link-E-Mail" : "Erinnerung";
  const failure = mailing.failure || { category: "unknown" };
  const support = [
    `Automatische Treffen-E-Mail: ${label}`,
    `Termin: ${eventLabel} · ${eventAt}`,
    `Status: ${mailing.status} · Versuche: ${mailing.attempts ?? "unbekannt"}`,
    `Vom Anbieter angenommen: ${mailing.recipient_count ?? "unbekannt"}`,
    `Letzter Stand: ${mailing.updated_at || "unbekannt"}`,
    `Kategorie: ${failure.category}`,
    `Protokoll: ${failure.protocol || failure.code || "unbekannt"}`,
    `Vorgangs-ID: ${failure.correlationId || "nicht aufgezeichnet"}`,
  ].join("\n");
  return (
    <section
      className="zoom-mailing-recovery"
      aria-label={`${label} wiederherstellen`}
    >
      <EmailFailure title={label} failure={failure} />
      <p>
        Prüfe die E-Mail-Einstellungen und sende die betroffene Nachricht unter
        "Testnachrichten" als Test. Der automatische Versand bleibt danach
        angehalten. Gib die Supportangaben an deinen technischen Betrieb. Er
        muss das Zustellprotokoll prüfen, bevor fehlende Nachrichten erneut
        gesendet werden.
      </p>
      <div className="admin-actions">
        <Button type="button" onClick={repair}>
          E-Mail-Einstellungen prüfen
        </Button>
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(support);
              setFeedback(
                "Supportangaben kopiert. Gib sie an deinen technischen Betrieb weiter.",
              );
            } catch {
              setFeedback(
                "Kopieren nicht möglich. Öffne die Supportangaben und kopiere den Text manuell.",
              );
            }
          }}
        >
          Supportangaben kopieren
        </Button>
      </div>
      {feedback && <Notice>{feedback}</Notice>}
      <Collapsible.Root>
        <Collapsible.Trigger className="admin-disclosure-trigger">
          Supportangaben anzeigen
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted className="admin-disclosure-panel">
          <pre>{support}</pre>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}
