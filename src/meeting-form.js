import { useEffect, useRef, useState } from "react";
import { useAdminRead, readAdminJson } from "./admin-read.jsx";
import { readCampaignAudience } from "./campaign-approval.js";
import { meetingDeliveryImpact } from "./MeetingDeliveryReview.jsx";
import { isoToLocalInput, meetingDateForSave } from "./meeting-date.js";

export const MEETING_FIELDS = {
  eventAtInput: "Termin",
  zoomLink: "Zoom-Link",
  linkOffsetHours: "Link-E-Mail: Stunden vor dem Termin",
  reminderOffsetHours: "Erinnerung: Stunden vorher",
  showDelegierter: "Delegiertenfeld",
  mode: "Format",
  locationName: "Ort",
  locationAddress: "Adresse",
  locationMapsUrl: "Karten-Link",
  durationMin: "Dauer in Minuten",
};

const validMeeting = (data) =>
  data && Number.isInteger(data.revision) && Object.hasOwn(data, "eventAt");

export function meetingValues(data = {}) {
  return {
    eventAtInput: isoToLocalInput(data.eventAt),
    zoomLink: data.link || "",
    linkOffsetHours: data.linkOffsetHours ?? 24,
    reminderOffsetHours: data.reminderOffsetHours ?? 2,
    showDelegierter: Boolean(data.showDelegierter),
    mode: data.mode === "inperson" ? "inperson" : "online",
    locationName: data.location?.name || "",
    locationAddress: data.location?.address || "",
    locationMapsUrl: data.location?.mapsUrl || "",
    durationMin: data.durationMin || 90,
  };
}

const numericFields = new Set([
  "linkOffsetHours",
  "reminderOffsetHours",
  "durationMin",
]);
const fieldValue = (values, key) =>
  numericFields.has(key) ? Number(values[key]) : values[key];

export function meetingChanges(values, saved) {
  const current = meetingValues(saved);
  return Object.entries(MEETING_FIELDS).flatMap(([key, label]) => {
    const mine = fieldValue(values, key);
    return mine === current[key]
      ? []
      : [{ key, label, mine, current: current[key] }];
  });
}

export function meetingRequest(values, saved) {
  return {
    expectedRevision: saved.revision,
    eventAt: meetingDateForSave(values.eventAtInput, saved.eventAt),
    ...Object.fromEntries(
      Object.keys(MEETING_FIELDS)
        .filter((key) => key !== "eventAtInput")
        .map((key) => [key, fieldValue(values, key)]),
    ),
  };
}

const initialForm = () => ({
  saved: null,
  values: meetingValues(),
  conflict: null,
  status: null,
});
const isDirty = (form) =>
  form.saved !== null && meetingChanges(form.values, form.saved).length > 0;

