import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Choice } from "./ui.jsx";
import { campaignText } from "../config/campaign-templates.js";
import { LANGUAGES, DEFAULT_LANG } from "../config/letter.config.js";

export default function CampaignTestLanguage({
  api,
  language,
  onLanguage,
  templateId,
  subject,
  translations,
  templates,
}) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const text = campaignText(
    templateId,
    subject,
    translations,
    language,
    templates,
  );
  const selected = templates.find(
    (t) => String(t.id) === String(text.templateId),
  );
  const signature = JSON.stringify([
    language,
    text.templateId,
    text.subject,
    selected?.html_body,
    selected?.revision,
  ]);
  return (
    <div className="campaign-language-preview">
      <Choice
        label="Sprache für Vorschau und Testversand"
        value={language}
        onChange={onLanguage}
        options={LANGUAGES.map((l) => [l, l.toUpperCase()])}
      />
      <p>
        Vorschau & Test:{" "}
        <strong>{selected?.name || "Keine Vorlage ausgewählt"}</strong>
        <br />
        Betreffvorlage: {text.subject || "Noch kein Betreff"}
      </p>
      {language !== DEFAULT_LANG && (
        <p className="admin-muted">
          {text.templateFallback
            ? "Vorlage aus der Standardsprache."
            : "Eigene Vorlage für diese Sprache."}{" "}
          {text.subjectFallback
            ? "Betreff aus der Standardsprache."
            : "Eigener Betreff für diese Sprache."}
        </p>
      )}
      <Button
        disabled={!selected}
        onClick={async () => {
          setError(null);
          try {
            const res = await api("/api/admin/preview", {
              method: "POST",
              body: JSON.stringify({
                template_id: text.templateId,
                subject: text.subject,
                lang: language,
              }),
            });
            if (!res.ok)
              throw new Error("Vorschau konnte nicht geladen werden.");
            const data = await res.json();
            if (
              typeof data.html !== "string" ||
              typeof data.subject !== "string"
            )
              throw new Error("Ungültige Vorschau. Bitte erneut öffnen.");
            setPreview({ signature, language, ...data });
            setError(null);
          } catch (e) {
            setError({ signature, message: e.message });
          }
        }}
      >
        Vorschau für {language.toUpperCase()} öffnen
      </Button>
      {preview && preview.signature !== signature && (
        <p role="status">
          Öffne die Vorschau erneut. Sprache oder Nachricht haben sich geändert.
        </p>
      )}
      {preview?.signature === signature && (
        <div>
          <p>
            <strong>Beispielbetreff:</strong> {preview.subject}
          </p>
          <p className="admin-muted">
            Mit denselben Beispieldaten wie die Nachricht.
          </p>
          <iframe
            sandbox=""
            title={`E-Mail-Vorschau ${preview.language.toUpperCase()}`}
            className="publication-email-preview"
            srcDoc={preview.html}
          />
        </div>
      )}
      {error?.signature === signature && <p role="alert">{error.message}</p>}
    </div>
  );
}
