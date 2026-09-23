import { useEffect, useMemo, useState } from "react";
import cfg from "../config/letter.config.js";
import { fillText } from "../config/ui.js";
import { regionLabels } from "../config/region.js";

// Read while rendering, so admin text overrides applied after load count.
const region = () => regionLabels(cfg);
import { resolvePrivacy } from "../config/privacy.js";

const { settingsLinkDays } = resolvePrivacy(cfg);

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
  inviteShowName: false,
  delegierter: false,
};

function formFromData(d) {
  return {
    name: d.name || d.zoomName || "",
    kv: d.kreisverband || d.zoomKv || "",
    occupation: d.occupation || "",
    newsletter: Boolean(d.newsletter),
    showPublicly: d.showPublicly ?? true,
    inviteShowName: Boolean(d.inviteShowName),
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
            cfg.ui.settings.offline,
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
            error: cfg.ui.settings.invalidLink,
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
          error: cfg.ui.settings.connectionFailed,
        });
      }
    }
    load();
    return () => controller.abort();
  }, [token, source, reloadCount]);

  function validateForm(values) {
    const errors = {};
    if (values.name.length > 100) {
      errors.name = cfg.ui.settings.errNameLong;
    }
    if (values.kv.length > 80) {
      errors.kv = fillText(cfg.ui.settings.errKvLong, { region: region().name });
    }
    if (values.occupation.length > 80) {
      errors.occupation = cfg.ui.settings.errOccupationLong;
    }
    return errors;
  }

  async function save(e) {
    e.preventDefault();
    const errors = validateForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError(cfg.ui.settings.errFields);
      return;
    }

    if (!navigator.onLine) {
      setSaveError(cfg.ui.settings.offlineShort);
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
        setSaveError(payload.error || cfg.ui.settings.saveFailed);
        return;
      }
      setSaved(true);
      setState((current) => ({
        ...current,
        data: { ...current.data, ...payload },
      }));
      setForm(formFromData(payload));
    } catch {
      setSaveError(cfg.ui.settings.connectionFailed);
    } finally {
      setSaving(false);
    }
  }

  async function submit(action) {
    setBusy(action);
    setResult("");
    if (!navigator.onLine) {
      setResult(cfg.ui.settings.offlineShort);
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
            cfg.ui.settings.actionFailed,
        );
        return;
      }
      const messages = {
        "newsletter-opt-out":
          cfg.ui.settings.doneNewsletter,
        "zoom-opt-out":
          cfg.ui.settings.doneZoom,
        all: cfg.ui.settings.doneAll,
        delete:
          cfg.ui.settings.doneDelete,
      };
      setResult(messages[action] || cfg.ui.settings.done);
      setState((current) => ({ ...current, data: null }));
    } catch {
      setResult(
        cfg.ui.settings.actionFailedConnection,
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
            <h1>{cfg.ui.settings.title}</h1>

            {state.loading && (
              <p role="status" aria-live="polite">
                {cfg.ui.settings.checking}
              </p>
            )}

            {state.error && (
              <>
                <p className="lead" role="alert">
                  {state.error}
                </p>
                <p>{cfg.ui.settings.useNewestLink}</p>
                <button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => {
                    setState({ loading: true, data: null, error: "" });
                    setReloadCount((n) => n + 1);
                  }}
                >
                  {cfg.ui.settings.retry}
                </button>
              </>
            )}

            {result && (
              <>
                <p className="lead" role="status" aria-live="polite">
                  {result}
                </p>
                <p>{cfg.ui.settings.thanks}</p>
              </>
            )}

            {d && (
              <>
                <p className="anrede">{d.emailMasked}</p>

                {d.editable === false && (
                  <p className="sub2">
                    {fillText(cfg.ui.settings.oldLink, {
                      days: settingsLinkDays,
                    })}
                  </p>
                )}

                {d.editable !== false && (d.hasSigner || d.hasZoom) && (
                  <form onSubmit={save} noValidate>
                    <h2>{cfg.ui.settings.detailsHeading}</h2>
                    <p className="sub2">
                      {cfg.ui.settings.detailsIntro}
                    </p>

                    {saveError && (
                      <div className="err" role="alert">
                        {saveError}
                      </div>
                    )}
                    {saved && !saveError && (
                      <p className="status-message" role="status">
                        {cfg.ui.settings.saved}
                      </p>
                    )}

                    <div className="field">
                      <label htmlFor="edit-name">{cfg.ui.settings.nameLabel}</label>
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
                        {region().name}{" "}
                        <span className="opt"> {cfg.ui.settings.optional}</span>
                      </label>
                      {region().options ? (
                        <select
                          id="edit-kv"
                          value={form.kv}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, kv: e.target.value }))
                          }
                        >
                          <option value="">–</option>
                          {/* A region stored before the options existed
                              stays visible and selectable. */}
                          {form.kv && !region().options.includes(form.kv) && (
                            <option value={form.kv}>{form.kv}</option>
                          )}
                          {region().options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="edit-kv"
                          type="text"
                          value={form.kv}
                          maxLength={80}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, kv: e.target.value }))
                          }
                          aria-invalid={Boolean(fieldErrors.kv)}
                          aria-describedby={
                            fieldErrors.kv ? "err-kv" : undefined
                          }
                        />
                      )}
                      {fieldErrors.kv && (
                        <p className="err" id="err-kv" role="alert">
                          {fieldErrors.kv}
                        </p>
                      )}
                    </div>

                    <div className="field">
                      <label htmlFor="edit-occupation">
                        {cfg.ui.settings.occupationLabel}{" "}
                        <span className="opt"> {cfg.ui.settings.optional}</span>
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
                            <span>{cfg.ui.settings.showPublicly}</span>
                          </label>
                          {cfg.features.inviteLinks && d.hasInviteCode && (
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={form.inviteShowName}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    inviteShowName: e.target.checked,
                                  }))
                                }
                              />
                              <span>
                                {cfg.ui.settings.inviteShowName}
                              </span>
                            </label>
                          )}
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
                            <span>{cfg.ui.settings.newsletter}</span>
                          </label>
                        </>
                      )}
                      {d.hasZoom && d.showDelegierter && (
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
                            {cfg.ui.settings.delegierter}
                          </span>
                        </label>
                      )}
                    </div>

                    <button type="submit" className="cta" disabled={saving}>
                      {saving ? cfg.ui.settings.saving : cfg.ui.settings.save}
                    </button>
                  </form>
                )}

                <div className="divider" />

                <p>{cfg.ui.settings.chooseUnsubscribe}</p>

                <div className="button-group">
                  {hasBoth && (
                    <button
                      type="button"
                      className="cta"
                      disabled={Boolean(busy)}
                      onClick={() => submit("all")}
                    >
                      {busy === "all"
                        ? cfg.ui.settings.unsubscribingAll
                        : cfg.ui.settings.unsubscribeAll}
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
                        ? cfg.ui.settings.unsubscribingNewsletter
                        : cfg.ui.settings.unsubscribeNewsletter}
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
                        ? cfg.ui.settings.unsubscribingZoom
                        : cfg.ui.settings.unsubscribeZoom}
                    </button>
                  )}

                  {!hasOptions && d.hasSigner && (
                    <p>
                      {cfg.ui.settings.alreadyUnsubscribed}
                    </p>
                  )}
                </div>

                {d.canDeleteSigner && (
                  <div className="form-card-footer">
                    <p className="sub2">
                      {cfg.ui.settings.deleteIntro}
                    </p>
                    <button
                      type="button"
                      className="admin-danger"
                      disabled={Boolean(busy)}
                      onClick={() => submit("delete")}
                    >
                      {busy === "delete"
                        ? cfg.ui.settings.deleting
                        : cfg.ui.settings.delete}
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
