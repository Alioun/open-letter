import { Input } from "@base-ui/react/input";
import { Checkbox } from "@base-ui/react/checkbox";
import { Choice, SelectControl } from "./ui.jsx";
import {
  isCampaignTemplate,
  campaignText,
} from "../config/campaign-templates.js";
import { useCallback, useEffect, useState, useId, useRef } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { Button } from "@base-ui/react/button";
import cfg, { LANGUAGES, DEFAULT_LANG } from "../config/letter.config.js";
import AdminPublisher from "./publishing/AdminPublisher.jsx";
import EmailSetup from "./EmailSetup.jsx";
import EmailFailure from "./EmailFailure.jsx";
import AdminStatistics from "./AdminStatistics.jsx";
import CampaignTestLanguage from "./CampaignTestLanguage.jsx";
import CampaignMessageFields from "./CampaignMessageFields.jsx";
import SelectedRecipients from "./SelectedRecipients.jsx";
import CampaignAudit from "./CampaignAudit.jsx";
import CampaignRetryReview from "./CampaignRetryReview.jsx";
import ZoomMailingRecovery from "./ZoomMailingRecovery.jsx";
import ZoomRegistrations from "./ZoomRegistrations.jsx";
import MeetingDeliveryReview from "./MeetingDeliveryReview.jsx";
import MeetingSettings from "./MeetingSettings.jsx";
import { useMeetingForm } from "./meeting-form.js";
import MilestoneSettings from "./MilestoneSettings.jsx";
import { useMilestoneForm } from "./milestone-form.js";
import { useAdminRead, AdminReadStatus, readAdminJson } from "./admin-read.jsx";
import {
  futureCampaignDate,
  useCampaignDraft,
  useCampaignSubmission,
  campaignTemplatesAvailable,
} from "./campaign-draft.js";
import { campaignSchedule } from "../config/campaign-schedule.js";
import {
  readCampaignAudience,
  readCampaignRetryReview,
  readCampaignSubjectExamples,
} from "./campaign-approval.js";
import { regionLabels } from "../config/region.js";
import { adminAreaFromHash, SETTINGS_SECTIONS } from "./admin-navigation.js";
import { useAdminSession } from "./admin-session.js";
import { signerDateRange } from "./signer-filters.js";
import AdminLogin from "./AdminLogin.jsx";
import { Calendar, ConfirmDialog } from "./ui.jsx";
import { format, parse, isValid } from "date-fns";
import { de } from "react-day-picker/locale";

const region = regionLabels(cfg);
const AUDIENCE_LABELS = {
  newsletter: "Newsletter-Empfänger",
  zoom: "Zoom-Anmelder",
  zoom_delegates: "Delegierte (Zoom)",
  email_not_zoom: "Newsletter-Empfänger ohne Zoom-Anmeldung",
  selection: "Auswahl",
};

