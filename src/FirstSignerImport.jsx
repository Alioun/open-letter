import { useId, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import cfg from "../config/letter.config.js";
import { Notice } from "./ui.jsx";
import { Check } from "./SignerEditPanel.jsx";
import { applyImport, previewImport } from "./first-signer-admin.js";

const DETAILS_CAN_BE_PUBLIC = Boolean(
  cfg.features.publicSignerDetails || cfg.features.publicFirstSignerDetails,
);

const OUTCOMES = {
  mark: "Wird markiert",
  already: "Ist schon Erstunterzeichner*in",
  add: "Wird von Hand eingetragen",
  skip: "Wird übersprungen",
};

const countLine = ({ mark, already, add, skip }) =>
  [
    `${mark} ${mark === 1 ? "Unterschrift wird" : "Unterschriften werden"} markiert`,
    `${add} ${add === 1 ? "Person wird" : "Personen werden"} von Hand eingetragen`,
    already && `${already} ${already === 1 ? "ist" : "sind"} es schon`,
    skip &&
      `${skip} ${skip === 1 ? "Zeile wird" : "Zeilen werden"} übersprungen`,
  ]
    .filter(Boolean)
    .join(", ");

// Upload, preview, confirm. Nothing changes before the confirmation, and a
// backup is written right before.
export default function FirstSignerImport({
  api,
  askConfirmation,
  onImported,
}) {
  const id = useId();
  const [file, setFile] = useState(null);
  const [order, setOrder] = useState(true);
  const [preview, setPreview] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [state, setState] = useState(null);

  const reset = () => {
    setPreview(null);
    setConsent(false);
  };

  async function choose(event) {
    reset();
    setState(null);
    const chosen = event.target.files?.[0];
    if (!chosen) return setFile(null);
    if (chosen.size > 1024 * 1024) {
      setFile(null);
      setState({ error: "Die Datei ist größer als 1 MB." });
      return;
    }
    setFile({ name: chosen.name, csv: await chosen.text() });
  }

  async function showPreview() {
    setState({ busy: "preview" });
    try {
      setPreview(await previewImport(api, file.csv, order));
      setState(null);
    } catch (error) {
      setState({ error: error.message });
    }
  }

  async function confirm(event) {
    const { counts } = preview;
    const confirmed = await askConfirmation(
      `${countLine(counts)}. ${counts.placed ? `${counts.placed} ${counts.placed === 1 ? "Person kommt" : "Personen kommen"} in Dateireihenfolge ans Ende der Reihenfolge. ` : ""}Vorher wird eine Sicherung der Datenbank angelegt.`,
      {
        returnFocus: event.currentTarget,
        title: "Erstunterzeichner*innen übernehmen?",
        confirmLabel: "Übernehmen",
      },
    );
    if (!confirmed) return;
    setState({ busy: "apply" });
    try {
      const { marked, added } = await applyImport(api, {
        csv: file.csv,
        plan: preview.plan,
        order,
        showSignerDetails: showDetails,
        consent,
        consentNote: consentNote.trim(),
      });
      reset();
      setFile(null);
      setState({
        done: `Übernommen: ${marked} markiert, ${added} von Hand eingetragen. Eine Sicherung von vorher liegt bei den Backups.`,
      });
      onImported();
    } catch (error) {
      setState({ error: error.message });
      if (error.status === 409) reset();
    }
  }

  const changes = preview
    ? preview.counts.mark + preview.counts.add + preview.counts.placed
    : 0;
  return (
    <div className="first-signer-import">
      <p className="admin-muted">
        Eine CSV-Datei mit den Spalten <code>name</code>, <code>email</code>{" "}
        (freiwillig), <code>organisation</code> und <code>funktion</code>{" "}
        (freiwillig), oder die Tabelle der Anmeldungen. Wer mit dieser Adresse
        schon unterschrieben hat, wird markiert. Alle anderen werden ohne
        Adresse von Hand eingetragen; die Adresse wird nicht gespeichert.
      </p>
      <div className="field">
        <label htmlFor={`${id}-file`}>CSV-Datei</label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          onChange={choose}
        />
      </div>
      <Check
        checked={order}
        onChange={(value) => {
          setOrder(value);
          reset();
        }}
      >
        In der Reihenfolge der Datei ans Ende der Reihenfolge stellen
      </Check>
      <div className="admin-actions">
        <Button
          type="button"
          className="admin-button"
          disabled={!file || Boolean(state?.busy)}
          onClick={showPreview}
        >
          {state?.busy === "preview" ? "Wird geprüft…" : "Vorschau anzeigen"}
        </Button>
      </div>

      {preview && (
        <>
          <p role="status">
            <strong>{countLine(preview.counts)}.</strong>
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table first-signer-preview">
              <thead>
                <tr>
                  <th scope="col">Zeile</th>
                  <th scope="col">Name</th>
                  <th scope="col">Ergebnis</th>
                  <th scope="col">Grund</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className={`is-${row.outcome}`}>
                    <td>{row.line}</td>
                    <td className="admin-cell-wrap">
                      {row.name || "–"}
                      {row.signerName && row.signerName !== row.name && (
                        <span className="admin-muted">
                          {" "}
                          (unterschrieben als „{row.signerName}“)
                        </span>
                      )}
                    </td>
                    <td>{OUTCOMES[row.outcome]}</td>
                    <td className="admin-cell-wrap">{row.reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changes > 0 && (
            <>
              {DETAILS_CAN_BE_PUBLIC && preview.counts.add > 0 && (
                <Check checked={showDetails} onChange={setShowDetails}>
                  Bei den neu eingetragenen Personen Funktion und Organisation
                  öffentlich zeigen (nur wenn alle das möchten)
                </Check>
              )}
              <div className="signer-edit-consent">
                <p>
                  Alle übernommenen Personen werden öffentlich als
                  Erstunterzeichner*innen genannt. Das geht nur mit ihrer
                  Zustimmung.
                </p>
                <Check checked={consent} onChange={setConsent}>
                  Zustimmung liegt für alle vor
                </Check>
                <div className="field">
                  <label htmlFor={`${id}-note`}>
                    Notiz dazu (freiwillig, z. B. „Liste vom Treffen am 3.11.“)
                  </label>
                  <Input
                    id={`${id}-note`}
                    value={consentNote}
                    maxLength={300}
                    onChange={(event) => setConsentNote(event.target.value)}
                  />
                </div>
              </div>
              <div className="admin-actions">
                <Button
                  type="button"
                  className="admin-button admin-button--primary"
                  disabled={!consent || Boolean(state?.busy)}
                  onClick={confirm}
                >
                  {state?.busy === "apply"
                    ? "Sicherung und Übernahme laufen…"
                    : "Übernehmen"}
                </Button>
              </div>
            </>
          )}
          {changes === 0 && (
            <Notice tone="info">
              Die Datei ändert nichts: niemand wäre neu markiert oder
              eingetragen.
            </Notice>
          )}
        </>
      )}
      {state?.done && <Notice tone="success">{state.done}</Notice>}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
    </div>
  );
}
