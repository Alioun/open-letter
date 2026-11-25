import { useEffect, useId, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Breakable, EmptyState, Notice } from "./ui.jsx";
import { logTime } from "./admin-log-format.js";
import { lookupAddress, sendSignerMail } from "./signer-admin.js";

const MAIL_STATUS = {
  delivered: "Vom Mailserver angenommen",
  attempting: "Wird gerade gesendet",
  retryable: "Fehlgeschlagen, wird erneut versucht",
  unresolved: "Unklar, ob angekommen (siehe Zustellprobleme)",
};

function Signup({ signup, busy, actions, resent, onResend }) {
  return (
    <li>
      <div className="admin-card-person">
        <strong>{signup.name}</strong>
        <span>
          <Breakable text={signup.email} />
        </span>
      </div>
      <dl className="admin-facts">
        <div>
          <dt>Stand</dt>
          <dd>
            {signup.verified
              ? "Bestätigt"
              : `Noch nicht bestätigt, Link gültig bis ${logTime(signup.confirmationExpiresAt)}`}
          </dd>
        </div>
        <div>
          <dt>Eingetragen</dt>
          <dd>{logTime(signup.createdAt)}</dd>
        </div>
        <div>
          <dt>Newsletter</dt>
          <dd>
            {signup.newsletter
              ? signup.verified
                ? "Ja"
                : "Gewünscht, gilt ab der Bestätigung"
              : "Nein"}
          </dd>
        </div>
        <div>
          <dt>Öffentlich</dt>
          <dd>{signup.showPublicly ? "Ja" : "Nein"}</dd>
        </div>
      </dl>
      <div className="signer-lookup-actions">
        {signup.verified ? (
          <Button
            type="button"
            className="admin-button admin-button--small"
            disabled={busy}
            onClick={(event) => actions.edit(signup, event.currentTarget)}
          >
            Bearbeiten
          </Button>
        ) : (
          <Button
            type="button"
            className="admin-button admin-button--small"
            disabled={busy || resent?.state === "sending"}
            onClick={() => onResend(signup)}
          >
            {resent?.state === "sending"
              ? "Wird gesendet…"
              : "Bestätigung erneut senden"}
          </Button>
        )}
        <Button
          type="button"
          className="admin-button admin-button--small"
          disabled={busy}
          onClick={(event) => actions.erase(signup, event.currentTarget)}
        >
          Löschen ohne Sperre
        </Button>
        <Button
          type="button"
          className="admin-button admin-button--danger-secondary admin-button--small"
          disabled={busy}
          onClick={(event) => actions.remove(signup, event.currentTarget)}
        >
          Entfernen und sperren
        </Button>
      </div>
      {resent?.state === "sent" && (
        <Notice tone="success">
          {resent.delayed
            ? "Die Bestätigungs-E-Mail ist eingereiht und geht raus, sobald der Versand wieder läuft."
            : "Die Bestätigungs-E-Mail ist mit einem neuen Link unterwegs."}
        </Notice>
      )}
      {resent?.state === "failed" && (
        <Notice tone="error">{resent.message}</Notice>
      )}
    </li>
  );
}

// "Adresse nachschlagen": everything stored for one mailbox, unconfirmed
// sign-ups included. `version` changes whenever the list changed elsewhere, so
// an open result is read again.
export default function SignerLookup({ api, busy, actions, version }) {
  const fieldId = useId();
  const [email, setEmail] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState(null);
  const [state, setState] = useState("idle");
  const [resent, setResent] = useState({});

  useEffect(() => {
    if (!asked) return;
    let current = true;
    setState("loading");
    lookupAddress(api, asked)
      .then((found) => {
        if (!current) return;
        setResult(found);
        setState(found ? "done" : "invalid");
      })
      .catch(() => current && setState("failed"));
    return () => {
      current = false;
    };
  }, [api, asked, version]);

  async function resend(signup) {
    setResent((before) => ({ ...before, [signup.id]: { state: "sending" } }));
    let outcome;
    try {
      const { delayed } = await sendSignerMail(
        api,
        signup.id,
        "resend-confirmation",
      );
      outcome = { state: "sent", delayed };
    } catch (error) {
      outcome = { state: "failed", message: error.message };
    }
    setResent((before) => ({ ...before, [signup.id]: outcome }));
  }

  return (
    <div className="signer-lookup">
      <form
        className="admin-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          setResent({});
          setAsked(email.trim());
        }}
      >
        <label className="sr-only" htmlFor={`${fieldId}-email`}>
          E-Mail-Adresse
        </label>
        <Input
          id={`${fieldId}-email`}
          type="email"
          value={email}
          placeholder="name@beispiel.de"
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button
          type="submit"
          className="admin-button"
          disabled={!email.trim() || state === "loading"}
        >
          {state === "loading" ? "Wird gesucht…" : "Nachschlagen"}
        </Button>
      </form>
      <p className="admin-muted">
        Findet auch Eintragungen, die noch nicht bestätigt sind, und Varianten
        derselben Adresse (name+zusatz@…).
      </p>
      {state === "invalid" && (
        <Notice tone="error">Bitte gib eine gültige E-Mail-Adresse ein.</Notice>
      )}
      {state === "failed" && (
        <Notice tone="error">
          Die Adresse konnte nicht nachgeschlagen werden. Bitte erneut
          versuchen.
        </Notice>
      )}
      {result && state !== "invalid" && (
        <div aria-live="polite">
          {result.blocked && (
            <Notice
              tone="warning"
              action={
                <Button
                  type="button"
                  className="admin-button admin-button--small"
                  disabled={busy}
                  onClick={() => actions.unblock(result.email)}
                >
                  Sperre aufheben
                </Button>
              }
            >
              Diese Adresse ist gesperrt und kann nicht unterschreiben.
            </Notice>
          )}
          {result.signups.length > 0 ? (
            <ul className="signer-lookup-results">
              {result.signups.map((signup) => (
                <Signup
                  key={signup.id}
                  signup={signup}
                  busy={busy}
                  actions={actions}
                  resent={resent[signup.id]}
                  onResend={resend}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              title={`Zu ${result.email} ist keine Unterschrift gespeichert.`}
            >
              Nicht bestätigte Eintragungen werden gelöscht, sobald ihr
              Bestätigungslink abgelaufen ist.
            </EmptyState>
          )}
          {result.meeting && (
            <p className="admin-muted">
              {result.meeting === "registered"
                ? "Zum Treffen angemeldet."
                : "Anmeldung zum Treffen wartet auf Bestätigung."}
            </p>
          )}
          <h4 className="signer-lookup-heading">E-Mails an diese Adresse</h4>
          {result.queued > 0 && (
            <p>
              {result.queued === 1
                ? "1 E-Mail wartet auf den Versand."
                : `${result.queued} E-Mails warten auf den Versand.`}
            </p>
          )}
          {result.mail.length > 0 ? (
            <ul className="signer-lookup-mail">
              {result.mail.map((attempt, index) => (
                <li key={index}>
                  <time dateTime={attempt.at}>{logTime(attempt.at)}</time>{" "}
                  {MAIL_STATUS[attempt.status] || attempt.status}
                </li>
              ))}
            </ul>
          ) : (
            result.queued === 0 && (
              <p className="admin-muted">
                Keine Sendeversuche gespeichert. Versuche werden nur eine
                begrenzte Zeit aufbewahrt.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
