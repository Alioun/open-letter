import { useEffect, useState, useRef } from "react";

// One draft, one send order. The key is made when a draft is first submitted
// and stays with it until the draft is reset, whatever is edited or however it
// is sent (scheduled, then "now"). The server keeps one campaign per key, so a
// draft cannot turn into two campaigns.
export function campaignRequest(previous, newKey = () => crypto.randomUUID()) {
  return previous?.key ? previous : { key: newKey() };
}

// What became of a draft's send order: the campaign and how it stands.
export function submittedCampaign(campaign, immediate) {
  return {
    id: campaign.id,
    outcome: ["cancelled", "sent"].includes(campaign.status)
      ? campaign.status
      : immediate
        ? "due"
        : "scheduled",
  };
}

export function useCampaignSubmission(key) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const stored = () => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };
  // Kept with the key, so a reload still shows the draft as sent.
  const [submitted, setSubmitted] = useState(() => stored()?.campaign || null);
  return {
    pending,
    submitted,
    reset() {
      localStorage.removeItem(key);
      setSubmitted(null);
    },
    async submit(api, body, confirm) {
      if (locked.current || submitted) return null;
      locked.current = true;
      setPending(true);
      let requested = false;
      try {
        if (!(await confirm())) return null;
        const request = campaignRequest(stored());
        const save = (value) => {
          try {
            localStorage.setItem(key, JSON.stringify(value));
          } catch {
            throw new Error(
              "Der Browser konnte die Kennung des Versandauftrags nicht speichern. Erlaube Browserspeicher und versuche es erneut.",
            );
          }
        };
        save(request);
        requested = true;
        const response = await api("/api/admin/campaigns", {
          method: "POST",
          body: JSON.stringify({ ...body, request_key: request.key }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Der Versand konnte nicht beauftragt werden.",
          );
        const campaign = submittedCampaign(result, body.send_now === true);
        setSubmitted(campaign);
        try {
          save({ ...request, campaign });
        } catch {}
        return result;
      } catch (error) {
        const message =
          error instanceof TypeError || error instanceof SyntaxError
            ? "Der Server hat den Versandauftrag nicht bestätigt. Dein Nachrichtenentwurf bleibt erhalten."
            : error.message;
        throw new Error(
          requested
            ? `${message} Prüfe den Versandverlauf, bevor du es erneut versuchst. Die Wiederholung verwendet dieselbe Auftragskennung, damit keine zweite Kampagne entsteht.`
            : message,
        );
      } finally {
        locked.current = false;
        setPending(false);
      }
    },
  };
}

export function futureCampaignDate(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date;
}

export function useCampaignDraft(key, defaults) {
  const fresh = () => defaults();
  const [value, setValue] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved?.version === 1) {
        const restored = { ...fresh(), ...saved.value };
        restored.date = restored.date ? new Date(restored.date) : null;
        if (restored.date && Number.isNaN(restored.date.getTime()))
          restored.date = null;
        return restored;
      }
    } catch {}
    return fresh();
  });
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, value }));
      setError("");
    } catch {
      setError(
        "Der Nachrichtenentwurf konnte nicht in diesem Browser gespeichert werden. Lass diesen Tab geöffnet, bis du ihn gesichert hast.",
      );
    }
  }, [key, value]);
  return {
    initializeTemplate(templates) {
      setValue((previous) => initializeCampaignTemplate(previous, templates));
    },
    field(name) {
      return [
        value[name],
        (next) =>
          setValue((previous) => ({
            ...previous,
            [name]: typeof next === "function" ? next(previous[name]) : next,
          })),
      ];
    },
    reset: (preserve = {}) => setValue({ ...fresh(), ...preserve }),
    error,
  };
}

export function initializeCampaignTemplate(value, templates) {
  if (
    value.template ||
    value.subject ||
    Object.values(value.texts || {}).some(Boolean) ||
    !templates.length
  )
    return value;
  return {
    ...value,
    template: String(templates[0].id),
    subject: templates[0].subject || "",
  };
}

export function campaignTemplatesAvailable(templateId, texts, templates) {
  return (
    Boolean(templateId) &&
    [
      templateId,
      ...Object.values(texts || {})
        .map((entry) => entry.templateId)
        .filter(Boolean),
    ].every((id) =>
      templates.some((template) => String(template.id) === String(id)),
    )
  );
}
