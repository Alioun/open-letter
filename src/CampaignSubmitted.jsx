import { Button } from "@base-ui/react/button";
import { Notice } from "./ui.jsx";

const STATES = {
  scheduled: "ist eingeplant",
  due: "wird gleich gesendet",
  sending: "wird gesendet",
  sent: "ist gesendet",
  cancelled: "wurde abgesagt",
  failed: "wird nach einem Fehler erneut versucht",
  aborted: "wurde nach mehreren Fehlern angehalten",
};

// Takes the place of the send buttons once a draft has become a campaign: a
// draft sends once, and the next message starts from a new one. `status` is
// the campaign's phase in the history when that is loaded; until it has moved
// past "scheduled", what the submit recorded says more.
export default function CampaignSubmitted({ campaign, status, onNew }) {
  const state =
    status && status !== "scheduled" ? status : (campaign.outcome ?? status);
  return (
    <div className="admin-actions">
      <Notice tone="success">
        Kampagne #{campaign.id} {STATES[state] || STATES.scheduled}. Den Stand
        zeigt der Versandverlauf.
      </Notice>
      <Button className="admin-button" type="button" onClick={onNew}>
        Neue Nachricht
      </Button>
    </div>
  );
}
