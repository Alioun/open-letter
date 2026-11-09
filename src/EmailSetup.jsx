import { useEffect, useState, useId, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Collapsible } from "@base-ui/react/collapsible";
import { Choice } from "./ui.jsx";
import EmailFailure from "./EmailFailure.jsx";
import { emailProfileBlockers } from "../config/email-blockers.js";
import { identifiedEmailTest } from "../config/email-test.js";
import EmailTestReceipt from "./EmailTestReceipt.jsx";
import EmailProfileReview from "./EmailProfileReview.jsx";

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

export default function EmailSetup({ api, onDirty }) {
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
      <p
        ref={actionFeedback}
        tabIndex={-1}
        role={actionResult.error ? "alert" : "status"}
        className={`email-action-feedback${actionResult.error ? " is-error" : ""}`}
      >
        {actionResult.message}
      </p>
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
      const message =
        result.setupFailure || result.failure
          ? "Die Prüfung ist fehlgeschlagen. Folge den Hinweisen unten."
          : `${label}: abgeschlossen.`;
      setActionResult({
        key,
        message,
        error: Boolean(result.setupFailure || result.failure),
      });
      if (action === "takeover") setStatus(message);
    } catch (e) {
      const message =
        e instanceof TypeError || e instanceof SyntaxError
          ? "Die Antwort des Servers bestätigt die Aktion nicht. Deine Eingaben bleiben erhalten. Lade den aktuellen Stand, bevor du die Aktion wiederholst. Prüfe nach einem Testversand auch das Testpostfach."
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
  return (
    <div className="admin-card email-setup">
      <h2 id="settings-email-heading" tabIndex={-1}>
        E-Mail-Versand
      </h2>
      {state.jobs?.ready === false && (
        <p className="admin-error" role="alert">
          Die Hintergrundverarbeitung ist ausgefallen. Neue Anmeldungen und
          Kampagnen werden nicht angenommen. Auch automatische Löschläufe und
          Sicherungen stehen still. Prüfe den Honker-Start im Serverprotokoll
          und starte den Dienst danach neu.
        </p>
      )}
      <p className="email-intro">
        Richte ein Postfach oder einen Versanddienst ein. Ein Ersatzprofil
        kannst du nach einem Test mit bestätigtem Empfang aktivieren.
      </p>
      <p role="status">
        {state.ready
          ? "Versand bereit"
          : "Versand pausiert oder nicht verfügbar"}{" "}
        ·{" "}
        {state.source === "deployment"
          ? "Servereinstellungen"
          : "Hier verwaltet"}{" "}
        · Revision {state.revision}
      </p>
      {status && (
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
                ? "Gespeichertes Ersatzprofil"
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
              ? `Diese Hinweise betreffen den gespeicherten Stand. Deine Eingaben für ${profile.provider} sind noch nicht gespeichert. Vervollständige und speichere das Ersatzprofil, bevor du es testest.`
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
                ref={profileSubmit}
                disabled={actionsBlocked}
              >
                Ersatzprofil speichern
              </Button>
            </fieldset>
            {feedback(["save"])}
            {profileDirty && (
              <p role="status">
                Speichere das Ersatzprofil vor dem Test. Das bisherige Profil
                bleibt gespeichert.{" "}
                {state.ready
                  ? "Der Versand nutzt es bis zur Aktivierung des Ersatzprofils."
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
              {dnsStatus && <p role="status">{dnsStatus}</p>}
              {dnsError && <p role="alert">{dnsError}</p>}
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
      )}{" "}
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
      <p>
        Vom Anbieter angenommen:{" "}
        {state.validation?.accepted ? "ja" : "ungeprüft"}. Empfang bestätigt:{" "}
        {state.validation?.received ? "ja" : "nein"}.
      </p>
      <p>Letzter erfolgreicher Versand: {state.lastSuccess || "noch keiner"}</p>
      <EmailFailure failure={state.failure} title="Aktueller Versand" />
      <EmailFailure failure={state.setupFailure} title="Einrichtungstest" />
      {state.unresolved?.map((attempt) => (
        <div key={attempt.scope}>
          <p>
            Abgleich erforderlich · {attempt.provider} revision{" "}
            {attempt.profile_revision} · {attempt.correlation_id}
          </p>
          <p>
            Suche diese Vorgangs-ID im Protokoll des Anbieters. Nach dem
            Verbindungsabbruch ist unklar, ob er die Nachricht angenommen hat.
          </p>
          <div className="admin-actions">
            <Button
              disabled={actionsBlocked}
              onClick={() =>
                action("reconcile", {
                  scope: attempt.scope,
                  resolution: "delivered",
                })
              }
            >
              Anbieter bestätigt die Annahme
            </Button>
            <Button
              disabled={actionsBlocked}
              onClick={() =>
                action("reconcile", {
                  scope: attempt.scope,
                  resolution: "retryable",
                })
              }
            >
              Anbieter bestätigt die Ablehnung, erneut versuchen
            </Button>
            {feedback([`reconcile:${attempt.scope}`])}
          </div>
        </div>
      ))}
      {actionResult?.key.startsWith("reconcile:") &&
        !state.unresolved?.some(
          (attempt) => actionResult.key === `reconcile:${attempt.scope}`,
        ) &&
        feedback([actionResult.key])}
      {state.messages?.map((m) => (
        <p key={m.status}>
          {m.status}: {m.count}
        </p>
      ))}
      <p>
        Nachrichten in der Warteschlange:{" "}
        {state.queue?.available === false
          ? "nicht verfügbar"
          : state.queue?.queued || 0}{" "}
        · Fehlgeschlagene Nachrichten:{" "}
        {state.queue?.available === false
          ? "nicht verfügbar"
          : state.queue?.failed || 0}
      </p>
    </div>
  );
}
