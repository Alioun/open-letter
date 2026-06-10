import { useEffect, useMemo, useState } from "react";

function getToken() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1] || "";
}

function getSource() {
  const params = new URLSearchParams(window.location.search);
  return params.get("from") === "zoom" ? "zoom" : "newsletter";
}

const EMPTY_FORM = {
  name: "",
  kv: "",
  occupation: "",
  newsletter: false,
  showPublicly: true,
  delegierter: false,
};

function formFromData(d) {
  return {
    name: d.name || d.zoomName || "",
    kv: d.kreisverband || d.zoomKv || "",
    occupation: d.occupation || "",
    newsletter: Boolean(d.newsletter),
    showPublicly: d.showPublicly ?? true,
    delegierter: Boolean(d.delegierter),
  };
}

export default function UnsubscribeApp() {
  const token = useMemo(getToken, []);
  const source = useMemo(getSource, []);
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      if (!navigator.onLine) {
        setState({
          loading: false,
          data: null,
          error:
            "Du bist offline. Bitte prüfe deine Verbindung und lade die Seite neu.",
        });
        return;
      }

      try {
        const res = await fetch(`/api/unsubscribe/${token}?from=${source}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setState({
            loading: false,
            data: null,
            error: "Dieser Link ist nicht mehr gültig.",
          });
          return;
        }
        const data = await res.json();
        setForm(formFromData(data));
        setState({ loading: false, data, error: "" });
      } catch (err) {
        if (err.name === "AbortError") return;
        setState({
          loading: false,
          data: null,
          error: "Die Verbindung ist fehlgeschlagen.",
        });
      }
    }
    load();
    return () => controller.abort();
  }, [token, source, reloadCount]);

  function validateForm(values) {
    const errors = {};
    if (values.name.length > 100) {
      errors.name = "Bitte kürze den Namen auf maximal 100 Zeichen.";
    }
    if (values.kv.length > 80) {
      errors.kv = "Bitte kürze den Kreisverband auf maximal 80 Zeichen.";
    }
    if (values.occupation.length > 80) {
      errors.occupation = "Bitte kürze den Beruf auf maximal 80 Zeichen.";
    }
    return errors;
  }

  async function save(e) {
    e.preventDefault();
    const errors = validateForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError("Bitte korrigiere die markierten Felder.");
      return;
    }

    if (!navigator.onLine) {
      setSaveError("Du bist offline. Bitte prüfe deine Verbindung.");
      return;
    }

    setSaving(true);
    setSaved(false);
    setSaveError("");
    try {
      const res = await fetch(
        `/api/unsubscribe/${token}/update?from=${source}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(payload.error || "Speichern fehlgeschlagen.");
        return;
      }
      setSaved(true);
      setState((current) => ({
        ...current,
        data: { ...current.data, ...payload },
      }));
      setForm(formFromData(payload));
    } catch {
      setSaveError("Die Verbindung ist fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function submit(action) {
    setBusy(action);
    setResult("");
    if (!navigator.onLine) {
      setResult("Du bist offline. Bitte prüfe deine Verbindung.");
      setBusy("");
      return;
    }
    try {
      const res = await fetch(`/api/unsubscribe/${token}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setResult(
          payload.error ||
            "Die Aktion konnte nicht abgeschlossen werden. Bitte versuche es später erneut.",
        );
        return;
      }
      const messages = {
        "newsletter-opt-out":
          "Du erhältst keine Newsletter-Updates mehr. Deine Unterschrift bleibt bestehen.",
        "zoom-opt-out":
          "Du erhältst keine Zoom-Mails mehr. Deine Anmeldung wurde entfernt.",
        all: "Du bist von allem abgemeldet.",
        delete:
          "Deine Unterschrift und die damit verbundenen Daten wurden gelöscht.",
      };
      setResult(messages[action] || "Erledigt.");
      setState((current) => ({ ...current, data: null }));
    } catch {
      setResult(
        "Die Aktion konnte nicht abgeschlossen werden. Bitte prüfe deine Verbindung.",
      );
    } finally {
      setBusy("");
    }
  }

  const d = state.data;
  const hasOptions = d && (d.newsletter || d.hasZoom);
  const hasBoth = d && d.newsletter && d.hasZoom;

  return (
    <main className="unsubscribe-shell">
      <section className="section">
        <div className="section-inner unsubscribe-inner">
          <article className="form-card">
            <h1>E-Mail-Einstellungen</h1>

            {state.loading && (
              <p role="status" aria-live="polite">
                Link wird geprüft …
              </p>
            )}

            {state.error && (
              <>
                <p className="lead" role="alert">
                  {state.error}
                </p>
                <p>Bitte nutze den neuesten Link aus einer unserer E-Mails.</p>
                <button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => {
                    setState({ loading: true, data: null, error: "" });
                    setReloadCount((n) => n + 1);
                  }}
                >
                  Erneut versuchen
                </button>
              </>
            )}

            {result && (
              <>
                <p className="lead" role="status" aria-live="polite">
                  {result}
                </p>
                <p>Danke für deine Rückmeldung.</p>
              </>
            )}

            {d && (
              <>
                <p className="anrede">{d.emailMasked}</p>

                {(d.hasSigner || d.hasZoom) && (
                  <form onSubmit={save} noValidate>
                    <h2>Deine Angaben</h2>
                    <p className="sub2">
                      Hier kannst du deine Daten jederzeit anpassen.
                    </p>

                    {saveError && (
                      <div className="err" role="alert">
                        {saveError}
                      </div>
                    )}
                    {saved && !saveError && (
                      <p className="status-message" role="status">
                        Deine Angaben wurden aktualisiert.
                      </p>
                    )}

                    <div className="field">
                      <label htmlFor="edit-name">Name</label>
                      <input
                        id="edit-name"
                        type="text"
                        value={form.name}
                        maxLength={100}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, name: e.target.value }))
                        }
                        autoComplete="name"
                        aria-invalid={Boolean(fieldErrors.name)}
                        aria-describedby={
                          fieldErrors.name ? "err-name" : undefined
                        }
                      />
                      {fieldErrors.name && (
                        <p className="err" id="err-name" role="alert">
                          {fieldErrors.name}
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <label htmlFor="edit-kv">
                        Kreisverband <span className="opt"> optional</span>
                      </label>
                      <input
                        id="edit-kv"
                        type="text"
                        value={form.kv}
                        maxLength={80}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, kv: e.target.value }))
                        }
                        aria-invalid={Boolean(fieldErrors.kv)}
                        aria-describedby={fieldErrors.kv ? "err-kv" : undefined}
                      />
                      {fieldErrors.kv && (
                        <p className="err" id="err-kv" role="alert">
                          {fieldErrors.kv}
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <label htmlFor="edit-occupation">
                        Beruf <span className="opt"> optional</span>
                      </label>
                      <input
                        id="edit-occupation"
                        type="text"
                        value={form.occupation}
                        maxLength={80}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, occupation: e.target.value }))
                        }
                        aria-invalid={Boolean(fieldErrors.occupation)}
                        aria-describedby={
                          fieldErrors.occupation ? "err-occupation" : undefined
                        }
                      />
                      {fieldErrors.occupation && (
                        <p className="err" id="err-occupation" role="alert">
                          {fieldErrors.occupation}
                        </p>
                      )}
                    </div>

                    <div className="checks">
                      {d.hasSigner && (
                        <>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={form.showPublicly}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  showPublicly: e.target.checked,
                                }))
                              }
                            />
                            <span>Meinen Namen öffentlich anzeigen</span>
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={form.newsletter}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  newsletter: e.target.checked,
                                }))
                              }
                            />
                            <span>Newsletter-Updates erhalten</span>
                          </label>
                        </>
                      )}
                      {d.hasZoom && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={form.delegierter}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                delegierter: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            Ich bin <strong>Delegierte*r zum Parteitag.</strong>
                          </span>
                        </label>
                      )}
                    </div>

                    <button type="submit" className="cta" disabled={saving}>
                      {saving ? "Wird gespeichert …" : "Angaben speichern"}
                    </button>
                  </form>
                )}

                <div className="divider" />

                <p>Wähle, wovon du dich abmelden möchtest:</p>

                <div className="button-group">
                  {hasBoth && (
                    <button
                      type="button"
                      className="cta"
                      disabled={Boolean(busy)}
                      onClick={() => submit("all")}
                    >
                      {busy === "all"
                        ? "Wird abgemeldet …"
                        : "Von allem abmelden"}
                    </button>
                  )}

                  {d.newsletter && (
                    <button
                      type="button"
                      className={
                        "cta" +
                        (source === "newsletter" && !hasBoth
                          ? ""
                          : " cta--outline")
                      }
                      disabled={Boolean(busy)}
                      onClick={() => submit("newsletter-opt-out")}
                    >
                      {busy === "newsletter-opt-out"
                        ? "Wird abbestellt …"
                        : "Keine Newsletter-Updates mehr"}
                    </button>
                  )}

                  {d.hasZoom && (
                    <button
                      type="button"
                      className={
                        "cta" +
                        (source === "zoom" && !hasBoth ? "" : " cta--outline")
                      }
                      disabled={Boolean(busy)}
                      onClick={() => submit("zoom-opt-out")}
                    >
                      {busy === "zoom-opt-out"
                        ? "Wird abgemeldet …"
                        : "Keine Zoom-Mails mehr"}
                    </button>
                  )}

                  {!hasOptions && d.hasSigner && (
                    <p>
                      Du bist bereits von allen E-Mails abgemeldet. Deine
                      Unterschrift ist weiterhin sichtbar.
                    </p>
                  )}
                </div>

                {d.canDeleteSigner && (
                  <div className="form-card-footer">
                    <p className="sub2">
                      Du kannst auch deine Unterschrift und alle damit
                      verbundenen Daten unwiderruflich löschen:
                    </p>
                    <button
                      type="button"
                      className="admin-danger"
                      disabled={Boolean(busy)}
                      onClick={() => submit("delete")}
                    >
                      {busy === "delete"
                        ? "Wird gelöscht …"
                        : "Unterschrift vollständig löschen"}
                    </button>
                  </div>
                )}
              </>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
