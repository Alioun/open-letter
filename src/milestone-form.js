import { useCallback, useRef, useState } from "react";

export const MILESTONE_INPUT_ERROR =
  "Gib positive Zahlen ein und trenne sie mit Kommas.";

const initialForm = () => ({ input: "", baseline: null, status: null });
const isDirty = (form) =>
  form.baseline !== null && form.input !== form.baseline;

function milestoneInput(data) {
  if (
    !Array.isArray(data?.milestones) ||
    data.milestones.some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new Error("Ungültige Zielmarken");
  return data.milestones.join(", ");
}

export function useMilestoneForm(api) {
  const [form, setForm] = useState(initialForm);
  const operation = useRef(0);
  const saving = useRef(false);
  const load = useCallback((data) => {
    const input = milestoneInput(data);
    setForm((current) =>
      isDirty(current)
        ? { ...current, baseline: input }
        : { input, baseline: input, status: null },
    );
  }, []);
  const dirty = isDirty(form);
  const error =
    form.status && !["ok", "saving"].includes(form.status) ? form.status : "";

  async function save(event) {
    event.preventDefault();
    if (form.baseline === null || saving.current) return;
    const milestones = form.input
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (milestones.some((value) => !Number.isFinite(value) || value <= 0)) {
      setForm((current) => ({ ...current, status: MILESTONE_INPUT_ERROR }));
      return;
    }
    const request = ++operation.current;
    const active = () => request === operation.current;
    saving.current = true;
    setForm((current) => ({ ...current, status: "saving" }));
    try {
      const response = await api("/api/admin/milestones", {
        method: "POST",
        body: JSON.stringify({ milestones }),
      });
      const data = await response.json().catch(() => ({}));
      if (!active()) return;
      if (response.ok) {
        const input = milestoneInput(data);
        setForm({ input, baseline: input, status: "ok" });
      } else {
        setForm((current) => ({
          ...current,
          status:
            data.error || "Die Änderungen konnten nicht gespeichert werden.",
        }));
      }
    } catch {
      if (active())
        setForm((current) => ({
          ...current,
          status:
            "Der Server hat das Speichern nicht bestätigt. Deine Zielmarken bleiben im Formular. Versuche es erneut.",
        }));
    } finally {
      if (active()) saving.current = false;
    }
  }

  return {
    ...form,
    loaded: form.baseline !== null,
    dirty,
    error,
    load,
    setInput(input) {
      setForm((current) => ({ ...current, input, status: null }));
    },
    reset() {
      operation.current++;
      saving.current = false;
      setForm((current) => ({
        ...current,
        input: current.baseline || "",
        status: null,
      }));
    },
    endSession() {
      operation.current++;
      saving.current = false;
      setForm(initialForm());
    },
    save,
  };
}
