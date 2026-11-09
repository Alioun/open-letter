import { useId } from "react";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { MILESTONE_INPUT_ERROR } from "./milestone-form.js";

export default function MilestoneSettings({ form }) {
  const feedbackId = useId();
  return (
    <form
      className="admin-card"
      style={{ gridColumn: "1 / -1" }}
      onSubmit={form.save}
    >
      <h2
        className="admin-card-title"
        id="settings-general-heading"
        tabIndex={-1}
      >
        Unterschriftenziele
      </h2>
      <p className="admin-muted" style={{ marginBottom: 8 }}>
        Trenne die Zielmarken mit Kommas. Der Fortschrittsbalken zeigt die
        nächste Marke oberhalb der aktuellen Unterschriftenzahl als Ziel.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Input
          type="text"
          value={form.input}
          onChange={(event) => form.setInput(event.target.value)}
          disabled={!form.loaded || form.status === "saving"}
          aria-invalid={form.error === MILESTONE_INPUT_ERROR}
          aria-describedby={form.error ? feedbackId : undefined}
          placeholder="1000, 1300, 1600, 2000"
          style={{ flex: 1, minWidth: 220 }}
          aria-label="Zielmarken, mit Kommas getrennt"
        />
        <Button
          className="admin-button"
          type="submit"
          disabled={!form.loaded || form.status === "saving"}
        >
          {form.status === "saving" ? "Speichern…" : "Speichern"}
        </Button>
      </div>
      {form.status === "ok" && (
        <p className="admin-test-feedback admin-test-ok" role="status">
          Gespeichert
        </p>
      )}
      {form.error && (
        <p
          className="admin-test-feedback admin-test-error"
          id={feedbackId}
          role="alert"
        >
          {form.error}
        </p>
      )}
    </form>
  );
}
