import { useEffect, useState, useId, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Collapsible } from "@base-ui/react/collapsible";
import { Choice, Notice } from "./ui.jsx";
import EmailFailure from "./EmailFailure.jsx";
import { emailProfileBlockers } from "../config/email-blockers.js";
import { identifiedEmailTest } from "../config/email-test.js";
import EmailTestReceipt from "./EmailTestReceipt.jsx";
import EmailProfileReview from "./EmailProfileReview.jsx";
import TechnicalReport from "./TechnicalReport.jsx";
import { deliveryCounts } from "./DeliveryBanner.jsx";
import { failedMailSummary } from "./delivery-advice.js";

const initial = {
  provider: "mailbox.org",
  from: "",
  host: "smtp.mailbox.org",
  port: 465,
  secure: true,
  user: "",
  secret: "",
  processor: "mailbox.org / Heinlein Support GmbH",
  region: "Germany",
};

function SetupChoice({ label, ...props }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <Choice id={id} label={label} {...props} />
    </div>
  );
}

function SetupStage({ title, available, prerequisite, children }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Collapsible.Root
      className="email-setup-stage"
      open={available || expanded}
      onOpenChange={setExpanded}
    >
      <h3>
        {available ? (
          title
        ) : (
          <Collapsible.Trigger className="admin-disclosure-trigger">
            {title}
          </Collapsible.Trigger>
        )}
      </h3>
      {!available && <p className="admin-muted">{prerequisite}</p>}
      <Collapsible.Panel keepMounted>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

const MESSAGE_STATUS = [
  ["delivered", "Angenommen"],
  ["retryable", "Wird erneut versucht"],
  ["unresolved", "Ergebnis unklar"],
];

const messages = (n) =>
  `${n.toLocaleString("de-DE")} ${n === 1 ? "Nachricht" : "Nachrichten"}`;

export function DeliveryProblems({
  state,
  disabled,
  onAction,
  feedback,
  confirm = async () => true,
}) {
  const { unclear, failed } = deliveryCounts(state);
  if (!unclear && !failed) return null;
  const summary = failedMailSummary(state.queue?.failedDetail, failed);
  const confirmed = async (message, options, ...action) => {
    if (await confirm(message, options)) onAction(...action);
  };
  return (
    <div className="email-delivery-problems">
      <h3>Zustellprobleme</h3>
      {unclear > 0 && (
        <section aria-labelledby="unclear-heading">
          <h4 id="unclear-heading">
            {messages(unclear)} mit unklarem Ergebnis
          </h4>
          <p>
            Die Verbindung zum Anbieter brach ab, bevor er die Annahme bestätigt
            hat. Ob diese Nachrichten angekommen sind, lässt sich nicht mehr
            feststellen. Bestätigungsmails sendet die Seite inzwischen von
            selbst erneut. Für die übrigen entscheidest du hier einmal für alle.
          </p>
          <div className="admin-actions">
            <Button
              className="admin-button"
              disabled={disabled}
              onClick={() =>
                confirmed(
                  `${messages(unclear)} werden noch einmal gesendet. Wer eine davon schon bekommen hat, erhält sie doppelt.`,
                  {
                    title: `${messages(unclear)} erneut senden?`,
                    confirmLabel: "Erneut senden",
                  },
                  "reconcile-all",
                  { resolution: "retryable" },
                )
              }
            >
              Alle erneut senden
            </Button>
            <Button
              className="admin-button admin-button--danger-secondary"
              disabled={disabled}
              onClick={() =>
                confirmed(
                  `${messages(unclear)} gelten als angekommen und werden nicht noch einmal gesendet. Wer eine davon nicht bekommen hat, bekommt sie nie. Das lässt sich nicht rückgängig machen.`,
                  {
                    title: "Ohne erneuten Versand abschließen?",
                    confirmLabel: "Ohne Versand abschließen",
                    danger: true,
                  },
                  "reconcile-all",
                  { resolution: "delivered" },
                )
              }
            >
              Ohne erneuten Versand abschließen
            </Button>
          </div>
          <p className="admin-muted">
            Erneut senden ist meist richtig. Einzelne Empfänger bekommen dann
            eine Nachricht vielleicht doppelt, aber niemand bleibt ohne.
          </p>
          {feedback(["reconcile-all"])}
        </section>
      )}
      {failed > 0 && (
        <section aria-labelledby="failed-heading">
          <h4 id="failed-heading">
            {failed.toLocaleString("de-DE")}{" "}
            {failed === 1 ? "E-Mail" : "E-Mails"} nicht angekommen
          </h4>
          <p>
            Der Versand hat es bei diesen E-Mails mehrmals versucht und dann
            aufgegeben:
          </p>
          <ul className="email-failed-kinds">
            {summary.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {summary.effects.map((effect) => (
            <p key={effect}>{effect}</p>
          ))}
          <p className="admin-muted">
            {[summary.span, summary.retry].filter(Boolean).join(" ")} Wer
            inzwischen bestätigt hat oder dessen Link abgelaufen ist, bekommt
            nichts mehr.
          </p>
          {state.failure && (
            <p>
              <strong>
                Behebe zuerst die Störung oben, sonst schlagen sie gleich wieder
                fehl.
              </strong>
            </p>
          )}
          <div className="admin-actions">
            <Button
              className="admin-button"
              disabled={disabled || summary.retryable === 0}
              onClick={() =>
                confirmed(
                  `${summary.retry} Wer inzwischen bestätigt hat oder dessen Link abgelaufen ist, bekommt nichts mehr.`,
                  {
                    title: "Nicht angekommene E-Mails noch einmal senden?",
                    confirmLabel: "Noch einmal senden",
                  },
                  "requeue-failed",
                )
              }
            >
              Noch einmal senden
            </Button>
          </div>
          {feedback(["requeue-failed"])}
        </section>
      )}
    </div>
  );
}

export default function EmailSetup({ api, onDirty, askConfirmation }) {
  const [state, setState] = useState(null);
  const [profile, setProfile] = useState(initial);
  const [providerDrafts, setProviderDrafts] = useState({});
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("");
  const [actionResult, setActionResult] = useState(null);
  const actionFeedback = useRef(null);
  const generalFeedback = useRef(null);
  const [domain, setDomain] = useState("");
  const [dns, setDns] = useState(null);
  const [dnsBusy, setDnsBusy] = useState(false);
  const [dnsStatus, setDnsStatus] = useState("");
  const [dnsError, setDnsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const profileSubmit = useRef(null);
  const actionsBlocked = busy || Boolean(conflict);
  const [loadError, setLoadError] = useState("");
  const saved = state?.candidate || state?.active;
  const blockers = emailProfileBlockers(saved);
  const profileDirty =
    Boolean(profile.secret) ||
    Object.keys(initial).some(
      (key) =>
        key !== "secret" &&
        String(profile[key] ?? "") !==
          String({ ...initial, ...saved }[key] ?? ""),
    );
  const otherProviderDirty = Object.entries(providerDrafts).some(
    ([provider, draft]) => provider !== profile.provider && draft.dirty,
  );
  useEffect(() => {
    onDirty?.(
      Boolean(
        state?.source === "admin" && (profileDirty || otherProviderDirty),
      ),
    );
  }, [state?.source, profileDirty, otherProviderDirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  function selectProvider(provider) {
    if (provider === profile.provider) return;
    setProviderDrafts((drafts) => ({
      ...drafts,
      [profile.provider]: { profile, dirty: profileDirty },
    }));
    setProfile(
      providerDrafts[provider]?.profile || {
        ...initial,
        provider,
        from: profile.from,
        ...(provider === "resend"
          ? {
              host: "api.resend.com",
              port: 443,
              secure: true,
              processor: "Resend",
              region: "",
            }
          : provider === "smtp"
            ? { host: "", processor: "", region: "" }
            : {}),
      },
    );
  }
  async function load(keepInputs = false) {
    setBusy(true);
    setLoadError("");
    try {
      const response = await api("/api/admin/email");
      if (!response.ok) throw new Error("load failed");
      const next = await response.json();
      if (
        !Number.isInteger(next.revision) ||
        !["admin", "deployment"].includes(next.source)
      )
        throw new Error("invalid configuration response");
      setState(next);
      setActionResult(null);
      if (!keepInputs)
        setProfile({
          ...initial,
          ...(next.candidate || next.active),
          secret: "",
        });
      setConflict(keepInputs ? { phase: "review" } : null);
      setStatus(
        keepInputs
          ? "Der gespeicherte Stand ist geladen. Deine Eingaben sind noch nicht gespeichert."
          : "",
      );
    } catch {
      const message =
        "Die E-Mail-Einstellungen konnten nicht geladen werden. Das gespeicherte Profil bleibt unverändert. Lade die Einstellungen erneut.";
      if (state) setStatus(message);
      else setLoadError(message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  function feedback(keys) {
    if (!actionResult || !keys.includes(actionResult.key)) return null;
    return (
      <Notice
        ref={actionFeedback}
        tabIndex={-1}
        tone={actionResult.error ? "error" : "success"}
        className="email-action-feedback"
      >
        {actionResult.message}
      </Notice>
    );
  }
  async function action(action, extra = {}) {
    if (!state || actionsBlocked) return;
    const returnFocus = document.activeElement;
    const key = action === "reconcile" ? `reconcile:${extra.scope}` : action;
    const label = {
      takeover: "Verwaltung übernehmen",
      save: "Versandprofil speichern",
      test: "Verbindung prüfen und Test senden",
      receipt: "Empfang bestätigen",
      activate: "Automatischen Versand freigeben",
      reconcile: "Versand abgleichen",
      "reconcile-all": "Unklare Nachrichten abgleichen",
      "requeue-failed": "Nicht angekommene E-Mails noch einmal senden",
    }[action];
    setStatus("");
    setActionResult({ key, message: `${label}: Bitte warten…` });
    setBusy(true);
    requestAnimationFrame(() => {
      actionFeedback.current?.focus({ preventScroll: true });
      actionFeedback.current?.scrollIntoView({ block: "nearest" });
    });
    try {
      const r = await api("/api/admin/email", {
        method: "POST",
        body: JSON.stringify({
          action,
          expectedRevision: state.revision,
          ...(action === "save" ? { profile } : {}),
          ...extra,
        }),
      });
      const result = await r.json();
      if (r.status === 409) {
        setConflict({ phase: "reload" });
        throw new Error(
          "Das Versandprofil wurde inzwischen geändert. Deine Eingaben bleiben erhalten. Lade den aktuellen Stand, bevor du sie erneut speicherst.",
        );
      }
      if (!r.ok) throw new Error(result.error);
      if (
        !Number.isInteger(result.revision) ||
        !["admin", "deployment"].includes(result.source)
      )
        throw new SyntaxError("Invalid email response");
      setState(result);
      window.dispatchEvent(new Event("email-configuration-changed"));
      if (["save", "takeover"].includes(action))
        setProfile({
          ...initial,
          ...(result.candidate || result.active),
          secret: "",
        });
      const error = action === "test" && Boolean(result.setupFailure);
      let message = `${label}: abgeschlossen.`;
      if (error)
        message = "Die Prüfung ist fehlgeschlagen. Folge den Hinweisen unten.";
      else if (action === "save")
        message = "Versandprofil gespeichert. Sende jetzt eine Testnachricht.";
      setActionResult({ key, message, error });
      if (action === "takeover") setStatus(message);
    } catch (e) {
      const message =
        e instanceof TypeError || e instanceof SyntaxError
          ? "Der Server hat die Aktion nicht bestätigt. Deine Eingaben bleiben erhalten. Lade den aktuellen Stand, bevor du die Aktion wiederholst. Prüfe nach einem Testversand auch das Testpostfach."
          : e.message ||
            "Die Aktion konnte nicht abgeschlossen werden. Prüfe den gespeicherten Stand, bevor du es erneut versuchst.";
      setActionResult({ key, message: `${label}: ${message}`, error: true });
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        const target =
          returnFocus?.isConnected && !returnFocus.disabled
            ? returnFocus
            : actionFeedback.current || generalFeedback.current;
        target?.focus({ preventScroll: true });
        (actionFeedback.current || generalFeedback.current)?.scrollIntoView({
          block: "nearest",
        });
      });
    }
  }
  async function checkDns() {
    if (dnsBusy) return;
    setDnsBusy(true);
    setDns(null);
    setDnsError("");
    setDnsStatus("DNS-Einträge werden geprüft…");
    try {
      const response = await api("/api/admin/email/dns", {
        method: "POST",
        body: JSON.stringify({ domain: domain.trim() }),
      });
      if (!response.ok) throw new Error("DNS check failed");
      const result = await response.json();
      if (
        !Array.isArray(result.results) ||
        typeof result.domain !== "string" ||
        typeof result.notice !== "string"
      )
        throw new Error("Invalid DNS response");
      setDns(result);
      setDnsStatus(
        "Die DNS-Prüfung ist abgeschlossen. Die Ergebnisse stehen unten.",
      );
    } catch {
      setDnsStatus("");
      setDnsError(
        "Die DNS-Prüfung konnte nicht abgeschlossen werden. Prüfe die Absenderdomain und starte die Prüfung erneut.",
      );
    } finally {
      setDnsBusy(false);
    }
  }
  if (!state)
    return (
      <div className="admin-card email-setup">
        <h2 id="settings-email-heading" tabIndex={-1}>
          E-Mail-Versand
        </h2>
        <p role={loadError ? "alert" : "status"}>
          {loadError || "E-Mail-Konfiguration wird geladen…"}
        </p>
        <Button className="admin-button" disabled={busy} onClick={() => load()}>
          {busy ? "Wird geladen…" : "Erneut laden"}
        </Button>
      </div>
    );
  // Typing in the folded form must not unfold it (that would remount the
  // inputs), so only the saved state decides.
  const activeIdle = state.ready && Boolean(state.active) && !state.candidate;
  const lastSuccess = state.lastSuccess
    ? new Date(state.lastSuccess).toLocaleString("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "noch keiner";
  const steps = (
    <>
      <p className="email-intro">
        Richte ein Postfach oder einen Versanddienst ein. In drei Schritten:
        Zugangsdaten speichern, Testnachricht senden und ihren Empfang
        bestätigen, dann den Versand freigeben.
      </p>
      {!activeIdle && (
        <p role="status">
          {state.ready ? "Versand aktiv" : "Versand pausiert"} ·{" "}
          {state.source === "deployment"
            ? "Profil aus den Servereinstellungen"
            : "Profil hier verwaltet"}
        </p>
      )}
      {status && !activeIdle && (
        <p
          ref={generalFeedback}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {status}
        </p>
      )}
      {state.source === "deployment" && (
        <div className="email-takeover">
          <p>
            Die Übernahme speichert das Profil und seine Zugangsdaten in der
            verschlüsselten Datenbank. Danach kannst du es hier bearbeiten. Der
            Versand wird dadurch nicht aktiviert.
          </p>
          <Button disabled={actionsBlocked} onClick={() => action("takeover")}>
            Verwaltung hier übernehmen
          </Button>
          {feedback(["takeover"])}
        </div>
      )}
      {blockers.length > 0 && (
        <div className="email-failure" role="status">
          <strong>
            {state.source === "deployment"
              ? "Profil aus Servereinstellungen"
              : state.candidate
                ? "Gespeichertes neues Profil"
                : "Gespeichertes Versandprofil"}
            {saved?.provider ? ` (${saved.provider})` : ""}: Schritt 1 ist noch
            unvollständig
          </strong>
          <ul>
            {blockers.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <p>
            {state.source === "admin" && profileDirty
              ? `Diese Hinweise betreffen den gespeicherten Stand. Deine Eingaben für ${profile.provider} sind noch nicht gespeichert. Vervollständige und speichere das Profil, bevor du es testest.`
              : state.source === "deployment"
                ? "Übernimm die Verwaltung hier und ergänze die fehlenden Angaben. Alternativ kann dein technischer Betrieb das Profil in den Servereinstellungen vervollständigen. Prüfe danach die Verbindung."
                : "Ergänze Absender und Zugangsdaten in Schritt 1. Speichere das Profil, um die Verbindung zu testen."}
          </p>
        </div>
      )}
      {conflict?.phase === "reload" && (
        <div className="email-failure" role="alert">
          <p>
            Lade das gespeicherte Profil und vergleiche es mit deinen Eingaben.
            Deine Eingaben bleiben erhalten. Wenn du sie erneut speicherst,
            musst du das Profil erneut testen.
          </p>
          <Button disabled={busy} onClick={() => load(true)}>
            Gespeichertes Profil zum Vergleich laden
          </Button>
        </div>
      )}
      {conflict?.phase === "review" && (
        <EmailProfileReview
          saved={saved}
          local={profile}
          revision={state.revision}
          onContinue={() => {
            setConflict(null);
            setStatus(
              "Vergleich geprüft. Deine Eingaben sind noch nicht gespeichert.",
            );
            requestAnimationFrame(() => {
              profileSubmit.current?.focus({ preventScroll: true });
              profileSubmit.current?.scrollIntoView({ block: "nearest" });
            });
          }}
        />
      )}
      <Collapsible.Root className="email-profile-details">
        <Collapsible.Trigger className="admin-disclosure-trigger">
          Aktuelles Profil: {state.active?.provider || "Noch kein Anbieter"}
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <p>{state.active?.from || "Noch keine Absenderadresse"}</p>
          <p>{state.ready ? "Versand bereit" : "Versand pausiert"}</p>
        </Collapsible.Panel>
      </Collapsible.Root>
      {state.source === "admin" && (
        <>
          <SetupChoice
            label="Versand einrichten"
            disabled={actionsBlocked}
            value={profile.provider === "resend" ? "service" : "mailbox"}
            onChange={(v) =>
              selectProvider(v === "service" ? "resend" : "mailbox.org")
            }
            options={[
              ["mailbox", "Vorhandenes Postfach"],
              ["service", "E-Mail-Versanddienst"],
            ]}
          />
          {profile.provider !== "resend" && (
            <SetupChoice
              label="Postfachanbieter"
              disabled={actionsBlocked}
              value={profile.provider}
              onChange={selectProvider}
              options={[
                ["mailbox.org", "mailbox.org"],
                ["smtp", "Eigener SMTP-Server"],
              ]}
            />
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action("save");
            }}
          >
            <h3>1. Absender und Zugangsdaten</h3>
            <fieldset disabled={actionsBlocked}>
              <label className="field">
                Absenderadresse oder registrierter Alias
                <Input
                  required
                  value={profile.from}
                  onChange={(e) =>
                    setProfile({ ...profile, from: e.target.value })
                  }
                />
              </label>
              {profile.provider !== "resend" && (
                <>
                  {["host", "user", "processor", "region"].map((key) => (
                    <label className="field" key={key}>
                      {
                        {
                          user: "Hauptadresse für die Anmeldung",
                          host: "SMTP-Server",
                          processor: "Betreiber des Versanddienstes",
                          region: "Verarbeitungsregion",
                        }[key]
                      }
                      <Input
                        required
                        value={profile[key]}
                        onChange={(e) =>
                          setProfile({ ...profile, [key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  {profile.provider === "smtp" ? (
                    <>
                      <label className="field">
                        SMTP-Port
                        <Input
                          required
                          type="number"
                          min="1"
                          max="65535"
                          value={profile.port}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              port: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <SetupChoice
                        label="SMTP-Verschlüsselung"
                        value={profile.secure ? "tls" : "starttls"}
                        options={[
                          ["tls", "TLS ab Verbindungsaufbau"],
                          ["starttls", "STARTTLS erforderlich"],
                        ]}
                        onChange={(value) =>
                          setProfile({ ...profile, secure: value === "tls" })
                        }
                      />
                      <p>
                        Nutze Port und Verschlüsselung aus der Anleitung deines
                        Anbieters. Das Serverzertifikat wird immer geprüft.
                      </p>
                    </>
                  ) : (
                    <SetupChoice
                      label="Verschlüsselung"
                      value={String(profile.port)}
                      onChange={(v) =>
                        setProfile({
                          ...profile,
                          port: Number(v),
                          secure: v === "465",
                        })
                      }
                      options={[
                        ["465", "465 · TLS"],
                        ["587", "587 · STARTTLS erforderlich"],
                      ]}
                    />
                  )}
                </>
              )}
              {profile.provider === "resend" && (
                <label className="field">
                  Verarbeitungsregion laut Resend-Konto
                  <Input
                    required
                    value={profile.region}
                    onChange={(e) =>
                      setProfile({ ...profile, region: e.target.value })
                    }
                    placeholder="Region aus den Anbieter- und Kontoeinstellungen"
                  />
                  <small>
                    Prüfe beim Anbieter, wo und durch wen er die Daten
                    verarbeiten lässt. Die angegebene Region erscheint in der
                    öffentlichen Datenschutzerklärung.
                  </small>
                </label>
              )}
              <label className="field">
                {profile.provider === "resend"
                  ? "Resend-API-Schlüssel"
                  : "App-Passwort"}
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={profile.secret}
                  placeholder={
                    profile.provider === "resend"
                      ? "API-Schlüssel"
                      : "App-Passwort"
                  }
                  aria-describedby="email-secret-help"
                  onChange={(e) =>
                    setProfile({ ...profile, secret: e.target.value })
                  }
                />
                <small id="email-secret-help">
                  Lass das Feld leer, um die gespeicherten Zugangsdaten zu
                  behalten. Wenn du Anbieter, Server oder Konto wechselst, musst
                  du neue Zugangsdaten eingeben.
                </small>
              </label>
              <Button
                type="submit"
                className="admin-button admin-button--primary"
                ref={profileSubmit}
                disabled={actionsBlocked}
              >
                {state.active
                  ? "Neues Profil speichern"
                  : "Versandprofil speichern"}
              </Button>
            </fieldset>
            {feedback(["save"])}
            {profileDirty && (
              <p role="status">
                Speichere das Profil vor dem Test.{" "}
                {state.ready
                  ? "Bis zur Freigabe des neuen Profils versendet das bisherige weiter."
                  : "Der Versand bleibt bis zur geprüften Freigabe pausiert."}
              </p>
            )}
          </form>
          {profile.provider === "mailbox.org" && (
            <>
              <p>
                Erstelle bei mailbox.org ein App-Passwort. Verwende die
                Hauptadresse für die Anmeldung und registriere den
                Absender-Alias im Konto. Bestätige deine Domain nach der
                Anleitung deines Kontos. Teste den Empfang auch außerhalb von
                mailbox.org, da Testkonten den Versand einschränken können.
                Diese Einrichtung ändert keine MX-Einträge und keine eingehenden
                E-Mails.
              </p>
              <label className="field">
                Absenderdomain
                <Input
                  value={domain}
                  disabled={dnsBusy}
                  onChange={(e) => {
                    setDomain(e.target.value);
                    setDns(null);
                    setDnsError("");
                    setDnsStatus("");
                  }}
                />
              </label>
              <Button
                disabled={busy || dnsBusy || !domain.trim()}
                onClick={checkDns}
              >
                {dnsBusy
                  ? "DNS wird geprüft…"
                  : dnsError
                    ? "DNS-Prüfung erneut starten"
                    : "DNS-Einträge anzeigen und prüfen"}
              </Button>
              {dnsStatus && <Notice>{dnsStatus}</Notice>}
              {dnsError && <Notice tone="error">{dnsError}</Notice>}
              {dns && (
                <>
                  <p>{dns.notice}</p>
                  {dns.results.map((record) => (
                    <div key={record.name}>
                      <strong>
                        {record.type} {record.name}
                      </strong>
                      <pre>{record.value}</pre>
                      <Button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              `${record.name} ${record.type} ${record.value}`,
                            );
                            setDnsStatus("DNS-Eintrag kopiert.");
                            setDnsError("");
                          } catch {
                            setDnsStatus(
                              "Markiere und kopiere den DNS-Eintrag. Automatisches Kopieren ist hier nicht verfügbar.",
                            );
                          }
                        }}
                      >
                        Eintrag kopieren
                      </Button>
                      <p>
                        {record.published
                          ? "Eintrag veröffentlicht"
                          : "Nicht bestätigt"}{" "}
                        {record.note}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
      <SetupStage
        title="2. Testen und Empfang bestätigen"
        available={Boolean(saved) && !profileDirty && blockers.length === 0}
        prerequisite="Nach dem Speichern eines vollständigen Versandprofils verfügbar."
      >
        <p>
          Prüfe, ob die Testnachricht angekommen ist, auch im Spamordner. Die
          Annahme durch den Anbieter bestätigt noch keinen Empfang.
        </p>
        <label className="field">
          Testadresse
          <Input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <EmailTestReceipt validation={state.validation} />
        <div className="admin-actions">
          <Button
            disabled={
              actionsBlocked ||
              profileDirty ||
              !recipient ||
              !(state.candidate || state.active) ||
              blockers.length > 0
            }
            onClick={() => action("test", { recipient })}
          >
            Verbindung prüfen und Test senden
          </Button>
          <Button
            disabled={
              actionsBlocked ||
              profileDirty ||
              !identifiedEmailTest(state.validation) ||
              state.validation.received
            }
            onClick={() => action("receipt", { testId: state.validation.id })}
          >
            {state.validation?.received
              ? "Empfang bestätigt"
              : "Empfang dieser Testnachricht bestätigen"}
          </Button>
          {feedback(["test", "receipt"])}
        </div>
      </SetupStage>
      <SetupStage
        title="3. Versand freigeben"
        available={
          !profileDirty &&
          blockers.length === 0 &&
          identifiedEmailTest(state.validation) &&
          state.validation.received
        }
        prerequisite="Nach einem erfolgreichen Test und bestätigtem Empfang verfügbar."
      >
        <div className="email-activation-review">
          <p id="email-activation-impact">
            Die Aktivierung gibt den automatischen Versand frei.{" "}
            {state.queue?.available === false
              ? "nicht verfügbar"
              : state.queue?.queued || 0}{" "}
            Nachrichten warten auf den Versand. Nach der Aktivierung können auch
            fällige Kampagnen und automatische Zoom-E-Mails starten. Prüfe
            vorher ihre Termine und veröffentlichten Inhalte.
          </p>
          <p>
            {state.queue?.available === false
              ? "nicht verfügbar"
              : state.queue?.failed || 0}{" "}
            Nachrichten wurden nach mehreren Fehlern angehalten. Abgebrochene
            Kampagnen und Zoom-E-Mails brauchen eine eigene Freigabe für den
            erneuten Versand.
          </p>
          <Button
            className="admin-button admin-button--primary"
            aria-describedby="email-activation-impact"
            disabled={
              actionsBlocked ||
              profileDirty ||
              !identifiedEmailTest(state.validation) ||
              !state.validation.received
            }
            onClick={() => action("activate")}
          >
            Profil aktivieren und Versand freigeben
          </Button>
          {feedback(["activate"])}
        </div>
      </SetupStage>
    </>
  );
  return (
    <div className="admin-card email-setup">
      <h2 id="settings-email-heading" tabIndex={-1}>
        E-Mail-Versand
      </h2>
      {state.jobs?.ready === false && (
        <Notice tone="error" title="Anmeldungen und Versand stehen still">
          Neue Unterschriften und Kampagnen werden nicht angenommen, Löschläufe
          und Sicherungen laufen nicht. Die Technik muss den Versanddienst neu
          starten.
          <TechnicalReport
            lines={[
              `Zeitpunkt: ${new Date().toISOString()}`,
              "Hintergrundverarbeitung (Honker-Warteschlange) nicht bereit",
              "Serverprotokoll beim Start prüfen, danach den Dienst neu starten",
            ]}
          />
        </Notice>
      )}
      <EmailFailure
        failure={state.failure}
        title="Aktueller Versand"
        profile={state.active}
      />
      <DeliveryProblems
        state={state}
        disabled={actionsBlocked}
        onAction={action}
        feedback={feedback}
        confirm={askConfirmation}
      />
      {activeIdle ? (
        <>
          <Notice
            tone={state.failure ? "warning" : "success"}
            title={
              state.failure
                ? "Versand eingerichtet, aber gestört"
                : "Versand aktiv"
            }
          >
            {state.activatedAt
              ? `Seit ${new Date(state.activatedAt).toLocaleString("de-DE", { dateStyle: "long", timeStyle: "short" })}`
              : "Freigegeben"}
            {state.active.from ? ` · Absender ${state.active.from}` : ""}
            {state.active.provider ? ` · ${state.active.provider}` : ""}
          </Notice>
          {status && (
            <p ref={generalFeedback} tabIndex={-1} role="status">
              {status}
            </p>
          )}
          <Collapsible.Root className="email-change-profile">
            <Collapsible.Trigger className="admin-disclosure-trigger">
              Profil ändern
            </Collapsible.Trigger>
            <Collapsible.Panel className="admin-disclosure-panel">
              {steps}
            </Collapsible.Panel>
          </Collapsible.Root>
        </>
      ) : (
        steps
      )}
      <p className="admin-muted">
        Letzter erfolgreicher Versand: {lastSuccess} ·{" "}
        {MESSAGE_STATUS.map(([status, label]) => {
          const count =
            state.messages?.find((m) => m.status === status)?.count || 0;
          return `${label}: ${count}`;
        }).join(" · ")}{" "}
        · In der Warteschlange:{" "}
        {state.queue?.available === false
          ? "nicht verfügbar"
          : state.queue?.queued || 0}
      </p>
      <EmailFailure
        failure={state.setupFailure}
        title="Einrichtungstest"
        profile={state.candidate || state.active}
      />
    </div>
  );
}
