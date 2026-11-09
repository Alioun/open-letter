import { useEffect, useId, useRef } from "react";
import { Input } from "@base-ui/react/input";
import { Checkbox } from "@base-ui/react/checkbox";
import { Button } from "@base-ui/react/button";
import { SelectControl } from "./ui.jsx";
import { AdminReadStatus } from "./admin-read.jsx";
import { meetingDateForSave } from "./meeting-date.js";

const meetingValueLabel = (value) =>
  typeof value === "boolean"
    ? value
      ? "Ja"
      : "Nein"
    : value === "online"
      ? "Online"
      : value === "inperson"
        ? "Vor Ort"
        : value === "" || value == null
          ? "Noch nicht angegeben"
          : String(value);

export default function MeetingSettings({ form, askConfirmation }) {
  const fieldId = useId();
  const conflictPanel = useRef(null);
  useEffect(() => {
    if (form.conflict) {
      conflictPanel.current?.focus({ preventScroll: true });
      conflictPanel.current?.scrollIntoView({ block: "center" });
    }
  }, [form.conflict]);
  return (
    <form
      className="admin-card zoom-settings"
      style={{ marginBottom: 20 }}
      onSubmit={form.save}
    >
      <div className="admin-card-title">Termin und automatische E-Mails</div>
      <AdminReadStatus resource={form.read} label="Termineinstellungen" />
      {form.dirty && (
        <p role="status">
          Ungespeicherte Eingaben bleiben beim Aktualisieren erhalten.
        </p>
      )}
      <fieldset
        disabled={
          form.read.data === null ||
          form.read.loading ||
          form.read.error ||
          form.status === "saving"
        }
      >
        <div className="field">
          <label htmlFor={`${fieldId}-21`}>Termin (Datum & Uhrzeit)</label>
          <Input
            id={`${fieldId}-21`}
            type="text"
            placeholder="TT.MM.JJJJ, HH:MM"
            pattern="[0-3][0-9][.][01][0-9][.][0-9]{4}, ([01][0-9]|2[0-3]):[0-5][0-9]"
            title="Datum und Uhrzeit im Format TT.MM.JJJJ, HH:MM (24 Stunden)"
            required
            aria-describedby={`${fieldId}-meeting-date-help`}
            value={form.values.eventAtInput}
            onChange={(e) => {
              e.target.setCustomValidity("");
              form.update("eventAtInput", e.target.value);
            }}
            onBlur={(e) => {
              try {
                meetingDateForSave(e.target.value, form.saved?.eventAt);
              } catch (error) {
                e.target.setCustomValidity(error.message);
              }
            }}
          />
          <small id={`${fieldId}-meeting-date-help`}>
            TT.MM.JJJJ, HH:MM · 24 Stunden ·{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </small>
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-22`}>Zoom-Link</label>
          <Input
            id={`${fieldId}-22`}
            type="url"
            value={form.values.zoomLink}
            onChange={(e) => form.update("zoomLink", e.target.value)}
            placeholder="https://zoom.us/j/..."
          />
        </div>
        <div className="admin-date-row">
          <div className="field">
            <label htmlFor={`${fieldId}-23`}>
              Link-E-Mail: Stunden vor dem Termin
            </label>
            <Input
              id={`${fieldId}-23`}
              type="number"
              min="0"
              value={form.values.linkOffsetHours}
              onChange={(e) => form.update("linkOffsetHours", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${fieldId}-24`}>
              Erinnerung: Stunden vor dem Termin
            </label>
            <Input
              id={`${fieldId}-24`}
              type="number"
              min="0"
              value={form.values.reminderOffsetHours}
              onChange={(e) =>
                form.update("reminderOffsetHours", e.target.value)
              }
            />
          </div>
        </div>
        <p className="admin-muted">
          Ein geänderter Termin setzt den Versandstatus zurück. Link-E-Mail und
          Erinnerung können dadurch erneut versendet werden.
        </p>

        <div className="admin-card-title">Format & Anzeige</div>
        <div className="field">
          <label htmlFor={`${fieldId}-25`}>Format des Treffens</label>
          <SelectControl
            id={`${fieldId}-25`}
            value={form.values.mode}
            onChange={(e) => form.update("mode", e.target.value)}
          >
            <option value="online">Online</option>
            <option value="inperson">Vor Ort</option>
          </SelectControl>
        </div>
        {form.values.mode === "inperson" && (
          <>
            <div className="field">
              <label htmlFor={`${fieldId}-26`}>
                Name des Veranstaltungsorts
              </label>
              <Input
                id={`${fieldId}-26`}
                type="text"
                value={form.values.locationName}
                onChange={(e) => form.update("locationName", e.target.value)}
                placeholder="z. B. Karl-Liebknecht-Haus"
              />
            </div>
            <div className="field">
              <label htmlFor={`${fieldId}-27`}>
                Adresse des Veranstaltungsorts
              </label>
              <Input
                id={`${fieldId}-27`}
                type="text"
                value={form.values.locationAddress}
                onChange={(e) => form.update("locationAddress", e.target.value)}
                placeholder="Straße, PLZ Ort"
              />
            </div>
            <div className="field">
              <label htmlFor={`${fieldId}-28`}>
                Kartenlink zum Veranstaltungsort
              </label>
              <Input
                id={`${fieldId}-28`}
                type="url"
                value={form.values.locationMapsUrl}
                onChange={(e) => form.update("locationMapsUrl", e.target.value)}
                placeholder="https://maps.google.com/..."
              />
            </div>
          </>
        )}
        <div className="admin-date-row">
          <div className="field">
            <label htmlFor={`${fieldId}-29`}>
              Dauer (Minuten, für Kalendereintrag)
            </label>
            <Input
              id={`${fieldId}-29`}
              type="number"
              min={5}
              max={1440}
              value={form.values.durationMin}
              onChange={(e) => form.update("durationMin", e.target.value)}
            />
          </div>
        </div>
        <label className="check admin-check">
          <Checkbox.Root
            className="admin-checkbox"
            checked={form.values.showDelegierter}
            onCheckedChange={(checked) =>
              form.update("showDelegierter", checked)
            }
          >
            <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
          </Checkbox.Root>
          <span>Frage nach Delegiertenstatus anzeigen</span>
        </label>

        <p className="admin-muted">
          Diese Angaben werden mit dem Termin gespeichert. Gib oben ein gültiges
          Datum ein.
        </p>
        <div className="admin-actions">
          <Button
            className="cta"
            type="submit"
            disabled={
              !form.values.eventAtInput ||
              form.status === "saving" ||
              Boolean(form.conflict)
            }
          >
            {form.status === "saving" ? "Wird gespeichert…" : "Speichern"}
          </Button>
        </div>
      </fieldset>
      {form.conflict && (
        <section
          className="meeting-conflict"
          ref={conflictPanel}
          tabIndex={-1}
          role="alert"
          aria-label="Terminänderungen vergleichen"
        >
          <h3>
            Neuere Termineinstellungen · Revision {form.conflict.revision}
          </h3>
          <p>
            Deine Eingaben bleiben erhalten. Vergleiche sie mit dem
            gespeicherten Termin und wähle einen Stand. Speichere ihn
            anschließend.
          </p>
          {form.changes.map(({ key, label, mine, current }) => (
            <div className="meeting-field-diff" key={key}>
              <h4>{label}</h4>
              <p>
                <strong>Aktuell gespeichert:</strong>{" "}
                {meetingValueLabel(current)}
              </p>
              <p>
                <strong>Deine Eingabe:</strong> {meetingValueLabel(mine)}
              </p>
            </div>
          ))}
          <div className="admin-actions">
            <Button
              className="admin-button"
              type="button"
              onClick={async () => {
                if (
                  await askConfirmation(
                    "Deine ungespeicherten Termineingaben verwerfen und den aktuellen Termin übernehmen?",
                  )
                ) {
                  form.acceptSaved();
                }
              }}
            >
              Aktuellen Termin übernehmen
            </Button>
            <Button
              className="admin-button"
              type="button"
              onClick={form.continueLocal}
            >
              Mit meinen Eingaben weiterarbeiten
            </Button>
          </div>
        </section>
      )}
      {form.status === "ok" && (
        <p className="admin-test-feedback admin-test-ok">Gespeichert</p>
      )}
      {form.status === "ok-reset" && (
        <p className="admin-test-feedback admin-test-ok">
          Gespeichert · Versandstatus zurückgesetzt
        </p>
      )}
      {form.status && !["ok", "ok-reset", "saving"].includes(form.status) && (
        <p className="admin-test-feedback admin-test-error">{form.status}</p>
      )}
    </form>
  );
}
