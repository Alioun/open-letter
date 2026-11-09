import { Collapsible } from "@base-ui/react/collapsible";
import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { LANGUAGES, DEFAULT_LANG } from "../config/letter.config.js";
import { useAdminRead, AdminReadStatus } from "./admin-read.jsx";

const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleString("de-DE", { hour12: false })
    : "Noch nicht abgeschlossen";
const validRecipients = (data) =>
  data &&
  Array.isArray(data.signers) &&
  Number.isInteger(data.total) &&
  Number.isInteger(data.unavailable) &&
  Number.isInteger(data.offset) &&
  data.offset >= 0 &&
  Number.isInteger(data.savedCount);

export default function CampaignAudit({ campaign, api }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible.Root className="campaign-audit" onOpenChange={setOpen}>
      <Collapsible.Trigger className="admin-disclosure-trigger">
        Versanddetails & Empfänger
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="admin-disclosure-panel">
        <dl>
          <div>
            <dt>Kampagne</dt>
            <dd>#{campaign.id}</dd>
          </div>
          <div>
            <dt>Angelegt</dt>
            <dd>{dateLabel(campaign.created_at)}</dd>
          </div>
          <div>
            <dt>Versand abgeschlossen</dt>
            <dd>{dateLabel(campaign.sent_at)}</dd>
          </div>
          <div>
            <dt>Vom Anbieter angenommen</dt>
            <dd>{campaign.recipient_count ?? campaign.sent_offset ?? 0}</dd>
          </div>
          {campaign.audience === "selection" && (
            <div>
              <dt>Gespeicherte Auswahl</dt>
              <dd>{campaign.selection_count} Einträge</dd>
            </div>
          )}
        </dl>
        <h3>Gespeicherte Sprachvorgaben</h3>
        <ul>
          {LANGUAGES.map((lang) => {
            const variant = campaign.i18n?.[lang];
            return (
              <li key={lang}>
                <strong>{lang.toUpperCase()}</strong>
                {" · "}
                {variant?.templateId
                  ? `Eigene Vorlage #${variant.templateId}`
                  : lang === DEFAULT_LANG
                    ? `Standardvorlage #${campaign.template_id}`
                    : `Ersatzvorlage in ${DEFAULT_LANG.toUpperCase()} · Vorlage #${campaign.template_id}`}
                <p>
                  Betreff:{" "}
                  {variant?.subject ||
                    (variant?.templateId
                      ? `aus Vorlage #${variant.templateId}`
                      : campaign.subject)}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="admin-muted">
          Hier siehst du die gespeicherten Versandvorgaben. Die Vorlagen können
          sich seit dem Versand geändert haben. Der Anbieter bestätigt die
          Annahme der Nachrichten, nicht ihren Eingang im Postfach.
        </p>
        {campaign.audience === "selection" ? (
          open && <CampaignRecipients api={api} id={campaign.id} />
        ) : (
          <p className="admin-muted">
            Die Empfängergruppe wird beim Versand ermittelt. Für diese Kampagne
            gibt es keine gespeicherte Empfängerliste.
          </p>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function CampaignRecipients({ api, id }) {
  const [page, setPage] = useState(0);
  const resource = useAdminRead(
    api,
    `/api/admin/campaigns/${id}/recipients?offset=${page * 25}`,
    true,
    validRecipients,
  );
  const data = resource.data;
  const displayedPage = data ? Math.floor(data.offset / 25) : 0;
  function requestPage(nextPage) {
    if (nextPage === page) resource.reload();
    else setPage(nextPage);
  }
  return (
    <section aria-label={`Gespeicherte Empfänger von Kampagne ${id}`}>
      <h3>Gespeicherte Empfängerauswahl</h3>
      <AdminReadStatus resource={resource} label="Empfänger" />
      {data && (
        <>
          <p>
            {data.savedCount} gespeicherte Einträge · {data.total} aktuell als
            Newsletter-Empfänger verfügbar · {data.unavailable} nicht mehr
            verfügbar
          </p>
          <p className="admin-muted">
            Die Liste zeigt, wen du aus der gespeicherten Auswahl noch
            anschreiben kannst. Gelöschte oder abgemeldete Personen fehlen. Die
            Liste belegt keinen Empfang einer Nachricht.
          </p>
          <ul>
            {data.signers.map((person) => (
              <li key={person.id}>
                <strong>{person.name}</strong>
                <br />
                {person.email}
              </li>
            ))}
          </ul>
          {data.total > 25 && (
            <div className="admin-actions">
              <Button
                disabled={resource.loading || displayedPage === 0}
                onClick={() => requestPage(displayedPage - 1)}
              >
                Zurück
              </Button>
              <span>
                Seite {displayedPage + 1} / {Math.ceil(data.total / 25)}
              </span>
              <Button
                disabled={
                  resource.loading || (displayedPage + 1) * 25 >= data.total
                }
                onClick={() => requestPage(displayedPage + 1)}
              >
                Weiter
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
