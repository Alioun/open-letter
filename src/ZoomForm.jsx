import { FreeTextChoice } from "./ui.jsx";
// Zoom event signup form, rendered in the #zoom section of App.jsx when
// features.zoomEvent is enabled. If a letter has the feature off and nothing
// imports this file, the bundler excludes it from that build automatically.

import { useState, useRef, memo } from "react";
import cfg from "../config/letter.config.js";

// Config-driven form copy, with fallbacks so a letter that omits zoom.form still
// renders sensible defaults.
const F = () => cfg.zoom?.form || {};

export const ZoomForm = memo(function ZoomForm({
  config = cfg,
  onSubmit,
  serverError,
  kvNames,
  // Whether the "Ich bin Delegierte*r" field is shown: admin-toggleable at
  // runtime (delivered via /api/zoom-count), defaults handled by the caller.
  showDelegierter = false,
}) {
  const cfg = config;
  const F = () => cfg.zoom?.form || {};
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kv, setKv] = useState("");
  const [delegierter, setDelegierter] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const nameRef = useRef(null);
  const emailRef = useRef(null);

  function validate() {
    const e = {};
    if (name.trim().length < 2) e.name = cfg.ui.signForm.errName;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      e.email = cfg.ui.signForm.errEmail;
    setErrors(e);
    if (e.name) nameRef.current?.focus();
    else if (e.email) emailRef.current?.focus();
    return Object.keys(e).length === 0;
  }

  async function submit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const ok = await onSubmit({
      name: name.trim(),
      email: email.trim(),
      kv: kv.trim().replace(/^KV\s*/i, ""),
      delegierter,
    });
    setSubmitting(false);
    if (ok) {
      setDone(true);
      setName("");
      setEmail("");
      setKv("");
      setDelegierter(false);
      setErrors({});
    }
  }

  if (done) {
    return (
      <div className="form-card zoom-done" role="status">
        <span className="badge">{F().doneBadge || "Fast geschafft"}</span>
        <div className="check-anim">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h3>{F().doneTitle || "Bitte bestätige deine Anmeldung."}</h3>
        <p className="sub2">
          {F().doneText ||
            "Wir haben dir eine E-Mail geschickt. Erst wenn du den Link darin anklickst, bist du angemeldet."}
        </p>
      </div>
    );
  }

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <span className="badge">{F().badge || "Zoom-Anmeldung"}</span>
      <h3>{F().title || "Anmelden in 30 Sekunden"}</h3>
      <div className="sub2">
        {F().subtitle || "Den Link schicken wir dir per E-Mail."}
      </div>

      {serverError && (
        <div className="err" role="alert">
          {serverError}
        </div>
      )}

      <div className="field">
        <label htmlFor="zoom-name">{cfg.ui.zoomForm.nameLabel}</label>
        <input
          id="zoom-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={cfg.ui.signForm.namePlaceholder}
          className={errors.name ? "invalid" : ""}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "zoom-err-name" : undefined}
          autoComplete="name"
        />
        {errors.name && (
          <div className="err" id="zoom-err-name">
            {errors.name}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="zoom-email">
          {cfg.ui.zoomForm.emailLabel}{" "}
          <span className="opt"> {cfg.ui.zoomForm.emailHint}</span>
        </label>
        <input
          id="zoom-email"
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={cfg.ui.signForm.emailPlaceholder}
          className={errors.email ? "invalid" : ""}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "zoom-err-email" : undefined}
          autoComplete="email"
        />
        {errors.email && (
          <div className="err" id="zoom-err-email">
            {errors.email}
          </div>
        )}
      </div>

      <div className="field field--relative">
        <label htmlFor="zoom-kv">
          {cfg.ui.zoomForm.kvLabel}{" "}
          <span className="opt"> {cfg.ui.zoomForm.kvHint}</span>
        </label>
        <FreeTextChoice
          id="zoom-kv"
          value={kv}
          onChange={setKv}
          items={kvNames}
          placeholder={cfg.sign.fields.kreisverband.placeholder}
        />
      </div>

      {showDelegierter && (
        <div className="checks">
          <label className="check">
            <input
              type="checkbox"
              checked={delegierter}
              onChange={(e) => setDelegierter(e.target.checked)}
            />
            <span>
              <strong>{F().delegierterLabel || "Ich bin Delegierte*r."}</strong>{" "}
              <span className="opt">{cfg.ui.signForm.optional}</span>
            </span>
          </label>
        </div>
      )}

      <button type="submit" className="submit" disabled={submitting}>
        {submitting
          ? F().submittingLabel || "Wird gesendet…"
          : F().submitLabel || "Zum Zoom anmelden"}{" "}
        <span className="arrow" aria-hidden="true">
          →
        </span>
      </button>
      <p className="form-legal">
        {F().legal ||
          "Wir nutzen deine Angaben nur zur Organisation des Treffens und schicken dir den Einwahllink rechtzeitig per E-Mail."}
      </p>
    </form>
  );
});
