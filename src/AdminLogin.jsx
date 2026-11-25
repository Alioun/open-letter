import { useId, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Dialog } from "@base-ui/react/dialog";
import { Notice } from "./ui.jsx";

// What the form says for a response that did not sign in. A 429 means the
// attempts ran out, not that the password was wrong, and Retry-After says how
// long that lasts.
export function loginFailure(response) {
  if (response.status === 401)
    return "Die Anmeldung ist fehlgeschlagen. Prüfe dein Passwort.";
  if (response.status !== 429)
    return "Die Anmeldung konnte nicht bestätigt werden. Versuche es erneut.";
  const seconds = Number(response.headers.get("Retry-After"));
  const minutes = Math.ceil(seconds / 60);
  const wait = !(seconds > 0)
    ? "später"
    : minutes === 1
      ? "in einer Minute"
      : `in ${minutes} Minuten`;
  return `Zu viele Anmeldeversuche. Versuche es ${wait} erneut.`;
}

export default function AdminLogin({ onLogin, expired = false, notice }) {
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
        setError(loginFailure(response));
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
    <form className="admin-card admin-login" onSubmit={login}>
      <div className="admin-wordmark admin-login-brand">Verwaltung</div>
      {expired ? (
        <Dialog.Title>Anmeldung erneuern</Dialog.Title>
      ) : (
        <h1>Anmelden</h1>
      )}
      {expired ? (
        <Dialog.Description>
          Deine Sitzung ist abgelaufen. Melde dich erneut an. Deine Eingaben
          bleiben in diesem Tab erhalten. Fehlgeschlagene Aktionen musst du
          danach selbst erneut starten.
        </Dialog.Description>
      ) : (
        <p>Melde dich mit dem Verwaltungspasswort an.</p>
      )}
      {notice && <Notice tone="success">{notice}</Notice>}
      <div className="field">
        <label htmlFor={id}>Passwort</label>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          autoFocus
          disabled={busy}
        />
      </div>
      {error && (
        <Notice tone="error" id={`${id}-error`}>
          {error}
        </Notice>
      )}
      <Button
        className="admin-button admin-button--primary admin-button--block"
        type="submit"
        disabled={busy}
      >
        {busy ? "Wird angemeldet…" : expired ? "Erneut anmelden" : "Anmelden"}
      </Button>
    </form>
  );
  if (!expired) return <main className="admin-shell login-shell">{form}</main>;
  return (
    <Dialog.Root open disablePointerDismissal>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-modal-backdrop" />
        <Dialog.Popup className="admin-dialog admin-session-login">
          {form}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