function ScheduleCalendar(props) {
  return (
    <Collapsible.Root className="schedule-calendar">
      <Collapsible.Trigger className="admin-button">
        Datum im Kalender wählen <span aria-hidden="true">▾</span>
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <Calendar mode="single" locale={de} {...props} />
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function zoomMailingStatus(mailings, kind) {
  const m = (mailings || []).find((x) => x.kind === kind);
  if (!m) return "ausstehend";
  if (m.status === "sent") {
    const count = m.recipient_count != null ? ` (${m.recipient_count})` : "";
    const when = m.sent_at
      ? " am " + new Date(m.sent_at).toLocaleString("de-DE")
      : "";
    return `gesendet${count}${when}`;
  }
  if (m.status === "sending") return "läuft …";
  if (m.status === "failed") return "fehlgeschlagen, wird erneut versucht";
  if (m.status === "aborted")
    return "nach mehreren Fehlern angehalten · Versand prüfen";
  return m.status;
}
const GERMAN_STATES = [
  "Baden-Württemberg",
  "Bayern",
  "Berlin",
  "Brandenburg",
  "Bremen",
  "Hamburg",
  "Hessen",
  "Mecklenburg-Vorpommern",
  "Niedersachsen",
  "Nordrhein-Westfalen",
  "Rheinland-Pfalz",
  "Saarland",
  "Sachsen",
  "Sachsen-Anhalt",
  "Schleswig-Holstein",
  "Thüringen",
];

// Further languages of the letter (features.multiLanguage); empty otherwise,
// and then the campaign forms look and send exactly as before.
const extraLanguages = () => LANGUAGES.filter((l) => l !== DEFAULT_LANG);

// The campaign's `i18n` field from the per-language inputs: only languages
// with a template or subject of their own; the rest get the default text.
function campaignI18n(texts) {
  const out = {};
  for (const l of extraLanguages()) {
    const t = texts[l] || {};
    const entry = {};
    if (t.templateId) entry.templateId = Number(t.templateId);
    if (t.subject?.trim()) entry.subject = t.subject.trim();
    if (Object.keys(entry).length) out[l] = entry;
  }
  return Object.keys(out).length ? { i18n: out } : {};
}

// A template and subject per further language. Recipients whose language has
// neither get the default text above.
function CampaignLanguages({ templates, value, onChange }) {
  if (extraLanguages().length === 0) return null;
  const set = (l, patch) =>
    onChange({ ...value, [l]: { ...(value[l] || {}), ...patch } });
  return extraLanguages().map((l) => {
    const code = l.toUpperCase();
    const t = value[l] || {};
    return (
      <div key={l}>
        <CampaignMessageFields
          templates={templates}
          templateId={t.templateId || ""}
          subject={t.subject || ""}
          onTemplateChange={(templateId) => set(l, { templateId })}
          onSubjectChange={(subject) => set(l, { subject })}
          labelSuffix={` (${code})`}
          allowFallback
        />
      </div>
    );
  });
}

function StatusBadge({ status }) {
  return (
    <span className={`admin-status status-${status}`}>
      {{
        scheduled: "Geplant",
        sending: "Wird gesendet",
        sent: "Gesendet",
        failed: "Wird erneut versucht",
        aborted: "Angehalten",
        cancelled: "Abgesagt",
      }[status] || status}
    </span>
  );
}

export default function AdminApp() {
  const fieldId = useId();
  const STATES_ON = Boolean(cfg.features.stateResolution);
  const OCCUPATION_ON = Boolean(cfg.features.occupationField);
  const [confirmation, setConfirmation] = useState(null);
  const askConfirmation = (
    message,
    returnFocus = document.activeElement,
    confirmLabel,
  ) =>
    new Promise((resolve) =>
      setConfirmation({ message, resolve, returnFocus, confirmLabel }),
    );
  const resolveConfirmation = (value) => {
    confirmation?.resolve(value);
    setConfirmation(null);
  };

  const {
    token,
    status: sessionStatus,
    api,
    signIn,
    signOut,
  } = useAdminSession();
  const [notice, setNotice] = useState("");
  const [bootstrapErrors, setBootstrapErrors] = useState([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [campaignFeedback, setCampaignFeedback] = useState(null);
  const [tab, setTab] = useState(() => {
    return adminAreaFromHash(
      typeof window === "undefined" ? "" : window.location.hash,
    );
  });
  const focusDestination = useRef(false);
  const destinationHeading = useRef(null);
  useEffect(() => {
    if (!token) return;
    const section =
      tab === "settings" &&
      SETTINGS_SECTIONS.find(([id]) => window.location.hash === `#${id}`);
    if (!focusDestination.current && !section) return;
    const frame = requestAnimationFrame(() => {
      focusDestination.current = false;
      const target = section
        ? document.getElementById(section[0])
        : destinationHeading.current;
      if (section) target?.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, token]);
  const [emailStatus, setEmailStatus] = useState(null);
  const [emailDirty, setEmailDirty] = useState(false);
  const [statisticsDirty, setStatisticsDirty] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [stats, setStats] = useState({
    signerCount: 0,
    subscriberCount: 0,
    newsletterNotZoomCount: 0,
    zoomCount: 0,
    zoomDelegateCount: 0,
  });
  const newCampaignDraft = () => {
    const date = futureCampaignDate();
    return {
      template: "",
      subject: "",
      texts: {},
      audience: "newsletter",
      date,
      dateInput: format(date, "dd.MM.yyyy"),
      time: "10:00",
      language: DEFAULT_LANG,
      recipientIds: [],
    };
  };
  const campaignDraft = useCampaignDraft(
    "open-letter-campaign-draft",
    newCampaignDraft,
  );
  const selectionDraft = useCampaignDraft(
    "open-letter-selection-draft",
    newCampaignDraft,
  );
  const campaignSubmission = useCampaignSubmission(
    "open-letter-campaign-submission",
  );
  const selectionSubmission = useCampaignSubmission(
    "open-letter-selection-submission",
  );
  const [scheduleTemplate, setScheduleTemplate] =
    campaignDraft.field("template");
  const [scheduleSubject, setScheduleSubject] = campaignDraft.field("subject");
  const [scheduleTexts, setScheduleTexts] = campaignDraft.field("texts");
  const [audience, setAudience] = campaignDraft.field("audience");
  const [selectedDate, setSelectedDate] = campaignDraft.field("date");
  const [selectedTime, setSelectedTime] = campaignDraft.field("time");
  const [dateInput, setDateInput] = campaignDraft.field("dateInput");
  const [testEmail, setTestEmail] = useState("");
  const [testLanguage, setTestLanguage] = campaignDraft.field("language");
  const [selTestLanguage, setSelTestLanguage] =
    selectionDraft.field("language");
  const [testStatus, setTestStatus] = useState(null);
  const [scheduleError, setScheduleError] = useState("");
  const [selectionScheduleError, setSelectionScheduleError] = useState("");
  const scheduleDateField = useRef(null);
  const selectionDateField = useRef(null);
  const [stateResolution, setStateResolution] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [resolveMessage, setResolveMessage] = useState("");
  const [outlierGroups, setOutlierGroups] = useState([]);
  const [merging, setMerging] = useState(null);
  const [unresolvedKvs, setUnresolvedKvs] = useState([]);
  const [kvStateSelections, setKvStateSelections] = useState({});
  const [assigningKv, setAssigningKv] = useState(null);
  const [occOutlierGroups, setOccOutlierGroups] = useState([]);
  const [occMerging, setOccMerging] = useState(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectionFeedback, setSelectionFeedback] = useState("");
  const [campaignAction, setCampaignAction] = useState(null);
  const [campaignActionFeedback, setCampaignActionFeedback] = useState("");
  const [campaignFeedbackId, setCampaignFeedbackId] = useState(null);
  const [zoomTestEmail, setZoomTestEmail] = useState("");
  const [zoomTestStatus, setZoomTestStatus] = useState(null);
  const [zoomClearStatus, setZoomClearStatus] = useState(null);
  const meetingForm = useMeetingForm({
    api,
    enabled: sessionStatus === "active" && tab === "zoom",
    onAudience: setStats,
    confirmDelivery: ({ impact, audience, templates, returnFocus }) =>
      askConfirmation(
        <MeetingDeliveryReview
          impact={impact}
          audience={audience}
          templates={templates}
          defaultLanguage={DEFAULT_LANG}
          ready={emailStatus?.ready}
        />,
        returnFocus,
        "Termin & Versand freigeben",
      ),
  });
  const milestoneForm = useMilestoneForm(api);
  const zoomDirty = meetingForm.dirty;
  const settingsDirty = emailDirty || statisticsDirty || milestoneForm.dirty;
  async function navigate(next) {
    if (next === tab) return;
    const dirty =
      (tab === "zoom" && zoomDirty) || (tab === "settings" && settingsDirty);
    if (
      dirty &&
      !(await askConfirmation(
        "Ungespeicherte Einstellungen verwerfen und den Bereich wechseln?",
        document
          .querySelector('button[aria-label="Admin Bereich"]')
          ?.getClientRects().length
          ? document.querySelector('button[aria-label="Admin Bereich"]')
          : document.activeElement,
      ))
    )
      return;
    if (tab === "zoom") meetingForm.reset();
    if (tab === "settings") milestoneForm.reset();
    focusDestination.current = true;
    setTab(next);
    window.history.replaceState(window.history.state, "", `#${next}`);
  }
  useEffect(() => {
    const guard = (e) => {
      if (
        zoomDirty ||
        settingsDirty ||
        campaignDraft.error ||
        selectionDraft.error
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [zoomDirty, settingsDirty, campaignDraft.error, selectionDraft.error]);

  // Unterzeichner (newsletter signer list) tab
  const SIGNER_PAGE_SIZE = 25;
  const [signerRows, setSignerRows] = useState([]);
  const [signerTotal, setSignerTotal] = useState(0);
  const [signerLoading, setSignerLoading] = useState(false);
  const [signerError, setSignerError] = useState("");
  const [signerAttempt, setSignerAttempt] = useState(0);
  const [signerSearch, setSignerSearch] = useState("");
  const [signerStateFilter, setSignerStateFilter] = useState("");
  const [signerKvFilter, setSignerKvFilter] = useState("");
  const [signerDatePreset, setSignerDatePreset] = useState("alle");
  const [signerDateFrom, setSignerDateFrom] = useState("");
  const [signerDateTo, setSignerDateTo] = useState("");
  const [signerPage, setSignerPage] = useState(0);
  const [signerFilterOpts, setSignerFilterOpts] = useState({
    states: [],
    kvs: [],
  });
  const [recipientIds, setRecipientIds] = selectionDraft.field("recipientIds");
  const selectedSignerIds = new Set(recipientIds);
  const setSelectedSignerIds = (update) =>
    setRecipientIds((ids) => [
      ...(typeof update === "function" ? update(new Set(ids)) : update),
    ]);
  const [selTemplate, setSelTemplate] = selectionDraft.field("template");
  const [selSubject, setSelSubject] = selectionDraft.field("subject");
  const [selTexts, setSelTexts] = selectionDraft.field("texts");
  const scheduleTemplateAvailable = campaignTemplatesAvailable(
    scheduleTemplate,
    scheduleTexts,
    templates,
  );
  const selectionTemplateAvailable = campaignTemplatesAvailable(
    selTemplate,
    selTexts,
    templates,
  );
  const [selDate, setSelDate] = selectionDraft.field("date");
  const [selDateInput, setSelDateInput] = selectionDraft.field("dateInput");
  const [selTime, setSelTime] = selectionDraft.field("time");
  const [selSendStatus, setSelSendStatus] = useState(null);
  const [selTestEmail, setSelTestEmail] = useState("");
  const [selTestStatus, setSelTestStatus] = useState(null);
  const [selectionAudit, setSelectionAudit] = useState(null);

  const signerRange = signerDateRange(
    signerDatePreset,
    signerDateFrom,
    signerDateTo,
  );

  function signerQuery(extra = {}) {
    const { from, to } = signerRange;
    const params = new URLSearchParams();
    if (signerSearch.trim()) params.set("search", signerSearch.trim());
    if (signerStateFilter) params.set("state", signerStateFilter);
    if (signerKvFilter) params.set("kv", signerKvFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    return params.toString();
  }

  function handleSelDateInput(e) {
    setSelectionScheduleError("");
    const raw = e.target.value;
    setSelDateInput(raw);
    const parsed = parse(raw, "dd.MM.yyyy", new Date());
    setSelDate(raw.length === 10 && isValid(parsed) ? parsed : null);
  }

  function handleDateInput(e) {
    setScheduleError("");
    const raw = e.target.value;
    setDateInput(raw);
    const parsed = parse(raw, "dd.MM.yyyy", new Date());
    setSelectedDate(raw.length === 10 && isValid(parsed) ? parsed : null);
  }

  const campaignRead = useAdminRead(
    api,
    "/api/admin/campaigns",
    Boolean(token) && tab === "campaigns",
    Array.isArray,
  );
  const campaigns = campaignRead.data || [];
  const zoomRegistrationRead = useAdminRead(
    api,
    "/api/admin/zoom-registrations",
    Boolean(token) && tab === "zoom",
    Array.isArray,
  );
  const zoomRegs = zoomRegistrationRead.data || [];
  const setZoomRegs = zoomRegistrationRead.setData;
  const zoomMailings = meetingForm.read.data;
  const zoomShowDelegierter = Boolean(zoomMailings?.showDelegierter);

  const bootstrapRequest = useRef(0);
  const loadAll = useCallback(async () => {
    if (sessionStatus !== "active") return;
    const request = ++bootstrapRequest.current;
    setBootstrapLoading(true);
    const sources = [
      [
        "Vorlagen",
        "/api/admin/templates",
        (data) => setTemplates(data.filter(isCampaignTemplate)),
      ],
      ["Empfängerzahlen", "/api/admin/stats", setStats],
      [
        "Zuordnungsstatus",
        "/api/admin/state-resolution-status",
        setStateResolution,
      ],
      ["Regionskorrekturen", "/api/admin/kv-outliers", setOutlierGroups],
      ["Offene Zuordnungen", "/api/admin/unresolved-kvs", setUnresolvedKvs],
      [
        "Tätigkeitskorrekturen",
        "/api/admin/occupation-outliers",
        setOccOutlierGroups,
      ],
      ["Zielmarken", "/api/admin/milestones", milestoneForm.load],
    ];
    const results = await Promise.allSettled(
      sources.map(async ([, path, apply]) => {
        const data = await readAdminJson(api, path);
        if (request === bootstrapRequest.current) apply(data);
      }),
    );
    if (request !== bootstrapRequest.current) return;
    setBootstrapErrors(
      sources
        .filter((_, i) => results[i].status === "rejected")
        .map(([label]) => label),
    );
    setBootstrapLoading(false);
  }, [api, sessionStatus, milestoneForm.load]);

  const reloadCampaigns = useCallback(async () => {
    await campaignRead.reload();
    try {
      setStats(await readAdminJson(api, "/api/admin/stats"));
    } catch {
      setNotice(
        "Die Empfängerzahlen konnten nicht geladen werden. Lade sie erneut.",
      );
    }
  }, [api, campaignRead.reload]);

  useEffect(() => {
    loadAll();
    window.addEventListener("publication-published", loadAll);
    return () => {
      bootstrapRequest.current++;
      window.removeEventListener("publication-published", loadAll);
    };
  }, [loadAll]);
  useEffect(() => {
    if (!token) return;
    const refresh = () =>
      api("/api/admin/email")
        .then(async (res) => {
          if (res.ok) setEmailStatus(await res.json());
          else setEmailStatus({ ready: false, unavailable: true });
        })
        .catch(() => setEmailStatus({ ready: false, unavailable: true }));
    refresh();
    window.addEventListener("email-configuration-changed", refresh);
    return () =>
      window.removeEventListener("email-configuration-changed", refresh);
  }, [api, token, tab]);

  // Each result belongs to the filter that requested it, including during debounce.
  useEffect(() => {
    if (tab !== "signers" || !token) return;
    const controller = new AbortController();
    let current = true;
    setSignerLoading(true);
    setSignerRows([]);
    setSignerTotal(0);
    setSignerError("");
    if (signerRange.error) {
      setSignerLoading(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const qs = signerQuery({
          limit: String(SIGNER_PAGE_SIZE),
          offset: String(signerPage * SIGNER_PAGE_SIZE),
        });
        const res = await api(`/api/admin/newsletter-signers?${qs}`, {
          signal: controller.signal,
        });
        if (!res.ok)
          throw new Error(
            "Unterzeichner konnten nicht geladen werden. Deine Auswahl bleibt erhalten.",
          );
        const data = await res.json();
        if (
          !Array.isArray(data.signers) ||
          !Number.isInteger(data.total) ||
          data.total < 0
        )
          throw new Error(
            "Die Unterzeichner konnten nicht geladen werden. Lade die Liste erneut.",
          );
        if (current) {
          setSignerRows(data.signers || []);
          setSignerTotal(data.total || 0);
        }
      } catch (error) {
        if (current) setSignerError(error.message);
      } finally {
        if (current) setSignerLoading(false);
      }
    }, 250);
    return () => {
      current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    api,
    token,
    tab,
    signerPage,
    signerSearch,
    signerStateFilter,
    signerKvFilter,
    signerDatePreset,
    signerDateFrom,
    signerDateTo,
    signerAttempt,
  ]);

  // Load filter dropdown options once when entering the signers tab.
  useEffect(() => {
    if (tab !== "signers" || !token) return;
    readAdminJson(api, "/api/admin/newsletter-signer-filters")
      .then(setSignerFilterOpts)
      .catch(() =>
        setNotice(
          "Die Filter konnten nicht geladen werden. Öffne den Bereich Unterzeichner erneut.",
        ),
      );
  }, [api, tab, token]);

  useEffect(() => {
    campaignDraft.initializeTemplate(templates);
    selectionDraft.initializeTemplate(templates);
  }, [templates, selTemplate, scheduleTemplate]);

  // Reset to first page whenever filters change.
  useEffect(() => {
    setSignerPage(0);
  }, [
    signerSearch,
    signerStateFilter,
    signerKvFilter,
    signerDatePreset,
    signerDateFrom,
    signerDateTo,
  ]);

  async function scheduleCampaign(e) {
    e.preventDefault();
    if (!scheduleTemplate || !selectedDate) return;
    const [hour, minute] = selectedTime.split(":").map(Number);
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(hour || 0, minute || 0, 0, 0);
    try {
      campaignSchedule({ scheduled_at: scheduledAt });
    } catch (error) {
      setScheduleError(error.message);
      scheduleDateField.current?.focus();
      scheduleDateField.current?.scrollIntoView({ block: "center" });
      return;
    }
    setScheduleError("");
    await submitCampaign(scheduledAt);
  }

  async function sendNow(e) {
    e.preventDefault();
    await submitCampaign(new Date(), { immediate: true });
  }

  async function submitCampaign(
    scheduledAt,
    { immediate = false, selection = false } = {},
  ) {
    const returnFocus = document.activeElement;
    if (
      selection
        ? !selectionTemplateAvailable || selectedSignerIds.size === 0
        : !scheduleTemplateAvailable
    )
      return;
    const submission = selection ? selectionSubmission : campaignSubmission;
    try {
      const campaign = await submission.submit(
        api,
        {
          template_id: selection ? selTemplate : scheduleTemplate,
          subject: selection ? selSubject : scheduleSubject,
          scheduled_at: scheduledAt.toISOString(),
          send_now: immediate,
          audience: selection ? "selection" : audience,
          ...(selection && { recipient_ids: [...selectedSignerIds] }),
          ...campaignI18n(selection ? selTexts : scheduleTexts),
        },
        async () => {
          const checked = await readCampaignAudience(
            api,
            selection ? "selection" : audience,
            [...selectedSignerIds],
          );
          if (selection) setSelectionAudit(checked.data);
          else setStats(checked.data);
          if (!checked.count)
            throw new Error(
              "Keine verfügbaren Empfänger. Es wurde kein Versandauftrag erstellt.",
            );
          checked.subjectExamples = await readCampaignSubjectExamples(
            api,
            LANGUAGES.map((language) => ({
              language,
              ...campaignText(
                selection ? selTemplate : scheduleTemplate,
                selection ? selSubject : scheduleSubject,
                selection ? selTexts : scheduleTexts,
                language,
                templates,
              ),
            })),
          );
          return askConfirmation(
            deliverySummary(immediate ? null : scheduledAt, selection, checked),
            returnFocus,
            immediate ? "Jetzt senden" : "Versand einplanen",
          );
        },
      );
      if (!campaign) return;
      await reloadCampaigns();
      const message = `Kampagne #${campaign.id}: ${campaign.status === "cancelled" ? "bereits abgesagt" : campaign.status === "sent" ? "bereits gesendet" : immediate ? "Versand beauftragt" : "Versand eingeplant"}. ${campaign.replayed ? "Dieser Auftrag existiert bereits. Es wurde keine zweite Kampagne erstellt. " : ""}Setze den Entwurf zurück oder ändere die Nachricht, um einen neuen Auftrag zu erstellen.`;
      if (selection) setSelSendStatus({ success: true, message });
      else setCampaignFeedback({ success: true, message });
    } catch (error) {
      if (selection)
        setSelSendStatus({ success: false, message: error.message });
      else setCampaignFeedback({ success: false, message: error.message });
    } finally {
      requestAnimationFrame(() => {
        if (returnFocus?.isConnected && !returnFocus.disabled)
          returnFocus.focus();
      });
    }
  }

  async function sendTest(e) {
    e.preventDefault();
    if (!scheduleTemplateAvailable || !testEmail) return;
    const text = campaignText(
      scheduleTemplate,
      scheduleSubject,
      scheduleTexts,
      testLanguage,
      templates,
    );
    await sendTestMessage(setTestStatus, "/api/admin/test-send", {
      template_id: text.templateId,
      subject: text.subject,
      to: testEmail,
      lang: testLanguage,
      audience,
    });
  }

  async function sendTestMessage(setStatus, path, message) {
    setStatus("sending");
    try {
      const res = await api(path, {
        method: "POST",
        body: JSON.stringify(message),
      });
      if (res.ok) setStatus("ok");
      else {
        const data = await res.json().catch(() => ({}));
        setStatus(
          data.error || "Die Testnachricht konnte nicht gesendet werden.",
        );
      }
    } catch {
      setStatus(
        "Der Server hat den Testversand nicht bestätigt. Prüfe das Testpostfach, bevor du erneut sendest. Deine Eingaben bleiben erhalten.",
      );
    } finally {
      setStatus((current) => (current === "sending" ? null : current));
    }
  }

  async function campaignActionRequest(id, retry = false) {
    if (campaignAction !== null) return;
    const returnFocus = document.activeElement;
    let showFeedback = false;
    let requested = false;
    setCampaignAction(id);
    setCampaignFeedbackId(id);
    setCampaignActionFeedback("");
    try {
      if (retry) {
        const review = await readCampaignRetryReview(api, id);
        if (!review.remaining)
          throw new Error(
            "Es gibt keine verbleibenden Empfänger*innen. Es wurde kein neuer Versandversuch gestartet.",
          );
        if (
          !(await askConfirmation(
            <CampaignRetryReview
              review={review}
              paused={!emailStatus?.ready}
            />,
            returnFocus,
            "Erneuten Versand freigeben",
          ))
        )
          return;
      } else {
        const campaign = campaigns.find((item) => item.id === id);
        if (!campaign)
          throw new Error(
            "Die Kampagne fehlt im geladenen Verlauf. Lade den Verlauf erneut.",
          );
        if (
          !(await askConfirmation(
            <span className="campaign-summary">
              <strong>Geplanten Versand absagen?</strong>
              <span>
                Kampagne #{campaign.id} · {campaign.subject}
              </span>
              <span>
                Geplant für{" "}
                {new Date(campaign.scheduled_at).toLocaleString("de-DE", {
                  dateStyle: "full",
                  timeStyle: "long",
                })}
              </span>
              <span>
                Die Absage stoppt den geplanten Versand und lässt sich nicht
                rückgängig machen. Wenn du später senden möchtest, musst du eine
                neue Kampagne einplanen.
              </span>
            </span>,
            returnFocus,
            "Versand absagen",
          ))
        )
          return;
      }
      requested = true;
      const res = await api(
        `/api/admin/campaigns/${id}${retry ? "/retry" : ""}`,
        { method: retry ? "POST" : "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error ||
            (retry
              ? "Der Versand konnte nicht erneut gestartet werden."
              : "Der Versand konnte nicht abgesagt werden."),
        );
      }
      setCampaignActionFeedback(
        retry ? "Erneuter Versandversuch eingeplant." : "Kampagne abgesagt.",
      );
      showFeedback = true;
      await reloadCampaigns();
    } catch (error) {
      showFeedback = true;
      setCampaignActionFeedback(
        !requested && retry
          ? `${error instanceof TypeError || error instanceof SyntaxError ? "Die Angaben zur Versandfreigabe konnten nicht geladen werden. Versuche es erneut." : error.message} Es wurde kein neuer Versandversuch freigegeben.`
          : `${error instanceof TypeError ? "Der Server hat die Aktion nicht bestätigt." : error.message} Lade den Verlauf erneut und prüfe den Status, bevor du die Aktion wiederholst.`,
      );
    } finally {
      setCampaignAction(null);
      requestAnimationFrame(() => {
        const feedback = document.getElementById(`campaign-feedback-${id}`);
        if (showFeedback && feedback) {
          feedback.focus();
          feedback.scrollIntoView({ block: "center" });
        } else if (returnFocus?.isConnected && !returnFocus.disabled)
          returnFocus.focus();
      });
    }
  }
  const cancel = (id) => campaignActionRequest(id);
  const retryCampaign = (id) => campaignActionRequest(id, true);

  function toggleSigner(id) {
    setSelectedSignerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCurrentPage(checked) {
    setSelectedSignerIds((prev) => {
      const next = new Set(prev);
      for (const row of signerRows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  async function selectAllMatching() {
    if (selectingAll || signerRange.error) return;
    setSelectingAll(true);
    setSelectionFeedback("");
    try {
      const data = await readAdminJson(
        api,
        `/api/admin/newsletter-signer-ids?${signerQuery()}`,
      );
      if (!Array.isArray(data.ids)) throw new Error("Ungültige Auswahl");
      setSelectedSignerIds((previous) => new Set([...previous, ...data.ids]));
      setSelectionFeedback(
        `${data.ids.length.toLocaleString("de-DE")} passende Empfänger zur Auswahl hinzugefügt.`,
      );
    } catch {
      setSelectionFeedback(
        "Die Empfänger konnten nicht hinzugefügt werden. Deine Auswahl bleibt erhalten. Versuche es erneut.",
      );
    } finally {
      setSelectingAll(false);
    }
  }

  function clearSelection() {
    setSelectedSignerIds(new Set());
  }

  async function sendSelectionNow() {
    await submitCampaign(new Date(), { immediate: true, selection: true });
  }

  async function scheduleSelection(e) {
    e.preventDefault();
    if (!selDate) return;
    const [hour, minute] = selTime.split(":").map(Number);
    const when = new Date(selDate);
    when.setHours(hour || 0, minute || 0, 0, 0);
    try {
      campaignSchedule({ scheduled_at: when });
    } catch (error) {
      setSelectionScheduleError(error.message);
      selectionDateField.current?.focus();
      selectionDateField.current?.scrollIntoView({ block: "center" });
      return;
    }
    setSelectionScheduleError("");
    await submitCampaign(when, { selection: true });
  }

  async function sendSelectionTest() {
    if (!selectionTemplateAvailable || !selTestEmail) return;
    const text = campaignText(
      selTemplate,
      selSubject,
      selTexts,
      selTestLanguage,
      templates,
    );
    await sendTestMessage(setSelTestStatus, "/api/admin/test-send", {
      template_id: text.templateId,
      subject: text.subject,
      to: selTestEmail,
      lang: selTestLanguage,
      audience: "newsletter",
    });
  }

  async function sendZoomTest(kind) {
    if (!zoomTestEmail) return;
    await sendTestMessage(setZoomTestStatus, "/api/admin/zoom-test-send", {
      to: zoomTestEmail,
      kind,
    });
  }

  async function clearZoomRegs() {
    if (
      !(await askConfirmation(
        `Alle ${zoomRegs.length} Zoom-Anmeldungen endgültig löschen? ` +
          "Die gelöschten Anmeldungen lassen sich nicht wiederherstellen.",
      ))
    )
      return;
    setZoomClearStatus("clearing");
    try {
      const res = await api("/api/admin/zoom-registrations/clear", {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setZoomRegs([]);
        setZoomClearStatus(`ok:${data.removed ?? 0}`);
      } else {
        const data = await res.json().catch(() => ({}));
        setZoomClearStatus(
          data.error || "Die Anmeldungen konnten nicht gelöscht werden.",
        );
      }
    } catch {
      setZoomClearStatus(
        "Der Server hat das Löschen nicht bestätigt. Öffne den Zoom-Bereich erneut und prüfe den aktuellen Bestand, bevor du es erneut versuchst.",
      );
    } finally {
      setZoomClearStatus((current) =>
        current === "clearing" ? null : current,
      );
    }
  }

  async function logout() {
    const unsaved = [
      emailDirty && "E-Mail-Einstellungen",
      statisticsDirty && "Statistikerfassung",
      milestoneForm.dirty && "Zielmarken",
      zoomDirty && "Zoom-Termin",
    ].filter(Boolean);
    if (
      !(await askConfirmation(
        unsaved.length
          ? `Abmelden und ungespeicherte Einstellungen verwerfen? Deine Änderungen an ${unsaved.join(", ")} gehen dabei verloren.`
          : "Abmelden?",
        document.activeElement,
        unsaved.length ? "Abmelden & verwerfen" : "Abmelden",
      ))
    )
      return;
    bootstrapRequest.current++;
    meetingForm.endSession();
    milestoneForm.endSession();
    setEmailDirty(false);
    setStatisticsDirty(false);
    signOut();
  }

  const audienceCount =
    audience === "zoom"
      ? stats.zoomCount
      : audience === "zoom_delegates"
        ? stats.zoomDelegateCount
        : audience === "email_not_zoom"
          ? stats.newsletterNotZoomCount
          : stats.subscriberCount;

  function deliverySummary(when, selection, checked) {
    const templateId = selection ? selTemplate : scheduleTemplate;
    const subject = selection ? selSubject : scheduleSubject;
    const texts = selection ? selTexts : scheduleTexts;
    return (
      <span className="campaign-summary">
        <strong>{when ? "Versand einplanen?" : "Jetzt senden?"}</strong>
        <span>
          {selection
            ? "Ausgewählte Newsletter-Empfänger*innen"
            : AUDIENCE_LABELS[audience]}{" "}
          · {checked.count.toLocaleString("de-DE")} Empfänger*innen
          {" · geprüft um "}
          {checked.checkedAt.toLocaleTimeString("de-DE", { hour12: false })}
        </span>
        <span>
          {when
            ? new Intl.DateTimeFormat("de-DE", {
                dateStyle: "full",
                timeStyle: "long",
              }).format(when)
            : "Sofort nach Bestätigung"}
        </span>
        {LANGUAGES.map((language) => {
          const text = campaignText(
            templateId,
            subject,
            texts,
            language,
            templates,
          );
          return (
            <span key={language}>
              <strong>{language.toUpperCase()}</strong> ·{" "}
              {checked.byLanguage[language] || 0} Empfänger*innen:{" "}
              {
                templates.find((t) => String(t.id) === String(text.templateId))
                  ?.name
              }{" "}
              <small>
                Beispielbetreff: {checked.subjectExamples[language]}
              </small>
              {language !== DEFAULT_LANG && (
                <small>
                  {text.templateFallback
                    ? `${checked.byLanguage[language] || 0} mit Vorlage der Standardsprache (${DEFAULT_LANG.toUpperCase()})`
                    : "Eigene Sprachvorlage"}{" "}
                  ·{" "}
                  {text.subjectFallback
                    ? "Betreff der Standardsprache"
                    : "Eigener Betreff / Betreff der Sprachvorlage"}
                </small>
              )}
            </span>
          );
        })}
        <small>
          Die Beispiele verwenden Ada und 1.000 Unterschriften. Beim Versand
          setzt die Vorlage die Angaben der Person und die aktuellen Zahlen ein.
        </small>
        <small>
          Die Empfängergruppe wird beim Versand erneut ermittelt. Die
          Sprachzahlen können sich bis dahin ändern, etwa durch Abmeldungen.
        </small>
        <small>
          Der Versand verwendet die dann veröffentlichte Vorlage. Änderungen an
          der Vorlage gelten auch für bereits geplante Nachrichten. Selbst
          geschriebene Betreffzeilen bleiben erhalten. Betreffzeilen aus
          Vorlagen können sich ändern.
        </small>
        {selection && (
          <span>
            {checked.data.signers?.slice(0, 10).map((person) => (
              <span className="campaign-summary-recipient" key={person.id}>
                {person.name} · {person.email}
              </span>
            ))}
            {selectedSignerIds.size > 10 && (
              <small>
                Die vollständige Auswahl findest du unter "Ausgewählte Empfänger
                prüfen".
              </small>
            )}
          </span>
        )}
      </span>
    );
  }

  async function resetCampaignDraft(selection = false) {
    if (
      !(await askConfirmation(
        `Den Nachrichtenentwurf mit allen Sprachvarianten und dem Termin zurücksetzen?${selection ? " Die ausgewählten Empfänger bleiben erhalten." : ""}`,
      ))
    )
      return;
    (selection ? selectionDraft : campaignDraft).reset(
      selection ? { recipientIds: [...selectedSignerIds] } : {},
    );
    (selection ? selectionSubmission : campaignSubmission).reset();
    if (selection) setSelSendStatus(null);
    else setCampaignFeedback(null);
    if (selection) setSelectionScheduleError("");
    else setScheduleError("");
  }

  if (!token) {
    return <AdminLogin onLogin={signIn} />;
  }

  return (
    <main className="admin-shell">
      <header className="topbar admin-topbar">
        <div className="wordmark">
          <span className="dot" />
          Verwaltung
        </div>
        <div className="admin-mobile-section">
          <Choice
            label="Admin Bereich"
            value={tab}
            onChange={navigate}
            options={[
              ["copy", "Website"],
              ["templates", "Vorlagen"],
              ["campaigns", "Versand"],
              ["signers", "Unterzeichner"],
              ["zoom", "Zoom"],
              ["settings", "Einstellungen"],
            ]}
          />
        </div>
        <nav aria-label="Admin Bereiche">
          <Button
            className={tab === "copy" ? "active" : ""}
            aria-current={tab === "copy" ? "page" : undefined}
            onClick={() => navigate("copy")}
          >
            Website
          </Button>
          <Button
            className={tab === "templates" ? "active" : ""}
            aria-current={tab === "templates" ? "page" : undefined}
            onClick={() => navigate("templates")}
          >
            Vorlagen
          </Button>
          <Button
            className={tab === "campaigns" ? "active" : ""}
            aria-current={tab === "campaigns" ? "page" : undefined}
            onClick={() => navigate("campaigns")}
          >
            Versand
          </Button>
          <Button
            className={tab === "signers" ? "active" : ""}
            aria-current={tab === "signers" ? "page" : undefined}
            onClick={() => navigate("signers")}
          >
            Unterzeichner
          </Button>
          <Button
            className={tab === "zoom" ? "active" : ""}
            aria-current={tab === "zoom" ? "page" : undefined}
            onClick={() => navigate("zoom")}
          >
            Zoom
          </Button>
          <Button
            className={tab === "settings" ? "active" : ""}
            aria-current={tab === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            Einstellungen
          </Button>
        </nav>
      </header>
      <h1 className="sr-only" tabIndex={-1} ref={destinationHeading}>
        {
          {
            copy: "Website bearbeiten",
            templates: "E-Mail-Vorlagen",
            campaigns: "Versand",
            signers: "Unterzeichner",
            zoom: "Zoom-Termin",
            settings: "Einstellungen",
          }[tab]
        }
      </h1>
      {bootstrapErrors.length > 0 && (
        <div className="admin-notice" role="alert">
          Verwaltungsdaten konnten nicht geladen werden:{" "}
          {bootstrapErrors.join(", ")}. Bereits geladene Angaben können veraltet
          sein.
          <Button disabled={bootstrapLoading} onClick={loadAll}>
            {bootstrapLoading ? "Wird geladen…" : "Erneut laden"}
          </Button>
        </div>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
          <Button
            type="button"
            aria-label="Hinweis schließen"
            onClick={() => setNotice("")}
          >
            ×
          </Button>
        </p>
      )}
      {["campaigns", "signers", "zoom"].includes(tab) &&
        emailStatus &&
        !emailStatus.ready && (
          <Collapsible.Root className="admin-delivery-warning">
            <div className="admin-delivery-summary">
              <strong role="status">
                {emailStatus.unavailable
                  ? "Versandstatus nicht verfügbar"
                  : "E-Mail-Versand pausiert"}
              </strong>
              <Button
                type="button"
                onClick={() => navigate("settings")}
                aria-label={
                  emailStatus.unavailable
                    ? "E-Mail-Versandstatus prüfen"
                    : "E-Mail-Versand einrichten"
                }
              >
                {emailStatus.unavailable ? "Prüfen" : "Einrichten"}
              </Button>
            </div>
            <Collapsible.Trigger className="admin-delivery-details">
              Details zum Versand ▾
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <p>
                {emailStatus.unavailable
                  ? "Der Versandstatus konnte nicht geladen werden. Prüfe ihn in den E-Mail-Einstellungen. Deine Eingaben und geplanten Nachrichten bleiben erhalten."
                  : "Der Versand wartet auf ein geprüftes Versandprofil. Richte es in den E-Mail-Einstellungen ein. Erst danach kannst du Tests oder Nachrichten senden. Abgelaufene Links werden nicht gesendet."}
              </p>
            </Collapsible.Panel>
          </Collapsible.Root>
        )}

      <div hidden={tab !== "copy" && tab !== "templates"}>
        <AdminPublisher api={api} workspace={tab} />
      </div>

      {tab === "campaigns" && (
        <section className="section">
          <div className="section-inner admin-campaigns">
            <form
              className="admin-card campaign-form"
              aria-busy={campaignSubmission.pending}
              onSubmit={scheduleCampaign}
            >
              <div className="campaign-form-heading">
                <h2 className="admin-card-title">Versand planen</h2>
                <p className="admin-muted">
                  Dein Nachrichtenentwurf bleibt beim Neuladen erhalten.
                </p>
                <p className="admin-muted">
                  Der Versand verwendet die dann veröffentlichte Vorlage.
                  Änderungen an Vorlagen gelten auch für bereits geplante
                  Nachrichten.
                </p>
                {campaignDraft.error && (
                  <p role="alert">{campaignDraft.error}</p>
                )}
                <Button
                  className="admin-button"
                  type="button"
                  disabled={campaignSubmission.pending}
                  onClick={() => resetCampaignDraft()}
                >
                  Entwurf zurücksetzen
                </Button>
              </div>
              <div className="campaign-message">
                <h3>1. Nachricht</h3>
                <CampaignMessageFields
                  templates={templates}
                  templateId={scheduleTemplate}
                  subject={scheduleSubject}
                  onTemplateChange={setScheduleTemplate}
                  onSubjectChange={setScheduleSubject}
                  disabled={campaignSubmission.pending}
                />
                <CampaignLanguages
                  templates={templates}
                  value={scheduleTexts}
                  onChange={setScheduleTexts}
                />
              </div>
              <div className="campaign-delivery">
                <h3>2. Empfänger & Zeitpunkt</h3>
                <div className="field">
                  <label htmlFor={`${fieldId}-4`}>Empfängergruppe</label>
                  <SelectControl
                    id={`${fieldId}-4`}
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  >
                    <option value="newsletter">Newsletter-Empfänger</option>
                    <option value="email_not_zoom">
                      Newsletter-Empfänger ohne Zoom-Anmeldung
                    </option>
                    <option value="zoom">Alle Zoom-Anmeldungen</option>
                    {zoomShowDelegierter && (
                      <option value="zoom_delegates">
                        Delegierte mit Zoom-Anmeldung
                      </option>
                    )}
                  </SelectControl>
                </div>
                <div className="admin-picker-wrapper">
                  <div className="admin-date-row">
                    <div className="field">
                      <label htmlFor={`${fieldId}-7`}>Datum</label>
                      <Input
                        id={`${fieldId}-7`}
                        ref={scheduleDateField}
                        aria-invalid={Boolean(scheduleError)}
                        aria-describedby={
                          scheduleError
                            ? `${fieldId}-schedule-error`
                            : undefined
                        }
                        type="text"
                        value={dateInput}
                        onChange={handleDateInput}
                        onBlur={() => {
                          if (dateInput && !selectedDate)
                            setScheduleError(
                              "Gib ein gültiges Datum als TT.MM.JJJJ ein.",
                            );
                        }}
                        placeholder="TT.MM.JJJJ"
                        maxLength={10}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${fieldId}-8`}>Uhrzeit</label>
                      <Input
                        id={`${fieldId}-8`}
                        type="text"
                        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                        placeholder="HH:MM"
                        title="Uhrzeit im 24-Stunden-Format, z. B. 18:30"
                        maxLength={5}
                        required
                        value={selectedTime}
                        onChange={(e) => {
                          setSelectedTime(e.target.value);
                          setScheduleError("");
                        }}
                      />
                    </div>
                  </div>
                  {scheduleError && (
                    <p
                      id={`${fieldId}-schedule-error`}
                      role="alert"
                      className="admin-field-error"
                    >
                      {scheduleError}
                    </p>
                  )}
                  <ScheduleCalendar
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                        setDateInput(format(date, "dd.MM.yyyy"));
                        setScheduleError("");
                      }
                    }}
                  />
                  <p className="admin-muted">
                    {selectedDate
                      ? format(selectedDate, "PPPP", { locale: de })
                      : ""}
                    <br />
                    Zeitzone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </p>
                </div>
                {campaignSubmission.pending && (
                  <p role="status">
                    Der Versandauftrag wird geprüft und gespeichert…
                  </p>
                )}
                {campaignFeedback && (
                  <p
                    role={campaignFeedback.success ? "status" : "alert"}
                    className={`admin-test-feedback ${campaignFeedback.success ? "admin-test-ok" : "admin-test-error"}`}
                  >
                    {campaignFeedback.message}
                  </p>
                )}
                <div className="admin-actions">
                  <Button
                    className="cta"
                    type="submit"
                    disabled={
                      campaignSubmission.pending ||
                      !selectedDate ||
                      !selectedTime ||
                      !scheduleTemplateAvailable
                    }
                  >
                    Versand einplanen
                  </Button>
                  <Button
                    className="cta"
                    type="button"
                    onClick={sendNow}
                    disabled={
                      campaignSubmission.pending ||
                      !emailStatus?.ready ||
                      !scheduleTemplateAvailable
                    }
                  >
                    Jetzt senden
                  </Button>
                </div>
                <p className="admin-muted">
                  Empfänger*innen ({AUDIENCE_LABELS[audience]}):{" "}
                  {audienceCount.toLocaleString("de-DE")}
                </p>
              </div>
              <div className="admin-test-send">
                <CampaignTestLanguage
                  api={api}
                  templates={templates}
                  language={testLanguage}
                  onLanguage={setTestLanguage}
                  templateId={scheduleTemplate}
                  subject={scheduleSubject}
                  translations={scheduleTexts}
                />
                <div className="field">
                  <label htmlFor={`${fieldId}-9`}>Testversand an</label>
                  <Input
                    id={`${fieldId}-9`}
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@beispiel.de"
                  />
                </div>
                <Button
                  className="cta cta--outline"
                  type="button"
                  onClick={sendTest}
                  disabled={
                    campaignSubmission.pending ||
                    !emailStatus?.ready ||
                    !scheduleTemplateAvailable ||
                    !testEmail ||
                    testStatus === "sending"
                  }
                >
                  {testStatus === "sending"
                    ? "Wird gesendet\u2026"
                    : "Test senden"}
                </Button>
                {testStatus === "ok" && (
                  <p className="admin-test-feedback admin-test-ok">
                    Der Anbieter hat die Nachricht angenommen. Prüfe, ob sie im
                    Postfach angekommen ist.
                  </p>
                )}
                {testStatus &&
                  testStatus !== "ok" &&
                  testStatus !== "sending" && (
                    <p className="admin-test-feedback admin-test-error">
                      {testStatus}
                    </p>
                  )}
              </div>
            </form>

            <div className="admin-card campaign-list">
              <h2 className="admin-card-title">Versandverlauf</h2>
              <AdminReadStatus
                resource={{ ...campaignRead, reload: reloadCampaigns }}
                label="Kampagnen"
              />
              {campaignRead.data !== null &&
                !campaignRead.error &&
                campaigns.length === 0 && (
                  <p className="admin-muted">Noch keine Kampagnen geplant.</p>
                )}
              {campaigns.map((campaign) => (
                <div className="campaign-row" key={campaign.id}>
                  <div className="campaign-description">
                    <div className="campaign-heading">
                      <strong>{campaign.subject}</strong>
                      <StatusBadge status={campaign.status} />
                    </div>
                    <span>
                      {campaign.template_name || "Vorlage gelöscht"} ·{" "}
                      {AUDIENCE_LABELS[campaign.audience] || "Newsletter"}
                    </span>
                    <small>
                      Geplant:{" "}
                      {new Date(campaign.scheduled_at).toLocaleString("de-DE", {
                        hour12: false,
                      })}
                    </small>
                    <small>
                      Kampagne #{campaign.id} ·{" "}
                      {campaign.recipient_count ?? campaign.sent_offset ?? 0}{" "}
                      vom Anbieter angenommen
                    </small>
                    {campaignFeedbackId === campaign.id &&
                      campaignActionFeedback && (
                        <p
                          id={`campaign-feedback-${campaign.id}`}
                          tabIndex={-1}
                          role="status"
                          className="campaign-action-feedback"
                        >
                          {campaignActionFeedback}
                        </p>
                      )}
                    {campaign.status === "failed" && (
                      <small style={{ color: "#b45309" }}>
                        {campaign.sent_offset} erreicht, wird fortgesetzt
                      </small>
                    )}
                    {campaign.status === "aborted" && (
                      <small style={{ color: "#b45309" }}>
                        {campaign.sent_offset} erreicht, nach{" "}
                        {campaign.attempts} Versuchen abgebrochen
                      </small>
                    )}
                    {["failed", "aborted"].includes(campaign.status) && (
                      <>
                        <EmailFailure
                          title="Letzter Versandversuch"
                          failure={campaign.failure || { category: "unknown" }}
                        />
                        <Button
                          className="admin-button"
                          type="button"
                          onClick={() => navigate("settings")}
                        >
                          E-Mail-Einstellungen prüfen
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="campaign-actions">
                    {campaign.status === "aborted" && (
                      <>
                        <Button
                          className="admin-button"
                          type="button"
                          disabled={
                            campaignAction !== null ||
                            campaignRead.loading ||
                            campaignRead.error
                          }
                          onClick={() => retryCampaign(campaign.id)}
                        >
                          {campaignAction === campaign.id
                            ? "Wird angefragt…"
                            : "Erneut versuchen"}
                        </Button>
                      </>
                    )}
                    {campaign.status === "scheduled" && (
                      <Button
                        className="admin-button"
                        type="button"
                        disabled={
                          campaignAction !== null ||
                          campaignRead.loading ||
                          campaignRead.error
                        }
                        onClick={() => cancel(campaign.id)}
                      >
                        {campaignAction === campaign.id
                          ? "Absage wird geprüft…"
                          : "Absagen"}
                      </Button>
                    )}
                  </div>
                  <CampaignAudit campaign={campaign} api={api} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "signers" && (
        <section className="section">
          <div className="section-inner">
            <div
              className="admin-card signer-filters"
              style={{ marginBottom: 16 }}
            >
              <h2 className="admin-card-title">Unterzeichner suchen</h2>
              <div className="field">
                <label htmlFor={`${fieldId}-10`}>
                  Suche (Name, E-Mail, {region.name})
                </label>
                <Input
                  id={`${fieldId}-10`}
                  value={signerSearch}
                  onChange={(e) => setSignerSearch(e.target.value)}
                  placeholder="Suchen…"
                />
              </div>
              <Collapsible.Root>
                <div className="signer-filter-actions">
                  <Collapsible.Trigger>
                    Weitere Filter
                    {[
                      signerStateFilter,
                      signerKvFilter,
                      signerDatePreset !== "alle",
                    ].filter(Boolean).length > 0
                      ? ` · ${[signerStateFilter, signerKvFilter, signerDatePreset !== "alle"].filter(Boolean).length} aktiv`
                      : ""}{" "}
                    ▾
                  </Collapsible.Trigger>
                  {(signerStateFilter ||
                    signerKvFilter ||
                    signerDatePreset !== "alle") && (
                    <Button
                      type="button"
                      onClick={() => {
                        setSignerStateFilter("");
                        setSignerKvFilter("");
                        setSignerDatePreset("alle");
                        setSignerDateFrom("");
                        setSignerDateTo("");
                      }}
                    >
                      Filter zurücksetzen
                    </Button>
                  )}
                </div>
                {(signerStateFilter ||
                  signerKvFilter ||
                  signerDatePreset !== "alle") && (
                  <p className="signer-active-filters">
                    {[
                      signerStateFilter,
                      signerKvFilter && `${region.name}: ${signerKvFilter}`,
                      signerDatePreset === "24h"
                        ? "Letzte 24 Stunden"
                        : signerDatePreset === "7d"
                          ? "Letzte 7 Tage"
                          : signerDatePreset === "custom"
                            ? `${signerDateFrom || "Beginn offen"} bis ${signerDateTo || "Ende offen"}`
                            : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <Collapsible.Panel>
                  <div className="signer-filter-bar">
                    {STATES_ON && (
                      <div className="field">
                        <label htmlFor={`${fieldId}-11`}>Bundesland</label>
                        <SelectControl
                          id={`${fieldId}-11`}
                          value={signerStateFilter}
                          onChange={(e) => setSignerStateFilter(e.target.value)}
                        >
                          <option value="">Alle</option>
                          {signerFilterOpts.states.map((s) => (
                            <option key={s.state} value={s.state}>
                              {s.state} ({s.count})
                            </option>
                          ))}
                        </SelectControl>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`${fieldId}-12`}>{region.name}</label>
                      <SelectControl
                        id={`${fieldId}-12`}
                        value={signerKvFilter}
                        onChange={(e) => setSignerKvFilter(e.target.value)}
                      >
                        <option value="">Alle</option>
                        {signerFilterOpts.kvs.map((k) => (
                          <option key={k.kreisverband} value={k.kreisverband}>
                            {k.kreisverband} ({k.count})
                          </option>
                        ))}
                      </SelectControl>
                    </div>
                    <div className="field">
                      <label htmlFor={`${fieldId}-13`}>Zeitraum</label>
                      <SelectControl
                        id={`${fieldId}-13`}
                        value={signerDatePreset}
                        onChange={(e) => setSignerDatePreset(e.target.value)}
                      >
                        <option value="alle">Alle</option>
                        <option value="24h">Letzte 24 Stunden</option>
                        <option value="7d">Letzte 7 Tage</option>
                        <option value="custom">Benutzerdefiniert</option>
                      </SelectControl>
                    </div>
                    {signerDatePreset === "custom" && (
                      <>
                        <div className="field">
                          <label htmlFor={`${fieldId}-14`}>Von</label>
                          <Input
                            id={`${fieldId}-14`}
                            type="date"
                            value={signerDateFrom}
                            max={signerDateTo || undefined}
                            aria-invalid={Boolean(signerRange.error)}
                            aria-describedby={
                              signerRange.error
                                ? `${fieldId}-date-range-error`
                                : undefined
                            }
                            onChange={(e) => setSignerDateFrom(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`${fieldId}-15`}>Bis</label>
                          <Input
                            id={`${fieldId}-15`}
                            type="date"
                            value={signerDateTo}
                            min={signerDateFrom || undefined}
                            aria-invalid={Boolean(signerRange.error)}
                            aria-describedby={
                              signerRange.error
                                ? `${fieldId}-date-range-error`
                                : undefined
                            }
                            onChange={(e) => setSignerDateTo(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                    {signerRange.error && (
                      <p
                        id={`${fieldId}-date-range-error`}
                        role="alert"
                        className="signer-date-error"
                      >
                        {signerRange.error}
                      </p>
                    )}
                  </div>
                </Collapsible.Panel>
              </Collapsible.Root>
            </div>

            <div className="admin-signers-layout">
              <div className="admin-card">
                <div className="admin-card-title">
                  {signerRange.error
                    ? "Zeitraum korrigieren"
                    : signerLoading
                      ? "Unterzeichner werden geladen…"
                      : signerError
                        ? "Unterzeichner nicht verfügbar"
                        : `${signerTotal.toLocaleString("de-DE")} Unterzeichner im Filter`}
                </div>
                {signerError && (
                  <div className="admin-read-status">
                    <p role="alert">{signerError}</p>
                    <Button
                      type="button"
                      className="admin-button"
                      onClick={() => setSignerAttempt((n) => n + 1)}
                    >
                      Erneut laden
                    </Button>
                  </div>
                )}
                <div className="signer-selection-actions">
                  <Button
                    type="button"
                    onClick={selectAllMatching}
                    disabled={
                      signerLoading ||
                      Boolean(signerRange.error) ||
                      Boolean(signerError) ||
                      selectingAll ||
                      signerTotal === 0
                    }
                  >
                    {selectingAll
                      ? "Empfänger werden hinzugefügt…"
                      : signerLoading || signerError || signerRange.error
                        ? "Alle Treffer hinzufügen"
                        : `Alle ${signerTotal.toLocaleString("de-DE")} hinzufügen`}
                  </Button>
                </div>
                {selectionFeedback && (
                  <p role="status" className="signer-selection-feedback">
                    {selectionFeedback}
                  </p>
                )}
                <SelectedRecipients
                  compose={() => {
                    const heading = document.getElementById(
                      "selection-compose-heading",
                    );
                    heading?.focus({ preventScroll: true });
                    heading?.scrollIntoView({
                      block: "start",
                      behavior: "smooth",
                    });
                  }}
                  api={api}
                  ids={[...selectedSignerIds]}
                  filterQuery={signerRange.error ? null : signerQuery()}
                  filterError={signerRange.error}
                  remove={(id) =>
                    setSelectedSignerIds((ids) => {
                      const next = new Set(ids);
                      next.delete(id);
                      return next;
                    })
                  }
                  clear={clearSelection}
                  onLoaded={setSelectionAudit}
                />
                <div className="signer-mobile-results">
                  <label className="signer-page-select">
                    <Checkbox.Root
                      className="admin-checkbox"
                      checked={
                        signerRows.length > 0 &&
                        signerRows.every((r) => selectedSignerIds.has(r.id))
                      }
                      onCheckedChange={(checked) => toggleCurrentPage(checked)}
                    >
                      <Checkbox.Indicator aria-hidden="true">
                        ✓
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    Diese Seite auswählen
                  </label>
                  <ul className="signer-cards" aria-label="Unterzeichner">
                    {signerRows.map((r) => (
                      <li
                        key={r.id}
                        className={
                          selectedSignerIds.has(r.id) ? "is-selected" : ""
                        }
                      >
                        <label className="signer-card-identity">
                          <Checkbox.Root
                            className="admin-checkbox"
                            checked={selectedSignerIds.has(r.id)}
                            onCheckedChange={() => toggleSigner(r.id)}
                          >
                            <Checkbox.Indicator aria-hidden="true">
                              ✓
                            </Checkbox.Indicator>
                          </Checkbox.Root>
                          <span className="signer-card-person">
                            <strong>{r.name}</strong>
                            <span>{r.email}</span>
                          </span>
                        </label>
                        <Collapsible.Root>
                          <Collapsible.Trigger className="signer-card-details">
                            Details <span aria-hidden="true">▾</span>
                          </Collapsible.Trigger>
                          <Collapsible.Panel>
                            <dl>
                              <div>
                                <dt>{region.name}</dt>
                                <dd>{r.kreisverband || "–"}</dd>
                              </div>
                              {STATES_ON && (
                                <div>
                                  <dt>Bundesland</dt>
                                  <dd>{r.state || "–"}</dd>
                                </div>
                              )}
                              {OCCUPATION_ON && (
                                <div>
                                  <dt>Tätigkeit</dt>
                                  <dd>{r.occupation || "–"}</dd>
                                </div>
                              )}
                              <div>
                                <dt>Unterschrieben</dt>
                                <dd>
                                  {new Date(r.created_at).toLocaleDateString(
                                    "de-DE",
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </Collapsible.Panel>
                        </Collapsible.Root>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="admin-table-wrap signer-desktop-results">
                  <table className="admin-table signer-table">
                    <thead>
                      <tr>
                        <th>
                          <Checkbox.Root
                            className="admin-checkbox"
                            aria-label="Seite auswählen"
                            checked={
                              signerRows.length > 0 &&
                              signerRows.every((r) =>
                                selectedSignerIds.has(r.id),
                              )
                            }
                            onCheckedChange={(checked) =>
                              toggleCurrentPage(checked)
                            }
                          >
                            <Checkbox.Indicator aria-hidden="true">
                              ✓
                            </Checkbox.Indicator>
                          </Checkbox.Root>
                        </th>
                        <th>Name</th>
                        <th>E-Mail</th>
                        <th>{region.name}</th>
                        {STATES_ON && <th>Bundesland</th>}
                        {OCCUPATION_ON && <th>Tätigkeit</th>}
                        <th>Unterschrieben</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signerRows.map((r) => (
                        <tr
                          key={r.id}
                          className="signer-row"
                          onClick={() => toggleSigner(r.id)}
                          aria-selected={selectedSignerIds.has(r.id)}
                        >
                          <td>
                            <Checkbox.Root
                              className="admin-checkbox"
                              aria-label={`${r.name}, ${r.email} auswählen`}
                              checked={selectedSignerIds.has(r.id)}
                              onCheckedChange={() => toggleSigner(r.id)}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Checkbox.Indicator aria-hidden="true">
                                ✓
                              </Checkbox.Indicator>
                            </Checkbox.Root>
                          </td>
                          <td>{r.name}</td>
                          <td>{r.email}</td>
                          <td>{r.kreisverband || "-"}</td>
                          {STATES_ON && <td>{r.state || "-"}</td>}
                          {OCCUPATION_ON && <td>{r.occupation || "-"}</td>}
                          <td>
                            {new Date(r.created_at).toLocaleDateString("de-DE")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {signerLoading && (
                  <p className="admin-muted" role="status">
                    Ergebnisse werden geladen…
                  </p>
                )}
                {!signerLoading &&
                  !signerError &&
                  !signerRange.error &&
                  signerRows.length === 0 && (
                    <p className="admin-muted">Keine Unterzeichner gefunden.</p>
                  )}
                {!signerLoading && !signerError && !signerRange.error && (
                  <div className="signer-pagination">
                    <Button
                      type="button"
                      disabled={signerPage === 0}
                      onClick={() => setSignerPage((p) => Math.max(0, p - 1))}
                    >
                      Zurück
                    </Button>
                    <span className="admin-muted">
                      Seite {signerPage + 1} /{" "}
                      {Math.max(1, Math.ceil(signerTotal / SIGNER_PAGE_SIZE))}
                    </span>
                    <Button
                      type="button"
                      disabled={
                        (signerPage + 1) * SIGNER_PAGE_SIZE >= signerTotal
                      }
                      onClick={() => setSignerPage((p) => p + 1)}
                    >
                      Weiter
                    </Button>
                  </div>
                )}
              </div>

              <form
                className="admin-card campaign-form"
                onSubmit={scheduleSelection}
                aria-busy={selectionSubmission.pending}
              >
                <div className="campaign-form-heading">
                  <h2
                    className="admin-card-title"
                    id="selection-compose-heading"
                    tabIndex={-1}
                  >
                    An Auswahl senden
                  </h2>
                  <p className="admin-muted">
                    Nachrichtenentwurf und Auswahl bleiben in diesem Browser
                    gespeichert.
                  </p>
                  <p className="admin-muted">
                    Der Versand verwendet die dann veröffentlichte Vorlage.
                    Änderungen an Vorlagen gelten auch für bereits geplante
                    Nachrichten.
                  </p>
                  {selectionDraft.error && (
                    <p role="alert">{selectionDraft.error}</p>
                  )}
                  <Button
                    className="admin-button"
                    type="button"
                    disabled={selectionSubmission.pending}
                    onClick={() => resetCampaignDraft(true)}
                  >
                    Entwurf zurücksetzen
                  </Button>
                  <p className="admin-muted">
                    {selectedSignerIds.size.toLocaleString("de-DE")}{" "}
                    Empfänger*innen ausgewählt
                  </p>
                </div>
                <div className="campaign-message">
                  <h3>1. Nachricht</h3>
                  <CampaignMessageFields
                    templates={templates}
                    templateId={selTemplate}
                    subject={selSubject}
                    onTemplateChange={setSelTemplate}
                    onSubjectChange={setSelSubject}
                    disabled={selectionSubmission.pending}
                  />
                  <CampaignLanguages
                    templates={templates}
                    value={selTexts}
                    onChange={setSelTexts}
                  />
                </div>
                <div className="campaign-delivery">
                  <h3>2. Zeitpunkt</h3>
                  <div className="admin-picker-wrapper">
                    <div className="admin-date-row">
                      <div className="field">
                        <label htmlFor={`${fieldId}-18`}>Datum</label>
                        <Input
                          id={`${fieldId}-18`}
                          ref={selectionDateField}
                          aria-invalid={Boolean(selectionScheduleError)}
                          aria-describedby={
                            selectionScheduleError
                              ? `${fieldId}-selection-schedule-error`
                              : undefined
                          }
                          type="text"
                          value={selDateInput}
                          onChange={handleSelDateInput}
                          onBlur={() => {
                            if (selDateInput && !selDate)
                              setSelectionScheduleError(
                                "Gib ein gültiges Datum als TT.MM.JJJJ ein.",
                              );
                          }}
                          placeholder="TT.MM.JJJJ"
                          maxLength={10}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`${fieldId}-19`}>Uhrzeit</label>
                        <Input
                          id={`${fieldId}-19`}
                          type="text"
                          pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                          placeholder="HH:MM"
                          title="Uhrzeit im 24-Stunden-Format, z. B. 18:30"
                          maxLength={5}
                          required
                          value={selTime}
                          onChange={(e) => {
                            setSelTime(e.target.value);
                            setSelectionScheduleError("");
                          }}
                        />
                      </div>
                    </div>
                    {selectionScheduleError && (
                      <p
                        id={`${fieldId}-selection-schedule-error`}
                        role="alert"
                        className="admin-field-error"
                      >
                        {selectionScheduleError}
                      </p>
                    )}
                    <ScheduleCalendar
                      selected={selDate}
                      onSelect={(date) => {
                        if (date) {
                          setSelDate(date);
                          setSelDateInput(format(date, "dd.MM.yyyy"));
                          setSelectionScheduleError("");
                        }
                      }}
                    />
                    <p className="admin-muted">
                      Zeitzone:{" "}
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </p>
                  </div>
                  {selectionSubmission.pending && (
                    <p role="status">
                      Der Versandauftrag wird geprüft und gespeichert…
                    </p>
                  )}
                  <div className="admin-actions">
                    <Button
                      className="cta"
                      type="submit"
                      disabled={
                        selectionSubmission.pending ||
                        !selectionTemplateAvailable ||
                        !selDate ||
                        !selTime ||
                        selectedSignerIds.size === 0 ||
                        !selectionAudit ||
                        selectionAudit.total === 0
                      }
                    >
                      Versand einplanen
                    </Button>
                    <Button
                      className="cta"
                      type="button"
                      onClick={sendSelectionNow}
                      disabled={
                        !emailStatus?.ready ||
                        selectionSubmission.pending ||
                        !selectionTemplateAvailable ||
                        selectedSignerIds.size === 0 ||
                        !selectionAudit ||
                        selectionAudit.total === 0
                      }
                    >
                      Jetzt senden
                    </Button>
                  </div>
                  {selSendStatus && (
                    <p
                      role={selSendStatus.success ? "status" : "alert"}
                      className={`admin-test-feedback ${selSendStatus.success ? "admin-test-ok" : "admin-test-error"}`}
                    >
                      {selSendStatus.message}
                    </p>
                  )}
                </div>
                <div className="admin-test-send">
                  <CampaignTestLanguage
                    api={api}
                    templates={templates}
                    language={selTestLanguage}
                    onLanguage={setSelTestLanguage}
                    templateId={selTemplate}
                    subject={selSubject}
                    translations={selTexts}
                  />
                  <div className="field">
                    <label htmlFor={`${fieldId}-20`}>Testversand an</label>
                    <Input
                      id={`${fieldId}-20`}
                      type="email"
                      value={selTestEmail}
                      onChange={(e) => setSelTestEmail(e.target.value)}
                      placeholder="test@beispiel.de"
                    />
                  </div>
                  <Button
                    className="cta cta--outline"
                    type="button"
                    onClick={sendSelectionTest}
                    disabled={
                      !emailStatus?.ready ||
                      !selectionTemplateAvailable ||
                      !selTestEmail ||
                      selTestStatus === "sending"
                    }
                  >
                    {selTestStatus === "sending"
                      ? "Wird gesendet…"
                      : "Test senden"}
                  </Button>
                  {selTestStatus === "ok" && (
                    <p className="admin-test-feedback admin-test-ok">
                      Der Anbieter hat die Nachricht angenommen. Prüfe, ob sie
                      im Postfach angekommen ist.
                    </p>
                  )}
                  {selTestStatus &&
                    selTestStatus !== "ok" &&
                    selTestStatus !== "sending" && (
                      <p className="admin-test-feedback admin-test-error">
                        {selTestStatus}
                      </p>
                    )}
                </div>
              </form>
            </div>
          </div>
        </section>
      )}

      {tab === "zoom" && (
        <section className="section">
          <div className="section-inner">
            <MeetingSettings
              form={meetingForm}
              askConfirmation={askConfirmation}
            />

            {zoomMailings && (
              <div className="admin-card" style={{ marginBottom: 20 }}>
                <div className="admin-card-title">Automatische E-Mails</div>
                <p className="admin-muted">
                  Gespeicherter Termin: {zoomMailings.eventLabel} (
                  {new Date(zoomMailings.eventAt).toLocaleString("de-DE")}) ·
                  Zoom-Link {zoomMailings.hasLink ? "gesetzt" : "fehlt noch"}
                </p>
                <p>
                  <strong>
                    Link-E-Mail ({zoomMailings.linkOffsetHours} Std. vorher, mit
                    .ics):
                  </strong>{" "}
                  {new Date(
                    new Date(zoomMailings.eventAt).getTime() -
                      zoomMailings.linkOffsetHours * 3600000,
                  ).toLocaleString("de-DE", { timeZoneName: "short" })}{" "}
                  · {zoomMailingStatus(zoomMailings.mailings, "link")}
                </p>
                <p>
                  <strong>
                    Erinnerung ({zoomMailings.reminderOffsetHours} Std. vorher):
                  </strong>{" "}
                  {new Date(
                    new Date(zoomMailings.eventAt).getTime() -
                      zoomMailings.reminderOffsetHours * 3600000,
                  ).toLocaleString("de-DE", { timeZoneName: "short" })}{" "}
                  · {zoomMailingStatus(zoomMailings.mailings, "reminder")}
                </p>
                {(zoomMailings.mailings || [])
                  .filter((mailing) => mailing.status === "aborted")
                  .map((mailing) => (
                    <ZoomMailingRecovery
                      key={mailing.kind}
                      mailing={mailing}
                      eventAt={zoomMailings.eventAt}
                      eventLabel={zoomMailings.eventLabel}
                      repair={() => navigate("settings")}
                    />
                  ))}
              </div>
            )}

            <div className="admin-card" style={{ marginBottom: 20 }}>
              <div className="admin-card-title">Testnachrichten</div>
              <p className="admin-muted">
                Sende die ausgewählte Zoom-E-Mail an eine Testadresse. Die
                angemeldeten Personen erhalten diesen Test nicht.
              </p>
              <div className="field">
                <label htmlFor={`${fieldId}-30`}>Testadresse</label>
                <Input
                  id={`${fieldId}-30`}
                  type="email"
                  value={zoomTestEmail}
                  onChange={(e) => setZoomTestEmail(e.target.value)}
                  placeholder="test@beispiel.de"
                />
              </div>
              <div className="admin-actions">
                <Button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => sendZoomTest("confirmation")}
                  disabled={
                    !emailStatus?.ready ||
                    !zoomTestEmail ||
                    zoomTestStatus === "sending"
                  }
                >
                  Bestätigung testen
                </Button>
                <Button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => sendZoomTest("link")}
                  disabled={
                    !emailStatus?.ready ||
                    !zoomTestEmail ||
                    zoomTestStatus === "sending"
                  }
                >
                  Link-E-Mail mit Kalendereintrag testen
                </Button>
                <Button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => sendZoomTest("reminder")}
                  disabled={
                    !emailStatus?.ready ||
                    !zoomTestEmail ||
                    zoomTestStatus === "sending"
                  }
                >
                  Erinnerung testen
                </Button>
              </div>
              {zoomTestStatus === "ok" && (
                <p className="admin-test-feedback admin-test-ok">
                  Testnachricht gesendet
                </p>
              )}
              {zoomTestStatus === "sending" && (
                <p className="admin-test-feedback">Wird gesendet…</p>
              )}
              {zoomTestStatus &&
                zoomTestStatus !== "ok" &&
                zoomTestStatus !== "sending" && (
                  <p className="admin-test-feedback admin-test-error">
                    {zoomTestStatus}
                  </p>
                )}
            </div>

            <div
              className="admin-card-title"
              style={{
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>
                Zoom-Anmeldungen{" "}
                {zoomRegistrationRead.data !== null
                  ? `· ${zoomRegs.length} gesamt`
                  : ""}
                {zoomShowDelegierter && (
                  <>
                    {" "}
                    · {zoomRegs.filter((r) => r.delegierter).length} Delegierte
                  </>
                )}
              </span>
              <Button
                type="button"
                className="admin-button admin-danger-secondary"
                onClick={clearZoomRegs}
                disabled={
                  zoomRegs.length === 0 ||
                  zoomClearStatus === "clearing" ||
                  zoomRegistrationRead.error ||
                  zoomRegistrationRead.loading
                }
              >
                {zoomClearStatus === "clearing"
                  ? "Wird gelöscht…"
                  : "Alle Zoom-Anmeldungen löschen"}
              </Button>
            </div>
            <AdminReadStatus
              resource={zoomRegistrationRead}
              label="Anmeldungen"
            />
            {zoomClearStatus && zoomClearStatus.startsWith("ok:") && (
              <p className="admin-test-feedback admin-test-ok">
                {zoomClearStatus.slice(3)} Alle Zoom-Anmeldungen wurden
                gelöscht.
              </p>
            )}
            {zoomClearStatus &&
              zoomClearStatus !== "clearing" &&
              !zoomClearStatus.startsWith("ok:") && (
                <p className="admin-test-feedback admin-test-error">
                  {zoomClearStatus}
                </p>
              )}
            {zoomRegistrationRead.data === null ? null : zoomRegs.length ===
              0 ? (
              !zoomRegistrationRead.error && <p>Noch keine Anmeldungen.</p>
            ) : (
              <ZoomRegistrations
                registrations={zoomRegs}
                showDelegierter={zoomShowDelegierter}
                regionLabel={region.name}
              />
            )}
          </div>
        </section>
      )}

      <ConfirmDialog request={confirmation} resolve={resolveConfirmation} />
      {sessionStatus === "expired" && (
        <AdminLogin
          expired
          onLogin={(newToken) => {
            signIn(newToken);
            setNotice(
              "Du bist wieder angemeldet. Deine Eingaben bleiben erhalten. Prüfe den gespeicherten Stand, bevor du erneut speicherst.",
            );
            requestAnimationFrame(() => destinationHeading.current?.focus());
          }}
        />
      )}
      {tab === "settings" && (
        <section className="section">
          <div className="section-inner settings-grid">
            <nav
              className="settings-section-links"
              aria-label="Einstellungen im Überblick"
            >
              {SETTINGS_SECTIONS.map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                </a>
              ))}
            </nav>
            <EmailSetup api={api} onDirty={setEmailDirty} />
            <AdminStatistics api={api} onDirtyChange={setStatisticsDirty} />
            <div className="admin-card stat-card">
              <span>Mitzeichner*innen</span>
              <strong>{stats.signerCount.toLocaleString("de-DE")}</strong>
            </div>
            <div className="admin-card stat-card">
              <span>Newsletter</span>
              <strong>{stats.subscriberCount.toLocaleString("de-DE")}</strong>
            </div>
            <MilestoneSettings form={milestoneForm} />

            {STATES_ON && (
              <div className="admin-card" style={{ gridColumn: "1 / -1" }}>
                <div className="admin-card-title">Bundesland-Zuordnung</div>
                {stateResolution && (
                  <div className="state-resolution-stats">
                    <p>
                      <strong>{stateResolution.resolvedKvs}</strong>{" "}
                      {region.plural} zugeordnet,{" "}
                      <strong>{stateResolution.unresolvedKvs}</strong> offen
                    </p>
                    <p>
                      <strong>{stateResolution.resolvedSigners}</strong>{" "}
                      Mitzeichner*innen mit Bundesland,{" "}
                      <strong>{stateResolution.unresolvedSigners}</strong> ohne
                    </p>
                    {stateResolution.queueLength > 0 && (
                      <p className="admin-muted">
                        Warteschlange: {stateResolution.queueLength} ausstehend
                      </p>
                    )}
                  </div>
                )}
                {unresolvedKvs.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="admin-muted" style={{ marginBottom: 8 }}>
                      Offene {region.plural}:
                    </p>
                    <div
                      style={{
                        maxHeight: 300,
                        overflowY: "auto",
                        fontSize: 13,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {unresolvedKvs.map((kv) => (
                        <div
                          key={kv.kreisverband}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ minWidth: 180 }}>
                            {kv.kreisverband}{" "}
                            <span className="admin-muted">({kv.count})</span>
                          </span>
                          <SelectControl
                            value={kvStateSelections[kv.kreisverband] || ""}
                            onChange={(e) =>
                              setKvStateSelections((prev) => ({
                                ...prev,
                                [kv.kreisverband]: e.target.value,
                              }))
                            }
                            className="admin-compact-select"
                          >
                            <option value="">– Bundesland –</option>
                            {GERMAN_STATES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </SelectControl>
                          <Button
                            type="button"
                            className="cta cta--outline admin-compact-btn"
                            disabled={
                              !kvStateSelections[kv.kreisverband] ||
                              assigningKv === kv.kreisverband
                            }
                            onClick={async () => {
                              setAssigningKv(kv.kreisverband);
                              try {
                                const res = await api(
                                  "/api/admin/assign-kv-state",
                                  {
                                    method: "POST",
                                    body: JSON.stringify({
                                      kreisverband: kv.kreisverband,
                                      state: kvStateSelections[kv.kreisverband],
                                    }),
                                  },
                                );
                                if (res.ok) {
                                  setUnresolvedKvs((prev) =>
                                    prev.filter(
                                      (u) => u.kreisverband !== kv.kreisverband,
                                    ),
                                  );
                                  setKvStateSelections((prev) => {
                                    const next = { ...prev };
                                    delete next[kv.kreisverband];
                                    return next;
                                  });
                                  const statusRes = await api(
                                    "/api/admin/state-resolution-status",
                                  );
                                  if (statusRes.ok)
                                    setStateResolution(await statusRes.json());
                                }
                              } catch {
                                setNotice(
                                  "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                );
                              }
                              setAssigningKv(null);
                            }}
                          >
                            {assigningKv === kv.kreisverband ? "…" : "Zuordnen"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="admin-actions">
                  <Button
                    type="button"
                    className="cta"
                    disabled={resolving}
                    onClick={async () => {
                      setResolving(true);
                      setResolveMessage("");
                      try {
                        const res = await api("/api/admin/resolve-states", {
                          method: "POST",
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setResolveMessage(
                            data.enqueued > 0
                              ? `${data.enqueued} Mitzeichner*innen zur Zuordnung eingereiht.`
                              : "Keine unzugeordneten Mitzeichner*innen gefunden.",
                          );
                          const [statusRes, unresRes] = await Promise.all([
                            api("/api/admin/state-resolution-status"),
                            api("/api/admin/unresolved-kvs"),
                          ]);
                          if (statusRes.ok)
                            setStateResolution(await statusRes.json());
                          if (unresRes.ok)
                            setUnresolvedKvs(await unresRes.json());
                        } else {
                          setResolveMessage("Fehler bei der Zuordnung.");
                        }
                      } catch {
                        setResolveMessage("Fehler bei der Zuordnung.");
                      }
                      setResolving(false);
                    }}
                  >
                    {resolving ? "Wird gestartet…" : "Zuordnung starten"}
                  </Button>
                  <Button
                    type="button"
                    className="cta cta--outline"
                    disabled={resolving}
                    onClick={async () => {
                      setResolving(true);
                      setResolveMessage("");
                      try {
                        const res = await api("/api/admin/re-enqueue-all", {
                          method: "POST",
                        });
                        if (res.ok) {
                          const data = await res.json();
                          setResolveMessage(
                            `Cache geleert (${data.cacheCleared}), ${data.enqueued} zur Zuordnung eingereiht.`,
                          );
                          const [statusRes, unresRes] = await Promise.all([
                            api("/api/admin/state-resolution-status"),
                            api("/api/admin/unresolved-kvs"),
                          ]);
                          if (statusRes.ok)
                            setStateResolution(await statusRes.json());
                          if (unresRes.ok)
                            setUnresolvedKvs(await unresRes.json());
                        } else {
                          setResolveMessage(
                            "Fehler bei der erneuten Zuordnung.",
                          );
                        }
                      } catch {
                        setResolveMessage("Fehler bei der erneuten Zuordnung.");
                      }
                      setResolving(false);
                    }}
                  >
                    {resolving ? "Wird gestartet…" : "Alle erneut prüfen"}
                  </Button>
                </div>
                {resolveMessage && (
                  <p className="admin-muted">{resolveMessage}</p>
                )}
              </div>
            )}
            {outlierGroups.length > 0 && (
              <div className="admin-card" style={{ gridColumn: "1 / -1" }}>
                <div className="admin-card-title">
                  {region.name}-Tippfehler (
                  {outlierGroups.reduce((n, g) => n + g.outliers.length, 0)})
                </div>
                <div className="outlier-groups">
                  {outlierGroups.map((group) => (
                    <div className="outlier-group" key={group.canonical.name}>
                      <div className="outlier-canonical">
                        <strong>{group.canonical.name}</strong>
                        <span className="admin-muted">
                          {" "}
                          ({group.canonical.count})
                        </span>
                      </div>
                      {group.outliers.map((outlier) => (
                        <div className="outlier-row" key={outlier.name}>
                          <span className="outlier-name">
                            {outlier.name}
                            <span className="admin-muted">
                              {" "}
                              ({outlier.count})
                            </span>
                          </span>
                          <span className="outlier-actions">
                            <Button
                              type="button"
                              className="cta cta--outline outlier-merge-btn"
                              disabled={merging === outlier.name}
                              onClick={async () => {
                                setMerging(outlier.name);
                                try {
                                  const res = await api("/api/admin/merge-kv", {
                                    method: "POST",
                                    body: JSON.stringify({
                                      from: outlier.name,
                                      to: group.canonical.name,
                                    }),
                                  });
                                  if (res.ok) {
                                    setOutlierGroups((prev) =>
                                      prev
                                        .map((g) =>
                                          g.canonical.name ===
                                          group.canonical.name
                                            ? {
                                                ...g,
                                                canonical: {
                                                  ...g.canonical,
                                                  count:
                                                    g.canonical.count +
                                                    outlier.count,
                                                },
                                                outliers: g.outliers.filter(
                                                  (o) =>
                                                    o.name !== outlier.name,
                                                ),
                                              }
                                            : g,
                                        )
                                        .filter((g) => g.outliers.length > 0),
                                    );
                                    const statusRes = await api(
                                      "/api/admin/state-resolution-status",
                                    );
                                    if (statusRes.ok)
                                      setStateResolution(
                                        await statusRes.json(),
                                      );
                                  }
                                } catch {
                                  setNotice(
                                    "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                  );
                                }
                                setMerging(null);
                              }}
                            >
                              {merging === outlier.name
                                ? "…"
                                : `→ ${group.canonical.name}`}
                            </Button>
                            <Button
                              type="button"
                              className="cta cta--outline outlier-merge-btn"
                              disabled={merging === outlier.name}
                              onClick={async () => {
                                setMerging(outlier.name);
                                try {
                                  const res = await api("/api/admin/merge-kv", {
                                    method: "POST",
                                    body: JSON.stringify({
                                      from: group.canonical.name,
                                      to: outlier.name,
                                    }),
                                  });
                                  if (res.ok) {
                                    setOutlierGroups((prev) =>
                                      prev
                                        .map((g) =>
                                          g.canonical.name ===
                                          group.canonical.name
                                            ? {
                                                ...g,
                                                canonical: {
                                                  name: outlier.name,
                                                  count:
                                                    g.canonical.count +
                                                    outlier.count,
                                                },
                                                outliers: g.outliers.filter(
                                                  (o) =>
                                                    o.name !== outlier.name,
                                                ),
                                              }
                                            : g,
                                        )
                                        .filter((g) => g.outliers.length > 0),
                                    );
                                    const statusRes = await api(
                                      "/api/admin/state-resolution-status",
                                    );
                                    if (statusRes.ok)
                                      setStateResolution(
                                        await statusRes.json(),
                                      );
                                  }
                                } catch {
                                  setNotice(
                                    "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                  );
                                }
                                setMerging(null);
                              }}
                            >
                              {merging === outlier.name
                                ? "…"
                                : `→ ${outlier.name}`}
                            </Button>
                            <Button
                              type="button"
                              className="outlier-dismiss"
                              disabled={merging === outlier.name}
                              onClick={async () => {
                                setMerging(outlier.name);
                                try {
                                  const res = await api(
                                    "/api/admin/dismiss-outlier",
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        canonical: group.canonical.name,
                                        outlier: outlier.name,
                                      }),
                                    },
                                  );
                                  if (res.ok) {
                                    setOutlierGroups((prev) =>
                                      prev
                                        .map((g) =>
                                          g.canonical.name ===
                                          group.canonical.name
                                            ? {
                                                ...g,
                                                outliers: g.outliers.filter(
                                                  (o) =>
                                                    o.name !== outlier.name,
                                                ),
                                              }
                                            : g,
                                        )
                                        .filter((g) => g.outliers.length > 0),
                                    );
                                  }
                                } catch {
                                  setNotice(
                                    "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                  );
                                }
                                setMerging(null);
                              }}
                            >
                              Schreibweise beibehalten
                            </Button>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {occOutlierGroups.length > 0 && (
              <div className="admin-card" style={{ gridColumn: "1 / -1" }}>
                <div className="admin-card-title">
                  Berufs-Tippfehler (
                  {occOutlierGroups.reduce((n, g) => n + g.outliers.length, 0)})
                </div>
                <div className="outlier-groups">
                  {occOutlierGroups.map((group) => (
                    <div className="outlier-group" key={group.canonical.name}>
                      <div className="outlier-canonical">
                        <strong>{group.canonical.name}</strong>
                        <span className="admin-muted">
                          {" "}
                          ({group.canonical.count})
                        </span>
                      </div>
                      {group.outliers.map((outlier) => (
                        <div className="outlier-row" key={outlier.name}>
                          <span className="outlier-name">
                            {outlier.name}
                            <span className="admin-muted">
                              {" "}
                              ({outlier.count})
                            </span>
                          </span>
                          <span className="outlier-actions">
                            <Button
                              type="button"
                              className="cta cta--outline outlier-merge-btn"
                              disabled={occMerging === outlier.name}
                              onClick={async () => {
                                setOccMerging(outlier.name);
                                try {
                                  const res = await api(
                                    "/api/admin/merge-occupation",
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        from: outlier.name,
                                        to: group.canonical.name,
                                      }),
                                    },
                                  );
                                  if (res.ok) {
                                    setOccOutlierGroups((prev) =>
                                      prev
                                        .map((g) =>
                                          g.canonical.name ===
                                          group.canonical.name
                                            ? {
                                                ...g,
                                                canonical: {
                                                  ...g.canonical,
                                                  count:
                                                    g.canonical.count +
                                                    outlier.count,
                                                },
                                                outliers: g.outliers.filter(
                                                  (o) =>
                                                    o.name !== outlier.name,
                                                ),
                                              }
                                            : g,
                                        )
                                        .filter((g) => g.outliers.length > 0),
                                    );
                                  }
                                } catch {
                                  setNotice(
                                    "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                  );
                                }
                                setOccMerging(null);
                              }}
                            >
                              {occMerging === outlier.name
                                ? "…"
                                : `→ ${group.canonical.name}`}
                            </Button>
                            <Button
                              type="button"
                              className="cta cta--outline outlier-merge-btn"
                              disabled={occMerging === outlier.name}
                              onClick={async () => {
                                setOccMerging(outlier.name);
                                try {
                                  const res = await api(
                                    "/api/admin/merge-occupation",
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        from: group.canonical.name,
                                        to: outlier.name,
                                      }),
                                    },
                                  );
                                  if (res.ok) {
                                    setOccOutlierGroups((prev) =>
                                      prev
                                        .map((g) =>
                                          g.canonical.name ===
                                          group.canonical.name
                                            ? {
                                                ...g,
                                                canonical: {
                                                  name: outlier.name,
                                                  count:
                                                    g.canonical.count +
                                                    outlier.count,
                                                },
                                                outliers: g.outliers.filter(
                                                  (o) =>
                                                    o.name !== outlier.name,
                                                ),
                                              }
                                            : g,
                                        )
                                        .filter((g) => g.outliers.length > 0),
                                    );
                                  }
                                } catch {
                                  setNotice(
                                    "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                  );
                                }
                                setOccMerging(null);
                              }}
                            >
                              {occMerging === outlier.name
                                ? "…"
                                : `→ ${outlier.name}`}
                            </Button>
                            <Button
                              type="button"
                              className="outlier-dismiss"
                              disabled={occMerging === outlier.name}
                              onClick={async () => {
                                setOccMerging(outlier.name);
                                try {
                                  const res = await api(
                                    "/api/admin/dismiss-occupation-outlier",
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        canonical: group.canonical.name,
                                        outlier: outlier.name,
                                      }),
                                    },
                                  );
                                  if (res.ok) {
                                    setOccOutlierGroups((prev) =>
                                      prev
                                        .map((g) =>
                                          g.canonical.name ===
                                          group.canonical.name
                                            ? {
                                                ...g,
                                                outliers: g.outliers.filter(
                                                  (o) =>
                                                    o.name !== outlier.name,
                                                ),
                                              }
                                            : g,
                                        )
                                        .filter((g) => g.outliers.length > 0),
                                    );
                                  }
                                } catch {
                                  setNotice(
                                    "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst.",
                                  );
                                }
                                setOccMerging(null);
                              }}
                            >
                              Schreibweise beibehalten
                            </Button>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="admin-card">
              <div className="admin-card-title">Sitzung</div>
              <Button className="admin-danger" type="button" onClick={logout}>
                Abmelden
              </Button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
