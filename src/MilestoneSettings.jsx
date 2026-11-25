import { useId } from "react";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { MILESTONE_INPUT_ERROR } from "./milestone-form.js";
import { Notice } from "./ui.jsx";

export default function MilestoneSettings({ form, signerCount }) {
  const feedbackId = useId();
  const marks = form.input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const allReached =
    Number.isFinite(signerCount) &&
    marks.length > 0 &&
    marks.every((mark) => Number.isFinite(mark) && mark <= signerCount);
  return (
    <form className="admin-card admin-card--wide" onSubmit={form.save}>
      <h2
        className="admin-card-title"
        id="settings-general-heading"
        tabIndex={-1}
      >
        Unterschriftenziele
      </h2>
      <p className="admin-muted">
        Trenne die Zielmarken mit Kommas. Der Fortschrittsbalken zeigt die
        nächste Marke oberhalb der aktuellen Unterschriftenzahl als Ziel.
      </p>
      <div className="admin-inline-form">
        <Input
          type="text"
          value={form.input}
          onChange={(event) => form.setInput(event.target.value)}
          disabled={!form.loaded || form.status === "saving"}
          aria-invalid={form.error === MILESTONE_INPUT_ERROR}
          aria-describedby={form.error ? feedbackId : undefined}
          placeholder="1000, 1300, 1600, 2000"
          aria-label="Zielmarken, mit Kommas getrennt"
        />
        <Button
          className="admin-button admin-button--primary"
          type="submit"
          disabled={!form.loaded || form.status === "saving"}
        >
          {form.status === "saving" ? "Speichern…" : "Speichern"}
        </Button>
      </div>
      {allReached && (
        <Notice tone="warning">
          Alle Zielmarken sind mit {signerCount.toLocaleString("de-DE")}{" "}
          Unterschriften schon erreicht. Der Fortschrittsbalken hat dann kein
          nächstes Ziel. Ergänze eine höhere Marke.
        </Notice>
      )}
      {form.status === "ok" && <Notice tone="success">Gespeichert</Notice>}
      {form.error && (
        <Notice tone="error" id={feedbackId}>
          {form.error}
        </Notice>
      )}
    </form>
  );
}
