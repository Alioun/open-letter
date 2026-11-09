import { useId, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Dialog } from "@base-ui/react/dialog";

export default function AdminLogin({ onLogin, expired = false }) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError("Die Anmeldung ist fehlgeschlagen. Prüfe dein Passwort.");
        return;
      }
      const { token } = await response.json();
      onLogin(token);
    } catch {
      setError(
        "Die Anmeldung konnte nicht bestätigt werden. Versuche es erneut.",
      );
    } finally {
      setBusy(false);
    }
  }
  const form = (
    <form className="form-card admin-login" onSubmit={login}>
      <span className="badge">Admin</span>
      {expired ? (
        <Dialog.Title>Anmeldung erneuern</Dialog.Title>
      ) : (
        <h1>Verwaltung</h1>
      )}
      {expired ? (
        <Dialog.Description>
          Deine Sitzung ist abgelaufen. Melde dich erneut an. Deine Eingaben
          bleiben in diesem Tab erhalten. Fehlgeschlagene Aktionen musst du
          danach selbst erneut starten.
        </Dialog.Description>
      ) : (
        <p className="sub2">Melde dich mit dem Verwaltungspasswort an.</p>
      )}
      <div className="field">
        <label htmlFor={id}>Passwort</label>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          disabled={busy}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button className="cta" type="submit" disabled={busy}>
        {busy ? "Wird angemeldet…" : expired ? "Erneut anmelden" : "Anmelden"}
      </Button>
    </form>
  );
  if (!expired) return <main className="admin-shell login-shell">{form}</main>;
  return (
    <Dialog.Root open disablePointerDismissal>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-modal-backdrop" />
        <Dialog.Popup className="base-modal-popup admin-session-login admin-shell">
          {form}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
