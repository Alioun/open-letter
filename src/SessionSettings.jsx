import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { Notice } from "./ui.jsx";

// "Überall abmelden": the team shares one password, so this is how a session
// left open on a lost or shared device is ended.
export default function SessionSettings({ api, askConfirmation, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logoutEverywhere(event) {
    const returnFocus = event.currentTarget;
    setError("");
    if (
      !(await askConfirmation(
        "Die Anmeldung endet sofort auf allen Geräten, auch auf diesem. Wer gerade etwas bearbeitet, verliert ungespeicherte Änderungen. Alle melden sich danach mit dem Passwort neu an.",
        {
          title: "Überall abmelden?",
          confirmLabel: "Überall abmelden",
          danger: true,
          returnFocus,
        },
      ))
    )
      return;
    setBusy(true);
    try {
      const response = await api("/api/admin/logout-everywhere", {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error);
      }
      onDone();
    } catch (failure) {
      setError(
        (failure instanceof TypeError ? "" : failure.message) ||
          "Der Server hat das Abmelden nicht bestätigt. Versuche es erneut.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="admin-card">
      <h2 className="admin-card-title" id="sessions-heading" tabIndex={-1}>
        Anmeldung
      </h2>
      <p className="admin-muted">
        Alle im Team melden sich mit demselben Passwort an und bleiben bis zu
        zwei Stunden angemeldet. Ist ein Gerät verloren gegangen oder war die
        Verwaltung auf einem anderen Rechner offen, beende hier alle Anmeldungen
        auf einmal. Kennt jemand das Passwort, der es nicht kennen soll, muss
        die Technik es zusätzlich ändern.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        type="button"
        className="admin-button admin-button--danger-secondary"
        disabled={busy}
        onClick={logoutEverywhere}
      >
        {busy ? "Wird abgemeldet…" : "Überall abmelden"}
      </Button>
    </div>
  );
}
