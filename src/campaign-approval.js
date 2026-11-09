import { readAdminJson } from "./admin-read.jsx";

export async function readCampaignSubjectExamples(api, versions) {
  try {
    return Object.fromEntries(
      await Promise.all(
        versions.map(async (version) => {
          const data = await readAdminJson(api, "/api/admin/preview", {
            method: "POST",
            body: JSON.stringify({
              template_id: version.templateId,
              subject: version.subject,
              lang: version.language,
            }),
          });
          if (typeof data.subject !== "string")
            throw new Error("Invalid subject preview");
          return [version.language, data.subject];
        }),
      ),
    );
  } catch {
    throw new Error(
      "Die Betreffvorschau konnte nicht geladen werden. Es wurde kein Versandauftrag erstellt. Bitte erneut versuchen.",
    );
  }
}

export async function readCampaignRetryReview(api, id) {
  const response = await api(`/api/admin/campaigns/${id}/retry`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.error || "Die Versandfreigabe konnte nicht geladen werden.",
    );
  }
  const data = await response.json();
  if (
    data.id !== id ||
    ![data.remaining, data.eligible, data.alreadyAccepted].every(
      (value) => Number.isInteger(value) && value >= 0,
    ) ||
    data.remaining > data.eligible ||
    !Array.isArray(data.versions) ||
    data.versions.some(
      (version) =>
        !Number.isInteger(version.count) ||
        version.count < 0 ||
        typeof version.language !== "string" ||
        typeof version.templateName !== "string" ||
        typeof version.subject !== "string" ||
        typeof version.subjectExample !== "string",
    ) ||
    data.versions.reduce((total, version) => total + version.count, 0) !==
      data.remaining ||
    !Number.isFinite(new Date(data.checkedAt).getTime())
  )
    throw new Error(
      "Die Versandfreigabe konnte nicht vollständig geladen werden. Bitte erneut versuchen.",
    );
  return data;
}

const countKeys = {
  newsletter: "subscriberCount",
  zoom: "zoomCount",
  zoom_delegates: "zoomDelegateCount",
  email_not_zoom: "newsletterNotZoomCount",
};

export async function readCampaignAudience(api, audience, ids = []) {
  try {
    const data = await readAdminJson(
      api,
      audience === "selection"
        ? "/api/admin/newsletter-selection"
        : "/api/admin/stats",
      audience === "selection"
        ? { method: "POST", body: JSON.stringify({ ids, offset: 0 }) }
        : {},
    );
    const count =
      audience === "selection" ? data.total : data[countKeys[audience]];
    const byLanguage =
      audience === "selection"
        ? data.byLanguage
        : data.audienceLanguages?.[audience];
    if (!Number.isInteger(count) || count < 0)
      throw new Error("Ungültige Empfängerzahl");
    if (
      !byLanguage ||
      Object.values(byLanguage).some(
        (value) => !Number.isInteger(value) || value < 0,
      ) ||
      Object.values(byLanguage).reduce((sum, value) => sum + value, 0) !== count
    )
      throw new Error("Ungültige Sprachverteilung");
    return { count, byLanguage, data, checkedAt: new Date() };
  } catch {
    throw new Error(
      "Die Empfänger konnten nicht aktuell geprüft werden. Es wurde kein Versandauftrag erstellt. Bitte erneut versuchen.",
    );
  }
}