export function useMeetingForm({ api, enabled, confirmDelivery, onAudience }) {
  const read = useAdminRead(
    api,
    "/api/admin/zoom-mailings",
    enabled,
    validMeeting,
  );
  const [form, setForm] = useState(initialForm);
  const operation = useRef(0);
  const saving = useRef(false);
  const dirty = isDirty(form);

  useEffect(() => {
    if (read.data)
      setForm((current) =>
        isDirty(current)
          ? current
          : {
              ...current,
              saved: read.data,
              values: meetingValues(read.data),
            },
      );
  }, [read.data]);

  function reset() {
    operation.current++;
    saving.current = false;
    const saved = read.data || form.saved;
    setForm({
      saved,
      values: meetingValues(saved || {}),
      conflict: null,
      status: null,
    });
  }

  function endSession() {
    operation.current++;
    saving.current = false;
    setForm(initialForm());
    read.setData(null);
  }

  function acceptSaved() {
    setForm((current) => ({
      saved: current.conflict,
      values: meetingValues(current.conflict),
      conflict: null,
      status: null,
    }));
  }

  function continueLocal() {
    setForm((current) => ({
      ...current,
      saved: current.conflict,
      conflict: null,
      status:
        "Deine Eingaben basieren jetzt auf dem aktuellen Stand. Prüfe sie vor dem erneuten Speichern.",
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (
      !form.values.eventAtInput ||
      !form.saved ||
      read.loading ||
      read.error ||
      form.conflict ||
      saving.current
    )
      return;
    const returnFocus = event.nativeEvent?.submitter || document.activeElement;
    let proposed;
    try {
      proposed = meetingRequest(form.values, form.saved);
    } catch (error) {
      setForm((current) => ({ ...current, status: error.message }));
      const dateField = event.currentTarget.querySelector("input");
      dateField?.setCustomValidity(error.message);
      dateField?.reportValidity();
      return;
    }
    const submitted = form.values;
    const request = ++operation.current;
    const active = () => request === operation.current;
    const feedback = (status, conflict = null) => {
      if (active()) setForm((current) => ({ ...current, status, conflict }));
    };
    saving.current = true;
    feedback("saving");
    try {
      if (meetingDeliveryImpact(read.data, proposed)) {
        let current, audience, templates;
        try {
          [current, audience, templates] = await Promise.all([
            readAdminJson(api, "/api/admin/zoom-mailings"),
            readCampaignAudience(api, "zoom"),
            readAdminJson(api, "/api/admin/templates"),
          ]);
          if (!validMeeting(current) || !Array.isArray(templates))
            throw new Error("Ungültige Versandangaben");
        } catch {
          feedback(
            "Die Folgen für den Versand konnten nicht geprüft werden. Es wurde nichts gespeichert. Deine Eingaben bleiben erhalten. Versuche es erneut.",
          );
          return;
        }
        if (!active()) return;
        if (current.revision !== proposed.expectedRevision) {
          feedback(
            "Der gespeicherte Termin wurde geändert. Vergleiche ihn mit deinen Eingaben.",
            current,
          );
          return;
        }
        onAudience?.(audience.data);
        const approved = await confirmDelivery({
          impact: meetingDeliveryImpact(current, proposed),
          audience,
          templates,
          returnFocus,
        });
        if (!active()) return;
        if (!approved) {
          feedback(null);
          return;
        }
      }
      const response = await api("/api/admin/zoom-settings", {
        method: "POST",
        body: JSON.stringify(proposed),
      });
      if (!active()) return;
      const data = await response.json().catch(() => ({}));
      if (!active()) return;
      if (response.ok) {
        if (!validMeeting(data))
          throw new Error("Der Server hat das Speichern nicht bestätigt.");
        const saved = {
          ...form.saved,
          revision: data.revision,
          eventAt: data.eventAt,
          link: submitted.zoomLink,
          linkOffsetHours: Number(submitted.linkOffsetHours),
          reminderOffsetHours: Number(submitted.reminderOffsetHours),
          showDelegierter: submitted.showDelegierter,
          mode: submitted.mode,
          location: {
            name: submitted.locationName,
            address: submitted.locationAddress,
            mapsUrl: submitted.locationMapsUrl,
          },
          durationMin: Number(submitted.durationMin),
        };
        setForm((current) => ({
          ...current,
          saved,
          status: data.mailingsReset ? "ok-reset" : "ok",
          conflict: null,
        }));
        await read.reload();
      } else {
        feedback(
          data.error || "Die Änderungen konnten nicht gespeichert werden.",
        );
        if (response.status === 409) {
          const latest = await read.reload();
          if (active() && latest)
            setForm((current) => ({ ...current, conflict: latest }));
        }
      }
    } catch {
      feedback(
        "Der Server hat das Speichern nicht bestätigt. Deine Eingaben bleiben erhalten. Speichere erneut und prüfe danach den gespeicherten Termin unten.",
      );
    } finally {
      if (active()) {
        saving.current = false;
        setForm((current) =>
          current.status === "saving" ? { ...current, status: null } : current,
        );
        requestAnimationFrame(() => {
          if (active() && returnFocus?.isConnected && !returnFocus.disabled)
            returnFocus.focus();
        });
      }
    }
  }

  return {
    ...form,
    read,
    dirty,
    changes: form.conflict ? meetingChanges(form.values, form.conflict) : [],
    update(key, value) {
      setForm((current) => ({
        ...current,
        values: { ...current.values, [key]: value },
        status: current.status === "saving" ? current.status : null,
      }));
    },
    reset,
    endSession,
    acceptSaved,
    continueLocal,
    save,
  };
}
