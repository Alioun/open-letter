import { Checkbox } from "@base-ui/react/checkbox";
import { Input } from "@base-ui/react/input";
import { Collapsible } from "@base-ui/react/collapsible";
import { Button } from "@base-ui/react/button";
import { SelectControl } from "./ui.jsx";
import { LINE_STYLES, SECTION_LABELS } from "../config/editable.js";

export function FieldEditor({ field, value, onChange }) {
  const id = `copy-${field.path}`;
  switch (field.type) {
    case "bool":
      return (
        <label className="admin-check">
          <Checkbox.Root
            className="admin-checkbox"
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
          >
            <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
          </Checkbox.Root>
          <span>{value ? "an" : "aus"}</span>
        </label>
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          min={0}
          value={value ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "sections":
      return (
        <div className="admin-check-group">
          {Object.entries(SECTION_LABELS).map(([sid, label]) => (
            <label key={sid} className="admin-check">
              <Checkbox.Root
                className="admin-checkbox"
                checked={(value || []).includes(sid)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...(value || []), sid]
                      : (value || []).filter((v) => v !== sid),
                  )
                }
              >
                <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
              </Checkbox.Root>
              <span>{label}</span>
            </label>
          ))}
        </div>
      );
    case "list":
      return (
        <Input
          render={<textarea />}
          id={id}
          rows={Math.max(3, (value || []).length + 1)}
          value={(value || []).join("\n")}
          onChange={(e) => onChange(e.target.value.split("\n"))}
        />
      );
    case "lines":
      return (
        <div className="copy-headline-editor">
          <div className="copy-headline-inputs">
            {(value || []).map((line, i) => (
              <Input
                key={i}
                type="text"
                value={line.text}
                aria-label={`Zeile ${i + 1}`}
                onChange={(e) =>
                  onChange(
                    value.map((l, j) =>
                      j === i ? { ...l, text: e.target.value } : l,
                    ),
                  )
                }
              />
            ))}
          </div>
          <Collapsible.Root className="copy-headline-options">
            <Collapsible.Trigger className="admin-disclosure-trigger">
              Zeilen gestalten oder hinzufügen
            </Collapsible.Trigger>
            <Collapsible.Panel keepMounted className="admin-disclosure-panel">
              <div className="copy-headline-options-list">
                {(value || []).map((line, i) => (
                  <div key={i} className="copy-headline-options-row">
                    <span>Zeile {i + 1}</span>
                    <SelectControl
                      value={line.style || ""}
                      aria-label={`Stil Zeile ${i + 1}`}
                      onChange={(e) =>
                        onChange(
                          value.map((l, j) =>
                            j === i ? { ...l, style: e.target.value } : l,
                          ),
                        )
                      }
                    >
                      {LINE_STYLES.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </SelectControl>
                    <Button
                      type="button"
                      aria-label={`Zeile ${i + 1} entfernen`}
                      disabled={value.length <= 1}
                      onClick={() => onChange(value.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  onClick={() =>
                    onChange([...(value || []), { text: "", style: "" }])
                  }
                >
                  + Zeile
                </Button>
              </div>
            </Collapsible.Panel>
          </Collapsible.Root>
        </div>
      );
    case "textarea":
    case "html":
      return (
        <Input
          render={<textarea />}
          id={id}
          rows={Math.min(
            8,
            Math.max(2, Math.ceil(String(value ?? "").length / 70)),
          )}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          id={id}
          type={field.type === "url" ? "url" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
