import { useId, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import cfg from "../config/letter.config.js";
import { regionLabels } from "../config/region.js";
import { Notice, SelectControl } from "./ui.jsx";
import { Check } from "./SignerEditPanel.jsx";
import { addByHand } from "./first-signer-admin.js";

const DETAILS_CAN_BE_PUBLIC = Boolean(
  cfg.features.publicSignerDetails || cfg.features.publicFirstSignerDetails,
);

const EMPTY = {
  name: "",
  signerFunction: "",
  occupation: "",
  kreisverband: "",
  showSignerDetails: false,
  consent: false,
  consentNote: "",
  pin: true,
};

// A first signer who never signed through the form: name and details only,
// no address. Counts like a signature and is never mailed.
export default function FirstSignerAdd({ api, onAdded }) {
  const id = useId();
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState(null);
  const region = regionLabels(cfg);
  const set = (field) => (value) =>
    setForm((before) => ({ ...before, [field]: value }));
  const text = (field) => (event) => set(field)(event.target.value);
  const hasDetails = Boolean(
    form.signerFunction.trim() || form.occupation.trim(),
  );

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true });
    try {
      const { signer } = await addByHand(api, {
        ...form,
        name: form.name.trim(),
        consentNote: form.consentNote.trim(),
        showSignerDetails: hasDetails && form.showSignerDetails,
      });
      setForm(EMPTY);
      setState({
        added: `„${signer.name}“ ist eingetragen und als Erstunterzeichner*in markiert${signer.position != null ? `, an Position ${signer.position}` : ""}. Die Unterschrift zählt ab sofort mit.`,
      });
      onAdded();
    } catch (error) {
      setState({ error: error.message });
    }
  }

  return (
    <form className="first-signer-add" onSubmit={submit}>
      <p className="admin-muted">
        Für Personen, die nicht über das Formular unterschrieben haben, aber als
        Erstunterzeichner*in genannt werden wollen. Der Eintrag hat keine
        E-Mail-Adresse und bekommt nie eine E-Mail. Er zählt als Unterschrift
        und steht auf der Website mit dem heutigen Datum.
      </p>
      <div className="field">
        <label htmlFor={`${id}-name`}>Name</label>
        <Input
          id={`${id}-name`}
          value={form.name}
          maxLength={100}
          minLength={2}
          required
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
              {region.options.map((option) => (
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
      {DETAILS_CAN_BE_PUBLIC && (
        <Check
          checked={hasDetails && form.showSignerDetails}
          disabled={!hasDetails}
          onChange={set("showSignerDetails")}
        >
          {cfg.sign.fields.signerFunction
            ? `${cfg.sign.fields.signerFunction.label} und ${cfg.sign.fields.occupation.label}`
            : cfg.sign.fields.occupation.label}{" "}
          öffentlich neben dem Namen zeigen (nur wenn die Person das möchte)
        </Check>
      )}
      <Check checked={form.pin} onChange={set("pin")}>
        Ans Ende der Reihenfolge stellen
      </Check>
      <div className="signer-edit-consent">
        <p>
          Die Person wird öffentlich mit Namen genannt. Das geht nur mit ihrer
          Zustimmung.
        </p>
        <Check checked={form.consent} onChange={set("consent")}>
          Zustimmung liegt vor
        </Check>
        <div className="field">
          <label htmlFor={`${id}-note`}>
            Notiz dazu (freiwillig, z. B. „per Telefon am 3.11.“)
          </label>
          <Input
            id={`${id}-note`}
            value={form.consentNote}
            maxLength={300}
            onChange={text("consentNote")}
          />
        </div>
      </div>
      <div className="admin-actions">
        <Button
          type="submit"
          className="admin-button admin-button--primary"
          disabled={state?.busy || !form.consent || form.name.trim().length < 2}
        >
          {state?.busy ? "Wird eingetragen…" : "Eintragen"}
        </Button>
      </div>
      {state?.added && <Notice tone="success">{state.added}</Notice>}
      {state?.error && <Notice tone="error">{state.error}</Notice>}
    </form>
  );
}
