import { Button } from "@base-ui/react/button";
import { temporaryFailureAdvice } from "./delivery-advice.js";
import TechnicalReport from "./TechnicalReport.jsx";

const count = (n, one, many) =>
  `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

export function deliveryCounts(state) {
  return {
    unclear:
      state?.messages
        ?.filter((m) => ["unresolved", "attempting"].includes(m.status))
        .reduce((sum, m) => sum + m.count, 0) || 0,
    failed: state?.queue?.available ? state.queue.failed || 0 : 0,
  };
}

// What keeps mail from going out, worst first, from GET /api/admin/email.
// Each entry leads with the consequence and says who has to act.
export function deliveryProblems(status) {
  if (!status) return [];
  if (status.unavailable)
    return [
      {
        key: "unavailable",
        severe: true,
        title: "Versandstatus nicht erreichbar",
        text: "Ob gerade E-Mails versendet werden, ist unklar. Lade die Seite neu. Bleibt die Meldung, muss die Technik den Server prüfen.",
      },
    ];
  const { unclear, failed } = deliveryCounts(status);
  return [
    status.jobs?.ready === false && {
      key: "jobs",
      severe: true,
      title: "Anmeldungen und Versand stehen still",
      text: "Neue Unterschriften und Kampagnen werden nicht angenommen, Sicherungen laufen nicht. Die Technik muss den Versanddienst neu starten.",
    },
    !status.ready && {
      key: "paused",
      title: status.active
        ? "E-Mail-Versand pausiert"
        : "E-Mail-Versand noch nicht eingerichtet",
      text: "Bestätigungsmails und Kampagnen gehen erst raus, wenn ein geprüftes Versandprofil aktiv ist. Das richtet ihr in den E-Mail-Einstellungen ein.",
    },
    status.ready &&
      status.failure && {
        key: "failure",
        severe: true,
        title:
          temporaryFailureAdvice(status.failure, status.active)?.heading ||
          "Der letzte Versand ist gescheitert",
        text: "Was zu tun ist, steht in den E-Mail-Einstellungen. Unterschriften werden weiter angenommen; Bestätigungsmails warten, bis der Versand wieder klappt.",
      },
    unclear > 0 && {
      key: "unclear",
      title:
        count(unclear, "Nachricht", "Nachrichten") + " mit unklarem Ergebnis",
      text: "Entscheide in den E-Mail-Einstellungen, ob sie erneut gesendet werden.",
    },
    failed > 0 && {
      key: "failed",
      title: count(failed, "E-Mail", "E-Mails") + " nicht angekommen",
      text: "Der Versand hat sie aufgegeben. In den E-Mail-Einstellungen steht, welche es sind, und du kannst sie noch einmal senden.",
    },
  ].filter(Boolean);
}

export function deliveryReport(status, issues) {
  return [
    `Zeitpunkt: ${new Date().toISOString()}`,
    `Probleme: ${issues.map((issue) => issue.key).join(", ") || "keine"}`,
    status?.unavailable
      ? "Versandstatus: GET /api/admin/email nicht erreichbar"
      : `Versand bereit: ${status?.ready ? "ja" : "nein"} · Quelle: ${status?.source ?? "unbekannt"}`,
    status?.jobs &&
      `Hintergrunddienst: ${status.jobs.ready ? "läuft" : "ausgefallen"}`,
    status?.queue &&
      `Warteschlange: ${status.queue.available ? `${status.queue.queued} wartend, ${status.queue.failed} fehlgeschlagen` : "nicht verfügbar"}`,
    status?.failure &&
      `Letzter Fehler: ${status.failure.category} · ${status.failure.protocol || status.failure.code || "–"} · ${status.failure.correlationId || "–"}`,
  ];
}

export default function DeliveryBanner({ issues, status, onOpen }) {
  if (!issues.length) return null;
  const severe = issues.some((issue) => issue.severe);
  return (
    <section
      className={`admin-delivery-warning${severe ? " is-severe" : ""}`}
      aria-label="Zustellprobleme"
    >
      <div className="admin-delivery-summary">
        <ul role={severe ? "alert" : "status"}>
          {issues.map((issue) => (
            <li key={issue.key}>
              <strong>{issue.title}.</strong> {issue.text}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          className="admin-button admin-button--small"
          onClick={onOpen}
        >
          E-Mail-Einstellungen öffnen
        </Button>
      </div>
      {severe && (
        <TechnicalReport
          label="Angaben für die Technik"
          lines={deliveryReport(status, issues)}
        />
      )}
    </section>
  );
}
