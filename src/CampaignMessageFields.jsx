import { useId } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Choice } from "./ui.jsx";

export default function CampaignMessageFields({
  templates,
  templateId,
  subject,
  onTemplateChange,
  onSubjectChange,
  disabled,
  labelSuffix = "",
  allowFallback = false,
}) {
  const id = useId();
  const template = templates.find((item) => String(item.id) === templateId);
  const options = templates.map((item) => [String(item.id), item.name]);
  if (allowFallback) options.unshift(["", "wie Standardsprache"]);
  if (!template && (templateId || !allowFallback))
    options.unshift([
      templateId || "",
      templateId ? "Bisherige Vorlage nicht verfügbar" : "Vorlage wählen",
    ]);
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-template`}>Vorlage{labelSuffix}</label>
        <Choice
          id={`${id}-template`}
          label={`Vorlage${labelSuffix}`}
          value={templateId}
          options={options}
          onChange={onTemplateChange}
          disabled={disabled}
        />
      </div>
      {templateId && !template && (
        <p role="alert" className="email-failure">
          Die bisherige Vorlage fehlt. Dein Betreff und deine Sprachvarianten
          bleiben erhalten. Wähle eine andere Vorlage
          {allowFallback ? ' oder "wie Standardsprache"' : ""}, bevor du sendest
          oder einplanst.
        </p>
      )}
      <div className="field">
        <label htmlFor={`${id}-subject`}>Betreff{labelSuffix}</label>
        <Input
          id={`${id}-subject`}
          value={subject}
          placeholder={allowFallback ? "wie Standardsprache" : undefined}
          onChange={(event) => onSubjectChange(event.target.value)}
          disabled={disabled}
        />
        {template && subject !== (template.subject || "") && (
          <Button
            type="button"
            className="admin-button"
            disabled={disabled}
            onClick={() => onSubjectChange(template.subject || "")}
          >
            Vorlagenbetreff übernehmen
          </Button>
        )}
        <small>
          {allowFallback &&
            "Ohne eigenen Betreff gilt der Betreff der Standardsprache. "}
          Ein Vorlagenwechsel ändert weder deinen Betreff noch deine
          Sprachvarianten.
        </small>
      </div>
    </>
  );
}
