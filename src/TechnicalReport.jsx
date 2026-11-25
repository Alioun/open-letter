import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";

// Diagnostics for whoever runs the server, kept out of the way of the team:
// a disclosure with the raw lines and one button that copies them.
export default function TechnicalReport({
  lines,
  label = "Technische Angaben",
}) {
  const [feedback, setFeedback] = useState("");
  const report = lines.filter(Boolean).join("\n");
  return (
    <Collapsible.Root className="admin-technical-report">
      <Collapsible.Trigger className="admin-disclosure-trigger">
        {label}
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="admin-disclosure-panel">
        <pre>{report}</pre>
        <Button
          type="button"
          className="admin-button admin-button--small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(report);
              setFeedback("Fehlerbericht kopiert. Schicke ihn an die Technik.");
            } catch {
              setFeedback(
                "Kopieren ist hier nicht möglich. Markiere den Text oben und kopiere ihn.",
              );
            }
          }}
        >
          Fehlerbericht kopieren
        </Button>
        <span role="status">{feedback}</span>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
