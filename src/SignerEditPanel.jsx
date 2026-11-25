import { useEffect, useId, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Checkbox } from "@base-ui/react/checkbox";
import { Collapsible } from "@base-ui/react/collapsible";
import cfg, { LANGUAGES, DEFAULT_LANG } from "../config/letter.config.js";
import { regionLabels } from "../config/region.js";
import { readAdminJson } from "./admin-read.jsx";
import { Breakable, Notice, SelectControl } from "./ui.jsx";
import { LogEntries } from "./AdminLog.jsx";
import { logTime } from "./admin-log-format.js";
import {
  editForm,
  needsConsent,
  saveSigner,
  sendSignerMail,
  signerPatch,
} from "./signer-admin.js";
import { setMark, setPosition } from "./first-signer-admin.js";

// The position field: "" is no position, otherwise a whole number from 1.
// Returns undefined for anything else.
function parsePosition(text) {
  const value = text.trim();
  if (value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : undefined;
}

const DETAILS_CAN_BE_PUBLIC = Boolean(
  cfg.features.publicSignerDetails || cfg.features.publicFirstSignerDetails,
);

export function Check({ checked, onChange, disabled, children }) {
  return (
    <label className="admin-check">
      <Checkbox.Root
        className="admin-checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      >
        <Checkbox.Indicator aria-hidden="true">✓</Checkbox.Indicator>
      </Checkbox.Root>
      <span>{children}</span>
    </label>
  );
}

// The panel for one confirmed signature. `onSaved(signer)` runs after a save
// that changed something.
export default function SignerEditPanel({
  api,
  signerId,
  returnFocus,
  onClose,
  onSaved,
}) {
  const id = useId();
  const [signer, setSigner] = useState(null);
  const [form, setForm] = useState(null);
  const [failure, setFailure] = useState(null);
  const [consent, setConsent] = useState(false);
  const [consentNote, setConsentNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState(null);
  const [marked, setMarked] = useState(false);
  const [positionText, setPositionText] = useState("");

  useEffect(() => {
    let current = true;
    readAdminJson(api, `/api/admin/signers/${signerId}`)
      .then((loaded) => {
        if (!current) return;
        setSigner(loaded);
        setForm(editForm(loaded));
        setMarked(Boolean(loaded.firstSigner));
        setPositionText(loaded.position == null ? "" : String(loaded.position));
      })
      .catch(() => {
        if (current)
          setFailure(
            "Die Unterschrift konnte nicht geladen werden. Vielleicht wurde sie inzwischen gelöscht.",
          );
      });
    return () => {
      current = false;
    };
  }, [api, signerId]);

  const set = (field) => (value) =>
    setForm((before) => ({ ...before, [field]: value }));
  const text = (field) => (event) => set(field)(event.target.value);
  const patch = signer && form ? signerPatch(signer, form) : {};
  const position = parsePosition(positionText);
  const markChanged = Boolean(signer) && marked !== Boolean(signer.firstSigner);
  const positionChanged =
    Boolean(signer) &&
    position !== undefined &&
    position !== (signer.position ?? null);
  const changed =
    Object.keys(patch).length > 0 || markChanged || positionChanged;
  const consentNeeded = needsConsent(patch);
  const region = regionLabels(cfg);

  async function save(event) {
    event.preventDefault();
    if (!changed) return onClose();
    setSaving(true);
    setFailure(null);
    try {
      let saved = signer;
      if (Object.keys(patch).length > 0)
        saved = await saveSigner(
          api,
          signerId,
          patch,
          consentNeeded ? { consent, consentNote: consentNote.trim() } : {},
        );
      if (markChanged) await setMark(api, signerId, marked);
      if (positionChanged) await setPosition(api, signerId, position);
      onSaved(saved);
    } catch (error) {
      setFailure(error.message);
      setSaving(false);
    }
  }

  async function requestNewsletter() {
    setRequest({ state: "sending" });
    try {
      const { delayed } = await sendSignerMail(
        api,
        signerId,
        "newsletter-request",
      );
      setRequest({ state: "sent", delayed });
    } catch (error) {
      setRequest({ state: "failed", message: error.message });
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="base-modal-backdrop" />
        <Dialog.Popup
          className="admin-dialog admin-dialog--form"
          aria-labelledby={`${id}-title`}
          finalFocus={() => (returnFocus?.isConnected ? returnFocus : true)}
        >
          <h2 id={`${id}-title`}>Unterschrift bearbeiten</h2>
          {!form && !failure && (
            <p role="status" className="admin-muted">
              Wird geladen…
            </p>
          )}
          {!form && failure && <Notice tone="error">{failure}</Notice>}
          {form && (
            <form className="signer-edit" onSubmit={save}>
              <div className="admin-dialog-message">
                {signer.handAdded ? (
                  <p className="signer-edit-identity">
                    Von Hand eingetragen, ohne E-Mail-Adresse
                    <span className="admin-muted">
                      Eingetragen am {logTime(signer.createdAt)}. Dieser Eintrag
                      bekommt nie eine E-Mail.
                    </span>
                  </p>
                ) : (
                  <p className="signer-edit-identity">
                    <Breakable text={signer.email} />
                    <span className="admin-muted">
                      Unterschrieben am {logTime(signer.createdAt)}. Die
                      E-Mail-Adresse lässt sich nicht ändern. Ist sie falsch,
                      lösche die Unterschrift und bitte die Person, neu zu
                      unterschreiben.
                    </span>
                  </p>
                )}
                <div className="field">
                  <label htmlFor={`${id}-name`}>Name</label>
                  <Input
                    id={`${id}-name`}
                    value={form.name}
                    maxLength={100}
                    required
                    minLength={2}
                    onChange={text("name")}
                  />
                </div>
                {cfg.sign.fields.signerFunction && (
                  <div className="field">
                    <label htmlFor={`${id}-function`}>
                      {cfg.sign.fields.signerFunction.label}
                    </label>
                    <Input
                      id={`${id}-function`}
                      value={form.signerFunction}
                      maxLength={160}
                      onChange={text("signerFunction")}
                    />
                  </div>
                )}
                {cfg.features.occupationField && (
                  <div className="field">
                    <label htmlFor={`${id}-occupation`}>
                      {cfg.sign.fields.occupation.label}
                    </label>
                    <Input
                      id={`${id}-occupation`}
                      value={form.occupation}
                      maxLength={160}
                      onChange={text("occupation")}
                    />
                  </div>
                )}
                {cfg.features.kreisverbandField && (
                  <div className="field">
                    <label htmlFor={`${id}-region`}>{region.name}</label>
                    {region.options ? (
                      <SelectControl
                        id={`${id}-region`}
                        aria-label={region.name}
                        value={form.kreisverband}
                        onChange={text("kreisverband")}
                      >
                        <option value="">{region.none}</option>
                        {[
                          ...new Set(
                            [signer.kreisverband, ...region.options].filter(
                              Boolean,
                            ),
                          ),
                        ].map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </SelectControl>
                    ) : (
                      <Input
                        id={`${id}-region`}
                        value={form.kreisverband}
                        maxLength={100}
                        onChange={text("kreisverband")}
                      />
                    )}
                  </div>
                )}
                {LANGUAGES.length > 1 && (
                  <div className="field">
                    <label htmlFor={`${id}-lang`}>
                      Sprache der E-Mails an die Person
                    </label>
                    <SelectControl
                      id={`${id}-lang`}
                      aria-label="Sprache der E-Mails an die Person"
                      value={form.lang || DEFAULT_LANG}
                      onChange={text("lang")}
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang.toUpperCase()}
                        </option>
                      ))}
                    </SelectControl>
                  </div>
                )}

                <h3 className="signer-edit-heading">Öffentliche Liste</h3>
                <Check
                  checked={form.showPublicly}
                  onChange={set("showPublicly")}
                >
                  Name in der öffentlichen Liste zeigen
                </Check>
                {DETAILS_CAN_BE_PUBLIC && (
                  <Check
                    checked={form.showPublicly && form.showSignerDetails}
                    disabled={!form.showPublicly}
                    onChange={set("showSignerDetails")}
                  >
                    {cfg.sign.fields.signerFunction
                      ? `${cfg.sign.fields.signerFunction.label} und ${cfg.sign.fields.occupation.label}`
                      : cfg.sign.fields.occupation.label}{" "}
                    neben dem Namen zeigen
                  </Check>
                )}
                {signer.consentAt && !consentNeeded && (
                  <p className="admin-muted">
                    Zustimmung vermerkt am {logTime(signer.consentAt)}
                    {signer.consentNote && `: ${signer.consentNote}`}
                  </p>
                )}
                {consentNeeded && (
                  <div className="signer-edit-consent">
                    <p>
                      Du machst etwas öffentlich, das bisher nicht öffentlich
                      war. Das geht nur mit Zustimmung der Person.
                    </p>
                    <Check checked={consent} onChange={setConsent}>
                      Zustimmung liegt vor
                    </Check>
                    <div className="field">
                      <label htmlFor={`${id}-note`}>
                        Notiz dazu (freiwillig, z. B. „per E-Mail am 3.11.“)
                      </label>
                      <Input
                        id={`${id}-note`}
                        value={consentNote}
                        maxLength={300}
                        onChange={(event) => setConsentNote(event.target.value)}
                      />
                    </div>
                  </div>
                )}

                <h3 className="signer-edit-heading">Erstunterzeichner*in</h3>
                <Check checked={marked} onChange={setMarked}>
                  Als Erstunterzeichner*in markieren
                </Check>
                <p className="admin-muted">
                  Die öffentliche Liste zeigt dann „{cfg.ui.list.firstSigner}“
                  unter dem Namen.
                  {!form.showPublicly &&
                    " Das erscheint erst, wenn der Name öffentlich gezeigt wird."}
                </p>
                <div className="field signer-edit-position">
                  <label htmlFor={`${id}-position`}>Position</label>
                  <Input
                    id={`${id}-position`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    placeholder="–"
                    value={positionText}
                    aria-invalid={position === undefined || undefined}
                    aria-describedby={`${id}-position-hint`}
                    onChange={(event) => setPositionText(event.target.value)}
                  />
                  <p id={`${id}-position-hint`} className="admin-muted">
                    {position === undefined
                      ? "Gib eine ganze Zahl ab 1 ein oder lass das Feld leer."
                      : "Wer eine Position hat, steht in der Ansicht „Alle“ ganz oben, in dieser Reihenfolge. Eine Position schiebt die anderen nach unten; leer heißt keine feste Position."}
                  </p>
                </div>

                <h3 className="signer-edit-heading">Newsletter</h3>
                {signer.handAdded ? (
                  <p className="admin-muted">
                    Ohne E-Mail-Adresse gibt es keinen Newsletter.
                  </p>
                ) : signer.newsletter ? (
                  <>
                    <Check
                      checked={form.newsletter}
                      onChange={set("newsletter")}
                    >
                      Erhält den Newsletter
                    </Check>
                    {!form.newsletter && (
                      <p className="admin-muted">
                        Die Person wird beim Speichern sofort abgemeldet.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="signer-edit-newsletter">
                    <p className="admin-muted">
                      Erhält keinen Newsletter. Anmelden kann sich nur die
                      Person selbst: Sie bekommt eine E-Mail und bestätigt mit
                      einem Klick.
                    </p>
                    <Button
                      type="button"
                      className="admin-button admin-button--small"
                      disabled={
                        request?.state === "sending" ||
                        request?.state === "sent"
                      }
                      onClick={requestNewsletter}
                    >
                      {request?.state === "sending"
                        ? "Wird angefragt…"
                        : "Newsletter-Einwilligung anfragen"}
                    </Button>
                    {request?.state === "sent" && (
                      <Notice tone="success">
                        {request.delayed
                          ? "Die E-Mail ist eingereiht und geht raus, sobald der Versand wieder läuft."
                          : "Die E-Mail mit der Bitte um Bestätigung ist unterwegs."}{" "}
                        Der Newsletter beginnt erst, wenn die Person den Link
                        darin anklickt.
                      </Notice>
                    )}
                    {request?.state === "failed" && (
                      <Notice tone="error">{request.message}</Notice>
                    )}
                  </div>
                )}

                {signer.history?.length > 0 && (
                  <Collapsible.Root>
                    <Collapsible.Trigger className="admin-disclosure-trigger">
                      Bisherige Änderungen ({signer.history.length})
                    </Collapsible.Trigger>
                    <Collapsible.Panel>
                      <LogEntries entries={signer.history} />
                    </Collapsible.Panel>
                  </Collapsible.Root>
                )}
                {failure && <Notice tone="error">{failure}</Notice>}
              </div>
              <div className="admin-actions">
                <Button
                  type="button"
                  className="admin-button"
                  onClick={onClose}
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  className="admin-button admin-button--primary"
                  disabled={
                    saving ||
                    (consentNeeded && !consent) ||
                    position === undefined
                  }
                >
                  {saving ? "Wird gespeichert…" : "Speichern"}
                </Button>
              </div>
            </form>
          )}
          {!form && (
            <div className="admin-actions">
              <Button type="button" className="admin-button" onClick={onClose}>
                Schließen
              </Button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
