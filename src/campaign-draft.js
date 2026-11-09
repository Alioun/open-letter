import { useEffect, useState, useRef } from "react";

export function campaignRequest(
  body,
  previous,
  newKey = () => crypto.randomUUID(),
) {
  const signature = JSON.stringify({
    ...body,
    scheduled_at: body.send_now ? null : body.scheduled_at,
  });
  return previous?.signature === signature
    ? previous
    : { signature, key: newKey() };
}

export function useCampaignSubmission(key) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  return {
    pending,
    reset() {
      localStorage.removeItem(key);
    },
    async submit(api, body, confirm) {
      if (locked.current) return null;
      locked.current = true;
      setPending(true);
      let requested = false;
      try {
        if (!(await confirm())) return null;
        let previous;
        try {
          previous = JSON.parse(localStorage.getItem(key));
        } catch {}
        const request = campaignRequest(body, previous);
        try {
          localStorage.setItem(key, JSON.stringify(request));
        } catch {
          throw new Error(
            "Der Browser konnte die Kennung des Versandauftrags nicht speichern. Erlaube Browserspeicher und versuche es erneut.",
          );
        }
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
