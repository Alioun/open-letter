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
import AdminOverview from "./AdminOverview.jsx";
import DeliveryBanner, { deliveryProblems } from "./DeliveryBanner.jsx";
import AdminStatistics from "./AdminStatistics.jsx";
import CampaignTestLanguage from "./CampaignTestLanguage.jsx";
import CampaignMessageFields from "./CampaignMessageFields.jsx";
import SelectedRecipients from "./SelectedRecipients.jsx";
import CampaignAudit from "./CampaignAudit.jsx";
import CampaignRetryReview from "./CampaignRetryReview.jsx";
import ZoomMailingRecovery from "./ZoomMailingRecovery.jsx";
import CampaignSubmitted from "./CampaignSubmitted.jsx";
import {
  ZoomRegistrationList,
  isZoomRegistrationPage,
  zoomRegistrationsPath,
} from "./ZoomRegistrations.jsx";
import SignerManagement from "./SignerManagement.jsx";
import FirstSigners from "./FirstSigners.jsx";
import AdminLog from "./AdminLog.jsx";
import SessionSettings from "./SessionSettings.jsx";
import MeetingDeliveryReview from "./MeetingDeliveryReview.jsx";
import MeetingSettings from "./MeetingSettings.jsx";
import { useMeetingForm } from "./meeting-form.js";
import MilestoneSettings from "./MilestoneSettings.jsx";
import { useMilestoneForm } from "./milestone-form.js";
import { useAdminRead, AdminReadStatus, readAdminJson } from "./admin-read.jsx";
import { campaignPhase, nextCampaignPoll } from "./campaign-poll.js";
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
import { GERMAN_STATES } from "../config/states.js";
import { SELECTION_LIMIT } from "../config/selection.js";
import {
  adminAreaFromHash,
  adminAreas,
  adminDocumentTitle,
  SETTINGS_SECTIONS,
} from "./admin-navigation.js";
import { useAdminSession } from "./admin-session.js";
import { signerDateRange } from "./signer-filters.js";
import AdminLogin from "./AdminLogin.jsx";
import {
  Breakable,
  Calendar,
  ConfirmDialog,
  EmptyState,
  Notice,
} from "./ui.jsx";
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

// "3.12.2026" as well as "03.12.2026".
function parseCampaignDate(raw) {
  if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(raw.trim())) return null;
  const parsed = parse(raw.trim(), "d.M.yyyy", new Date());
  return isValid(parsed) ? parsed : null;
}

const formatCount = (count) =>
  count == null ? "–" : count.toLocaleString("de-DE");

const stoppedByAdmin = (campaign) =>
  campaign.failure?.category === "stopped-by-admin";

// A send that has begun and is not over: running, waiting for its next try,
// or put back to "scheduled" while the mail service is unavailable.
const canStopCampaign = (campaign) =>
  ["sending", "failed"].includes(campaign.status) ||
  (campaign.status === "scheduled" && campaign.started);

function StatusBadge({ status }) {
  return (
    <span className={`admin-status status-${status}`}>
      {{
        scheduled: "Geplant",
        due: "Wird gleich gesendet",
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
  const AREAS = adminAreas();
  const AREA_IDS = AREAS.map((area) => area.id);
  const ZOOM_ON = Boolean(cfg.features.zoomEvent);
  const KV_ON = Boolean(cfg.features.kreisverbandField);
  const STATES_ON = Boolean(cfg.features.stateResolution);
  const OCCUPATION_ON = Boolean(cfg.features.occupationField);
  const occupationLabel = cfg.sign.fields.occupation.label;
  const functionLabel = cfg.sign.fields.signerFunction?.label;
  const [confirmation, setConfirmation] = useState(null);
  const askConfirmation = (
    message,
    { returnFocus = document.activeElement, ...options } = {},
  ) =>
    new Promise((resolve) =>
      setConfirmation({ message, resolve, returnFocus, ...options }),
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
  const [loggedOutEverywhere, setLoggedOutEverywhere] = useState(false);
  const [bootstrapErrors, setBootstrapErrors] = useState([]);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [campaignFeedback, setCampaignFeedback] = useState(null);
  // Bumped when the signer list or the first-signer card changed something
  // the other one shows.
  const [signerListVersion, setSignerListVersion] = useState(0);
  const [firstSignerVersion, setFirstSignerVersion] = useState(0);
  const [tab, setTab] = useState(() =>
    adminAreaFromHash(
      typeof window === "undefined" ? "" : window.location.hash,
      AREA_IDS,
    ),
  );
  const currentTab = useRef(tab);
  const area = AREAS.find((item) => item.id === tab);
  useEffect(() => {
    if (token) document.title = adminDocumentTitle(area.title);
  }, [area.title, token]);
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
  const deliveryIssues = deliveryProblems(emailStatus);
  const [emailDirty, setEmailDirty] = useState(false);
  const [statisticsDirty, setStatisticsDirty] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [stats, setStats] = useState(null);
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
  const [draftAudience, setAudience] = campaignDraft.field("audience");
  const audience = ZOOM_ON ? draftAudience : "newsletter";
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
  const [unresolvedKvs, setUnresolvedKvs] = useState([]);
  const [kvStateSelections, setKvStateSelections] = useState({});
  const [mergeBusy, setMergeBusy] = useState(null);
  const [mergeResult, setMergeResult] = useState(null);
  const [occOutlierGroups, setOccOutlierGroups] = useState([]);
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
        {
          returnFocus,
          title: "Termin und Versand prüfen",
          confirmLabel: "Termin & Versand freigeben",
        },
      ),
  });
  const milestoneForm = useMilestoneForm(api);
  const zoomDirty = meetingForm.dirty;
  const settingsDirty = emailDirty || statisticsDirty || milestoneForm.dirty;
  // `fromHistory`: the browser has already moved to `next` (back/forward or a
  // typed hash); staying put then means putting the current area back.
  async function navigate(next, { fromHistory = false, hash } = {}) {
    if (next === currentTab.current || next === pendingTab.current) return;
    pendingTab.current = next;
    try {
      await switchArea(next, fromHistory, hash);
    } finally {
      pendingTab.current = null;
    }
  }
  const pendingTab = useRef(null);
  async function switchArea(next, fromHistory, hash) {
    const dirty =
      (tab === "zoom" && zoomDirty) || (tab === "settings" && settingsDirty);
    if (
      dirty &&
      !(await askConfirmation(
        "Deine ungespeicherten Einstellungen gehen verloren, wenn du den Bereich wechselst.",
        {
          title: "Änderungen verwerfen?",
          confirmLabel: "Verwerfen und wechseln",
          danger: true,
          returnFocus: document
            .querySelector('button[aria-label="Admin Bereich"]')
            ?.getClientRects().length
            ? document.querySelector('button[aria-label="Admin Bereich"]')
            : document.activeElement,
        },
      ))
    ) {
      if (fromHistory) window.history.pushState(null, "", `#${tab}`);
      return;
    }
    if (tab === "zoom") meetingForm.reset();
    if (tab === "settings") milestoneForm.reset();
    focusDestination.current = true;
    currentTab.current = next;
    setTab(next);
    if (!fromHistory) window.history.pushState(null, "", `#${hash || next}`);
  }
  function openEmailSettings() {
    const heading = document.getElementById("settings-email-heading");
    if (currentTab.current === "settings" && heading) {
      heading.scrollIntoView({ block: "start" });
      heading.focus({ preventScroll: true });
    } else navigate("settings", { hash: "settings-email-heading" });
  }
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const follow = () =>
      navigateRef.current(adminAreaFromHash(window.location.hash, AREA_IDS), {
        fromHistory: true,
      });
    window.addEventListener("popstate", follow);
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, []);
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

  // "Empfänger auswählen": newsletter recipients picked by hand
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
    setSelDateInput(e.target.value);
    setSelDate(parseCampaignDate(e.target.value));
  }

  function handleDateInput(e) {
    setScheduleError("");
    setDateInput(e.target.value);
    setSelectedDate(parseCampaignDate(e.target.value));
  }

  const campaignRead = useAdminRead(
    api,
    "/api/admin/campaigns",
    Boolean(token) && (tab === "campaigns" || tab === "overview"),
    Array.isArray,
  );
  const campaigns = campaignRead.data || [];
  // The history re-reads itself while a send is due or running, and wakes up
  // when the next one falls due. Every read starts the wait again from what
  // it got back, so a timer that fires a moment early only adds a read.
  // Quietly, so buttons in the history are not disabled every few seconds;
  // one request at a time, and none applied after the area is left.
  useEffect(() => {
    if (!["campaigns", "overview"].includes(tab)) return;
    let stopped = false;
    let timer;
    const schedule = (list) => {
      const delay = nextCampaignPoll(list);
      if (delay !== null) timer = setTimeout(refresh, delay);
    };
    const refresh = async () => {
      let next = null;
      try {
        next = await readAdminJson(api, "/api/admin/campaigns");
      } catch {}
      if (stopped) return;
      // A new list renders and restarts this effect; a failed read retries.
      if (Array.isArray(next)) campaignRead.setData(next);
      else schedule(campaignRead.data || []);
    };
    schedule(campaignRead.data || []);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, tab, campaignRead.data, campaignRead.setData]);
  const [zoomPage, setZoomPage] = useState(0);
  const [zoomSearch, setZoomSearch] = useState("");
  const [zoomClears, setZoomClears] = useState(0);
  const zoomRegistrationRead = useAdminRead(
    api,
    zoomRegistrationsPath(zoomPage, zoomSearch),
    Boolean(token) && tab === "zoom",
    isZoomRegistrationPage,
  );
  const zoomTotal = zoomRegistrationRead.data?.total ?? 0;
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
      ...(KV_ON
        ? [
            [
              "Zuordnungsstatus",
              "/api/admin/state-resolution-status",
              setStateResolution,
            ],
            ["Regionskorrekturen", "/api/admin/kv-outliers", setOutlierGroups],
            [
              "Offene Zuordnungen",
              "/api/admin/unresolved-kvs",
              setUnresolvedKvs,
            ],
          ]
        : []),
      [
        "Schreibweisen der Angaben",
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
            "Die Newsletter-Empfänger konnten nicht geladen werden. Deine Auswahl bleibt erhalten.",
          );
        const data = await res.json();
        if (
          !Array.isArray(data.signers) ||
          !Number.isInteger(data.total) ||
          data.total < 0
        )
          throw new Error(
            "Die Newsletter-Empfänger konnten nicht geladen werden. Lade die Liste erneut.",
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
          "Die Filter konnten nicht geladen werden. Öffne den Bereich Empfänger auswählen erneut.",
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
            {
              returnFocus,
              title: immediate ? "Jetzt senden?" : "Versand einplanen?",
              confirmLabel: immediate ? "Jetzt senden" : "Versand einplanen",
            },
          );
        },
      );
      if (!campaign) return;
      if (selection) setSelSendStatus(null);
      else setCampaignFeedback(null);
      await reloadCampaigns();
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

  async function campaignActionRequest(id, action = "cancel") {
    if (campaignAction !== null) return;
    const retry = action === "retry";
    const stop = action === "stop";
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
            {
              returnFocus,
              title: "Erneut senden?",
              confirmLabel: "Erneuten Versand freigeben",
            },
          ))
        )
          return;
      } else {
        const campaign = campaigns.find((item) => item.id === id);
        if (!campaign)
          throw new Error(
            "Die Kampagne fehlt im geladenen Verlauf. Lade den Verlauf erneut.",
          );
        if (stop) {
          const sent = campaign.sent_offset ?? 0;
          if (
            !(await askConfirmation(
              <span className="campaign-summary">
                <span>
                  Kampagne #{campaign.id} · {campaign.subject}
                </span>
                <span>
                  {campaign.audience_size
                    ? `${formatCount(sent)} von ${formatCount(campaign.audience_size)}`
                    : formatCount(sent)}{" "}
                  {sent === 1 && !campaign.audience_size
                    ? "Nachricht ist"
                    : "Nachrichten sind"}{" "}
                  bereits gesendet und lassen sich nicht zurückholen. Eine
                  Nachricht, die in diesem Moment rausgeht, kommt noch an.
                </span>
                <span>
                  Alle anderen bekommen vorerst nichts. Mit „Erneut versuchen“
                  setzt du den Versand später fort. Niemand bekommt die
                  Nachricht doppelt.
                </span>
              </span>,
              {
                returnFocus,
                title: "Versand stoppen?",
                confirmLabel: "Versand stoppen",
                danger: true,
              },
            ))
          )
            return;
        } else if (
          !(await askConfirmation(
            <span className="campaign-summary">
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
            {
              returnFocus,
              title: "Geplanten Versand absagen?",
              confirmLabel: "Versand absagen",
              danger: true,
            },
          ))
        )
          return;
      }
      requested = true;
      const res = await api(
        `/api/admin/campaigns/${id}${retry ? "/retry" : stop ? "/stop" : ""}`,
        { method: retry || stop ? "POST" : "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error ||
            (retry
              ? "Der Versand konnte nicht erneut gestartet werden."
              : stop
                ? "Der Versand konnte nicht gestoppt werden."
                : "Der Versand konnte nicht abgesagt werden."),
        );
      }
      setCampaignActionFeedback(
        retry
          ? "Erneuter Versandversuch eingeplant."
          : stop
            ? `Versand gestoppt. ${formatCount(data.reached)} ${data.reached === 1 ? "Nachricht war" : "Nachrichten waren"} bereits gesendet.`
            : "Kampagne abgesagt.",
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
  const retryCampaign = (id) => campaignActionRequest(id, "retry");
  const stopCampaign = (id) => campaignActionRequest(id, "stop");

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
      // The server sends the newest matches up to the limit; what is already
      // selected takes up room as well.
      const fresh = data.ids.filter((id) => !selectedSignerIds.has(id));
      const added = fresh.slice(
        0,
        Math.max(0, SELECTION_LIMIT - selectedSignerIds.size),
      );
      setSelectedSignerIds((previous) => new Set([...previous, ...added]));
      const count = (n) => n.toLocaleString("de-DE");
      setSelectionFeedback(
        data.truncated || added.length < fresh.length
          ? `Nicht alle ${count(data.total ?? data.ids.length)} passenden Empfänger haben Platz: Eine Auswahl fasst höchstens ${count(SELECTION_LIMIT)}. Hinzugefügt wurden die neuesten ${count(added.length)}. Grenze die Treffer mit den Filtern ein oder sende an alle Newsletter-Empfänger.`
          : `${count(data.ids.length)} passende Empfänger zur Auswahl hinzugefügt.`,
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
        `Alle ${zoomTotal} Zoom-Anmeldungen werden endgültig gelöscht. ` +
          "Die gelöschten Anmeldungen lassen sich nicht wiederherstellen.",
        {
          title: "Alle Zoom-Anmeldungen löschen?",
          confirmLabel: "Endgültig löschen",
          danger: true,
        },
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
        setZoomPage(0);
        setZoomSearch("");
        setZoomClears((count) => count + 1);
        zoomRegistrationRead.setData({
          registrations: [],
          total: 0,
          delegates: 0,
          matches: 0,
        });
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
          ? `Deine Änderungen an ${unsaved.join(", ")} gehen beim Abmelden verloren.`
          : "Du wirst in diesem Browser abgemeldet.",
        unsaved.length
          ? {
              title: "Abmelden und Änderungen verwerfen?",
              confirmLabel: "Abmelden & verwerfen",
              danger: true,
            }
          : { title: "Abmelden?", confirmLabel: "Abmelden" },
      ))
    )
      return;
    endSessionHere();
  }

  function endSessionHere() {
    bootstrapRequest.current++;
    meetingForm.endSession();
    milestoneForm.endSession();
    setEmailDirty(false);
    setStatisticsDirty(false);
    signOut();
  }

  const audienceCount = !stats
    ? null
    : audience === "zoom"
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
          Beim Versand zählen der dann aktuelle Empfängerkreis und die dann
          veröffentlichte Vorlage.
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
        `Der Nachrichtenentwurf mit allen Sprachvarianten und dem Termin wird gelöscht.${selection ? " Die ausgewählten Empfänger bleiben erhalten." : ""}`,
        {
          title: "Entwurf zurücksetzen?",
          confirmLabel: "Zurücksetzen",
          danger: true,
        },
      ))
    )
      return;
    newCampaignMessage(selection);
  }

  function newCampaignMessage(selection = false) {
    (selection ? selectionDraft : campaignDraft).reset(
      selection ? { recipientIds: [...selectedSignerIds] } : {},
    );
    (selection ? selectionSubmission : campaignSubmission).reset();
    if (selection) setSelSendStatus(null);
    else setCampaignFeedback(null);
    if (selection) setSelectionScheduleError("");
    else setScheduleError("");
  }

  const signatures = (n) =>
    `${n.toLocaleString("de-DE")} ${n === 1 ? "Unterschrift" : "Unterschriften"}`;
  const unconfirmed = (error, fallback) =>
    error instanceof TypeError
      ? "Der Server hat die Aktion nicht bestätigt. Lade den aktuellen Stand, bevor du es erneut versuchst."
      : error.message || fallback;

  async function refreshStateResolution() {
    if (!KV_ON || !STATES_ON) return;
    try {
      setStateResolution(
        await readAdminJson(api, "/api/admin/state-resolution-status"),
      );
    } catch {}
  }

  // Merges and Land assignments change many signatures at once: they ask
  // first, name the count, and offer to take the change back (undoId).
  async function runMerge({ card, busyKey, path, body, question, applied }) {
    if (mergeBusy) return;
    if (
      !(await askConfirmation(question.message, {
        title: question.title,
        confirmLabel: question.confirmLabel,
      }))
    )
      return;
    setMergeBusy(busyKey);
    setMergeResult(null);
    try {
      const res = await api(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          data.error ||
            "Die Änderung wurde abgelehnt. Lade den aktuellen Stand und versuche es erneut.",
        );
      applied();
      setMergeResult({
        card,
        message: question.done(data.updated ?? 0),
        undoId: data.undoId,
      });
      refreshStateResolution();
    } catch (error) {
      setMergeResult({
        card,
        error: true,
        message: unconfirmed(error, "Die Änderung ist fehlgeschlagen."),
      });
    } finally {
      setMergeBusy(null);
    }
  }

  async function undoMerge() {
    const { card, undoId } = mergeResult;
    setMergeBusy("undo");
    try {
      const res = await api(`/api/admin/merges/${undoId}/undo`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          data.error || "Die Änderung ließ sich nicht zurücknehmen.",
        );
      setMergeResult({
        card,
        message: `Zurückgenommen. ${signatures(data.restored ?? 0)} haben wieder ihre frühere Angabe.`,
      });
      await loadAll();
    } catch (error) {
      setMergeResult({
        card,
        undoId,
        error: true,
        message: unconfirmed(error, "Die Rücknahme ist fehlgeschlagen."),
      });
    } finally {
      setMergeBusy(null);
    }
  }

  function mergeFeedback(card) {
    if (mergeResult?.card !== card) return null;
    return (
      <Notice
        tone={mergeResult.error ? "error" : "success"}
        onDismiss={() => setMergeResult(null)}
        action={
          mergeResult.undoId && (
            <Button
              type="button"
              className="admin-button admin-button--small"
              disabled={Boolean(mergeBusy)}
              onClick={undoMerge}
            >
              {mergeBusy === "undo" ? "Wird zurückgenommen…" : "Rückgängig"}
            </Button>
          )
        }
      >
        {mergeResult.message}
      </Notice>
    );
  }

  function assignState(kv) {
    const state = kvStateSelections[kv.kreisverband];
    return runMerge({
      card: "state",
      busyKey: kv.kreisverband,
      path: "/api/admin/assign-kv-state",
      body: { kreisverband: kv.kreisverband, state },
      question: {
        title: "Bundesland zuordnen?",
        message: `${signatures(kv.count)} aus „${kv.kreisverband}“ bekommen das Bundesland ${state}. Du kannst das danach rückgängig machen.`,
        confirmLabel: "Zuordnen",
        done: (n) =>
          `${signatures(n)} aus „${kv.kreisverband}“ haben jetzt das Bundesland ${state}.`,
      },
      applied: () => {
        setUnresolvedKvs((prev) =>
          prev.filter((u) => u.kreisverband !== kv.kreisverband),
        );
        setKvStateSelections((prev) => {
          const next = { ...prev };
          delete next[kv.kreisverband];
          return next;
        });
      },
    });
  }

  function outlierCard({
    key,
    title,
    groups,
    setGroups,
    mergePath,
    dismissPath,
  }) {
    if (groups.length === 0 && mergeResult?.card !== key) return null;
    const settle = (group, outlier, canonical = group.canonical) =>
      setGroups((prev) =>
        prev
          .map((g) =>
            g.canonical.name === group.canonical.name
              ? {
                  ...g,
                  canonical,
                  outliers: g.outliers.filter((o) => o.name !== outlier.name),
                }
              : g,
          )
          .filter((g) => g.outliers.length > 0),
      );
    const merge = (group, outlier, from, to) =>
      runMerge({
        card: key,
        busyKey: outlier.name,
        path: mergePath,
        body: { from: from.name, to: to.name },
        question: {
          title: "Schreibweisen zusammenführen?",
          message: `${signatures(from.count)} mit „${from.name}“ bekommen „${to.name}“. Du kannst das danach rückgängig machen.`,
          confirmLabel: "Zusammenführen",
          done: (n) =>
            `${signatures(n)} von „${from.name}“ auf „${to.name}“ geändert.`,
        },
        applied: () =>
          settle(group, outlier, {
            name: to.name,
            count: group.canonical.count + outlier.count,
          }),
      });
    async function keep(group, outlier) {
      setMergeBusy(outlier.name);
      try {
        const res = await api(dismissPath, {
          method: "POST",
          body: JSON.stringify({
            canonical: group.canonical.name,
            outlier: outlier.name,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(
            data.error || "Die Schreibweise wurde nicht gespeichert.",
          );
        settle(group, outlier);
      } catch (error) {
        setMergeResult({
          card: key,
          error: true,
          message: unconfirmed(
            error,
            "Die Schreibweise wurde nicht gespeichert.",
          ),
        });
      } finally {
        setMergeBusy(null);
      }
    }
    return (
      <div className="admin-card admin-card--wide">
        <h2 className="admin-card-title">
          {title} ({groups.reduce((n, g) => n + g.outliers.length, 0)})
        </h2>
        {mergeFeedback(key)}
        <div className="outlier-groups">
          {groups.map((group) => (
            <div className="outlier-group" key={group.canonical.name}>
              <div className="outlier-canonical">
                <strong>{group.canonical.name}</strong>
                <span className="admin-muted"> ({group.canonical.count})</span>
              </div>
              {group.outliers.map((outlier) => (
                <div className="outlier-row" key={outlier.name}>
                  <span className="outlier-name">
                    {outlier.name}
                    <span className="admin-muted"> ({outlier.count})</span>
                  </span>
                  <span className="outlier-actions">
                    <Button
                      type="button"
                      className="admin-button admin-button--small"
                      disabled={Boolean(mergeBusy)}
                      onClick={() =>
                        merge(group, outlier, outlier, group.canonical)
                      }
                    >
                      <span>
                        {mergeBusy === outlier.name
                          ? "…"
                          : `→ ${group.canonical.name}`}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      className="admin-button admin-button--small"
                      disabled={Boolean(mergeBusy)}
                      onClick={() =>
                        merge(group, outlier, group.canonical, outlier)
                      }
                    >
                      <span>
                        {mergeBusy === outlier.name ? "…" : `→ ${outlier.name}`}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      className="admin-button admin-button--quiet admin-button--small"
                      disabled={Boolean(mergeBusy)}
                      onClick={() => keep(group, outlier)}
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
    );
  }

  if (!token) {
    return (
      <AdminLogin
        notice={
          loggedOutEverywhere &&
          "Alle Anmeldungen wurden beendet. Melde dich neu an."
        }
        onLogin={(newToken) => {
          setLoggedOutEverywhere(false);
          signIn(newToken);
        }}
      />
    );
  }

  const noTemplateNotice = (
    <Notice
      tone="info"
      title="Noch keine Newsletter-Vorlage"
      action={
        <Button
          type="button"
          className="admin-button admin-button--small"
          onClick={() => navigate("templates")}
        >
          Vorlage anlegen
        </Button>
      }
    >
      Eine Nachricht braucht eine Newsletter-Vorlage. Lege unter Vorlagen eine
      an und veröffentliche sie. Danach kannst du sie hier wählen.
    </Notice>
  );

  return (
    <main className="admin-shell" id="admin-content">
      <a
        className="admin-skip-link"
        href="#admin-content"
        onClick={(event) => {
          event.preventDefault();
          destinationHeading.current?.focus();
        }}
      >
        Zum Inhalt springen
      </a>
      <header className="admin-topbar">
        <div className="admin-wordmark">Verwaltung</div>
        <div className="admin-mobile-section">
          <Choice
            label="Admin Bereich"
            value={tab}
            onChange={navigate}
            options={AREAS.map(({ id, label }) => [
              id,
              id === "settings" && deliveryIssues.length
                ? `${label} (${deliveryIssues.length})`
                : label,
            ])}
          />
        </div>
        <nav aria-label="Admin Bereiche">
          {AREAS.map(({ id, label }) => (
            <Button
              key={id}
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {label}
              {id === "settings" && deliveryIssues.length > 0 && (
                <span className="admin-nav-count">
                  {deliveryIssues.length}
                  <span className="sr-only">
                    {deliveryIssues.length === 1
                      ? " Zustellproblem"
                      : " Zustellprobleme"}
                  </span>
                </span>
              )}
            </Button>
          ))}
        </nav>
        <Button
          type="button"
          className="admin-button admin-button--quiet admin-button--small admin-logout"
          onClick={logout}
        >
          Abmelden
        </Button>
      </header>
      <h1 className="sr-only" tabIndex={-1} ref={destinationHeading}>
        {area.title}
      </h1>
      {bootstrapErrors.length > 0 && (
        <Notice
          tone="error"
          className="admin-notice--page"
          action={
            <Button
              className="admin-button admin-button--small"
              disabled={bootstrapLoading}
              onClick={loadAll}
            >
              {bootstrapLoading ? "Wird geladen…" : "Erneut laden"}
            </Button>
          }
        >
          Verwaltungsdaten konnten nicht geladen werden:{" "}
          {bootstrapErrors.join(", ")}. Bereits geladene Angaben können veraltet
          sein.
        </Notice>
      )}
      {notice && (
        <Notice className="admin-notice--page" onDismiss={() => setNotice("")}>
          {notice}
        </Notice>
      )}
      <DeliveryBanner
        issues={deliveryIssues}
        status={emailStatus}
        onOpen={openEmailSettings}
      />

      {tab === "overview" && (
        <section className="section">
          <div className="section-inner">
            <AdminOverview
              api={api}
              stats={stats}
              emailStatus={emailStatus}
              deliveryIssues={deliveryIssues}
              campaignRead={campaignRead}
              navigate={navigate}
              openEmailSettings={openEmailSettings}
            />
          </div>
        </section>
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
                {templates.length === 0 && noTemplateNotice}
                {campaignDraft.error && (
                  <Notice tone="error">{campaignDraft.error}</Notice>
                )}
                <Button
                  className="admin-button admin-button--small"
                  type="button"
                  disabled={
                    campaignSubmission.pending ||
                    Boolean(campaignSubmission.submitted)
                  }
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
                  disabled={
                    campaignSubmission.pending ||
                    Boolean(campaignSubmission.submitted)
                  }
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
                    {ZOOM_ON && (
                      <option value="email_not_zoom">
                        Newsletter-Empfänger ohne Zoom-Anmeldung
                      </option>
                    )}
                    {ZOOM_ON && (
                      <option value="zoom">Alle Zoom-Anmeldungen</option>
                    )}
                    {ZOOM_ON && zoomShowDelegierter && (
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
                              "Gib ein gültiges Datum ein, z. B. 3.12.2026.",
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
                        pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
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
              </div>
              <div className="admin-test-send">
                <h3>3. Testen und senden</h3>
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
                  className="admin-button"
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
                  <Notice tone="success">
                    Der Anbieter hat die Nachricht angenommen. Prüfe, ob sie im
                    Postfach angekommen ist.
                  </Notice>
                )}
                {testStatus &&
                  testStatus !== "ok" &&
                  testStatus !== "sending" && (
                    <Notice tone="error">{testStatus}</Notice>
                  )}
                {campaignSubmission.pending && (
                  <p role="status">
                    Der Versandauftrag wird geprüft und gespeichert…
                  </p>
                )}
                {campaignFeedback && (
                  <Notice tone={campaignFeedback.success ? "success" : "error"}>
                    {campaignFeedback.message}
                  </Notice>
                )}
                {campaignSubmission.submitted ? (
                  <CampaignSubmitted
                    campaign={campaignSubmission.submitted}
                    status={campaignPhase(
                      campaigns.find(
                        (c) => c.id === campaignSubmission.submitted.id,
                      ),
                    )}
                    onNew={() => newCampaignMessage()}
                  />
                ) : (
                  <div className="admin-actions">
                    <Button
                      className="admin-button admin-button--primary"
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
                      className="admin-button"
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
                )}
                <p className="admin-muted">
                  Empfänger*innen ({AUDIENCE_LABELS[audience]}):{" "}
                  {formatCount(audienceCount)}
                </p>
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
                  <EmptyState compact title="Noch keine Kampagnen geplant.">
                    Geplante und gesendete Nachrichten erscheinen hier.
                  </EmptyState>
                )}
              {campaigns.map((campaign) => (
                <div className="campaign-row" key={campaign.id}>
                  <div className="campaign-description">
                    <div className="campaign-heading">
                      <strong>{campaign.subject}</strong>
                      <StatusBadge status={campaignPhase(campaign)} />
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
                      {campaign.status === "sending" && campaign.audience_size
                        ? `${formatCount(campaign.sent_offset)} von ${formatCount(campaign.audience_size)} gesendet`
                        : `${formatCount(campaign.recipient_count ?? campaign.sent_offset ?? 0)} vom Anbieter angenommen`}
                    </small>
                    {campaignFeedbackId === campaign.id &&
                      campaignActionFeedback && (
                        <Notice
                          id={`campaign-feedback-${campaign.id}`}
                          tabIndex={-1}
                          className="campaign-action-feedback"
                        >
                          {campaignActionFeedback}
                        </Notice>
                      )}
                    {campaign.status === "failed" && (
                      <small className="admin-text-warning">
                        {campaign.sent_offset} erreicht, wird fortgesetzt
                      </small>
                    )}
                    {campaign.status === "aborted" && (
                      <small className="admin-text-warning">
                        {stoppedByAdmin(campaign)
                          ? `${campaign.sent_offset} erreicht, von euch gestoppt. „Erneut versuchen“ setzt den Versand fort.`
                          : `${campaign.sent_offset} erreicht, nach ${campaign.attempts} Versuchen abgebrochen`}
                      </small>
                    )}
                    {["failed", "aborted"].includes(campaign.status) &&
                      !stoppedByAdmin(campaign) && (
                        <>
                          <EmailFailure
                            title="Letzter Versandversuch"
                            failure={
                              campaign.failure || { category: "unknown" }
                            }
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
                          className="admin-button admin-button--small"
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
                    {canStopCampaign(campaign) && (
                      <Button
                        className="admin-button admin-button--danger-secondary admin-button--small"
                        type="button"
                        disabled={
                          campaignAction !== null ||
                          campaignRead.loading ||
                          campaignRead.error
                        }
                        onClick={() => stopCampaign(campaign.id)}
                      >
                        {campaignAction === campaign.id
                          ? "Wird gestoppt…"
                          : "Versand stoppen"}
                      </Button>
                    )}
                    {campaign.status === "scheduled" && !campaign.started && (
                      <Button
                        className="admin-button admin-button--danger-secondary admin-button--small"
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

      {tab === "signatures" && (
        <section className="section">
          <div className="section-inner">
            <SignerManagement
              api={api}
              enabled={sessionStatus === "active"}
              askConfirmation={askConfirmation}
              details={[
                cfg.sign.fields.signerFunction && "signerFunction",
                OCCUPATION_ON && "occupation",
                cfg.features.kreisverbandField && "kreisverband",
              ].filter(Boolean)}
              version={firstSignerVersion}
              onChanged={() => setSignerListVersion((before) => before + 1)}
            />
            <FirstSigners
              api={api}
              enabled={sessionStatus === "active"}
              askConfirmation={askConfirmation}
              version={signerListVersion}
              onChanged={() => setFirstSignerVersion((before) => before + 1)}
            />
          </div>
        </section>
      )}

      {tab === "signers" && (
        <section className="section">
          <div className="section-inner">
            <div className="admin-card signer-filters">
              <h2 className="admin-card-title">Newsletter-Empfänger suchen</h2>
              <div className="field">
                <label htmlFor={`${fieldId}-10`}>
                  {KV_ON
                    ? `Suche (Name, E-Mail, ${region.name})`
                    : "Suche (Name oder E-Mail)"}
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
                  <Collapsible.Trigger className="admin-disclosure-trigger">
                    Weitere Filter
                    {[
                      signerStateFilter,
                      signerKvFilter,
                      signerDatePreset !== "alle",
                    ].filter(Boolean).length > 0
                      ? ` · ${[signerStateFilter, signerKvFilter, signerDatePreset !== "alle"].filter(Boolean).length} aktiv`
                      : ""}
                  </Collapsible.Trigger>
                  {(signerStateFilter ||
                    signerKvFilter ||
                    signerDatePreset !== "alle") && (
                    <Button
                      type="button"
                      className="admin-button admin-button--quiet admin-button--small"
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
                    {KV_ON && (
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
                    )}
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
                        className="admin-field-error signer-date-error"
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
                <h2 className="admin-card-title">
                  {signerRange.error
                    ? "Zeitraum korrigieren"
                    : signerLoading
                      ? "Newsletter-Empfänger werden geladen…"
                      : signerError
                        ? "Newsletter-Empfänger nicht verfügbar"
                        : `${signerTotal.toLocaleString("de-DE")} Newsletter-Empfänger`}
                </h2>
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
                    className="admin-button"
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
                        ? "Alle Treffer zur Auswahl hinzufügen"
                        : signerTotal > SELECTION_LIMIT
                          ? `Die neuesten ${SELECTION_LIMIT.toLocaleString("de-DE")} von ${signerTotal.toLocaleString("de-DE")} zur Auswahl hinzufügen`
                          : `Alle ${signerTotal.toLocaleString("de-DE")} zur Auswahl hinzufügen`}
                  </Button>
                </div>
                {selectionFeedback && (
                  <Notice tone="success">{selectionFeedback}</Notice>
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
                  <ul
                    className="admin-cards signer-cards"
                    aria-label="Newsletter-Empfänger"
                  >
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
                          <span className="admin-card-person">
                            <strong>{r.name}</strong>
                            <span>
                              <Breakable text={r.email} />
                            </span>
                          </span>
                        </label>
                        <Collapsible.Root>
                          <Collapsible.Trigger className="admin-disclosure-trigger signer-card-details">
                            Details
                          </Collapsible.Trigger>
                          <Collapsible.Panel>
                            <dl className="admin-facts">
                              {KV_ON && r.kreisverband && (
                                <div>
                                  <dt>{region.name}</dt>
                                  <dd>{r.kreisverband}</dd>
                                </div>
                              )}
                              {STATES_ON && r.state && (
                                <div>
                                  <dt>Bundesland</dt>
                                  <dd>{r.state}</dd>
                                </div>
                              )}
                              {OCCUPATION_ON && r.occupation && (
                                <div>
                                  <dt>{occupationLabel}</dt>
                                  <dd>{r.occupation}</dd>
                                </div>
                              )}
                              {functionLabel && r.signerFunction && (
                                <div>
                                  <dt>{functionLabel}</dt>
                                  <dd>{r.signerFunction}</dd>
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
                        <th
                          scope="col"
                          className="admin-sticky admin-table-check"
                        >
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
                        <th
                          scope="col"
                          className="admin-sticky admin-sticky-edge"
                        >
                          Name
                        </th>
                        <th scope="col">E-Mail</th>
                        {KV_ON && <th scope="col">{region.name}</th>}
                        {STATES_ON && <th scope="col">Bundesland</th>}
                        {OCCUPATION_ON && (
                          <th scope="col">{occupationLabel}</th>
                        )}
                        {functionLabel && <th scope="col">{functionLabel}</th>}
                        <th scope="col">Unterschrieben</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signerRows.map((r) => (
                        <tr
                          key={r.id}
                          className={`signer-row${selectedSignerIds.has(r.id) ? " is-selected" : ""}`}
                        >
                          <td className="admin-sticky admin-table-check">
                            <Checkbox.Root
                              className="admin-checkbox"
                              aria-label={`${r.name}, ${r.email} auswählen`}
                              checked={selectedSignerIds.has(r.id)}
                              onCheckedChange={() => toggleSigner(r.id)}
                            >
                              <Checkbox.Indicator aria-hidden="true">
                                ✓
                              </Checkbox.Indicator>
                            </Checkbox.Root>
                          </td>
                          <td className="admin-sticky admin-sticky-edge admin-cell-wrap">
                            {r.name}
                          </td>
                          <td className="admin-cell-wrap">
                            <Breakable text={r.email} />
                          </td>
                          {KV_ON && (
                            <td className="admin-cell-wrap">
                              {r.kreisverband || "–"}
                            </td>
                          )}
                          {STATES_ON && <td>{r.state || "–"}</td>}
                          {OCCUPATION_ON && (
                            <td className="admin-cell-wrap">
                              {r.occupation || "–"}
                            </td>
                          )}
                          {functionLabel && <td>{r.signerFunction || "–"}</td>}
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
                    <EmptyState
                      compact
                      title="Keine Newsletter-Empfänger gefunden."
                    >
                      Ändere die Suche oder setze die Filter zurück.
                    </EmptyState>
                  )}
                {!signerLoading && !signerError && !signerRange.error && (
                  <div className="admin-pagination">
                    <Button
                      type="button"
                      className="admin-button admin-button--small"
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
                      className="admin-button admin-button--small"
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
                  {templates.length === 0 && noTemplateNotice}
                  {selectionDraft.error && (
                    <Notice tone="error">{selectionDraft.error}</Notice>
                  )}
                  <Button
                    className="admin-button admin-button--small"
                    type="button"
                    disabled={
                      selectionSubmission.pending ||
                      Boolean(selectionSubmission.submitted)
                    }
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
                    disabled={
                      selectionSubmission.pending ||
                      Boolean(selectionSubmission.submitted)
                    }
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
                                "Gib ein gültiges Datum ein, z. B. 3.12.2026.",
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
                          pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
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
                </div>
                <div className="admin-test-send">
                  <h3>3. Testen und senden</h3>
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
                    className="admin-button"
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
                    <Notice tone="success">
                      Der Anbieter hat die Nachricht angenommen. Prüfe, ob sie
                      im Postfach angekommen ist.
                    </Notice>
                  )}
                  {selTestStatus &&
                    selTestStatus !== "ok" &&
                    selTestStatus !== "sending" && (
                      <Notice tone="error">{selTestStatus}</Notice>
                    )}
                  {selectionSubmission.pending && (
                    <p role="status">
                      Der Versandauftrag wird geprüft und gespeichert…
                    </p>
                  )}
                  {selectionSubmission.submitted ? (
                    <CampaignSubmitted
                      campaign={selectionSubmission.submitted}
                      status={campaignPhase(
                        campaigns.find(
                          (c) => c.id === selectionSubmission.submitted.id,
                        ),
                      )}
                      onNew={() => newCampaignMessage(true)}
                    />
                  ) : (
                    <div className="admin-actions">
                      <Button
                        className="admin-button admin-button--primary"
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
                        className="admin-button"
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
                  )}
                  {selSendStatus && (
                    <Notice tone={selSendStatus.success ? "success" : "error"}>
                      {selSendStatus.message}
                    </Notice>
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
            {!ZOOM_ON && (
              <Notice
                tone="info"
                title="Anmeldung auf der Website ausgeschaltet"
              >
                Auf der Website kann sich gerade niemand zum Treffen anmelden.
                Termin, Zoom-Link und E-Mails lassen sich hier schon
                vorbereiten. Damit die Anmeldung erscheint, muss die Technik das
                Treffen für den Brief einschalten (features.zoomEvent).
              </Notice>
            )}
            <MeetingSettings
              form={meetingForm}
              askConfirmation={askConfirmation}
            />

            {zoomMailings && (
              <div className="admin-card">
                <h2 className="admin-card-title">Automatische E-Mails</h2>
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

            <div className="admin-card">
              <h2 className="admin-card-title">Testnachrichten</h2>
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
                  className="admin-button"
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
                  className="admin-button"
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
                  className="admin-button"
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
                <Notice tone="success">Testnachricht gesendet</Notice>
              )}
              {zoomTestStatus === "sending" && (
                <p className="admin-muted" role="status">
                  Wird gesendet…
                </p>
              )}
              {zoomTestStatus &&
                zoomTestStatus !== "ok" &&
                zoomTestStatus !== "sending" && (
                  <Notice tone="error">{zoomTestStatus}</Notice>
                )}
            </div>

            <div className="admin-card">
              <div className="admin-card-header">
                <h2 className="admin-card-title">
                  Zoom-Anmeldungen{" "}
                  {zoomRegistrationRead.data !== null
                    ? `· ${zoomTotal} gesamt`
                    : ""}
                  {zoomShowDelegierter &&
                    zoomRegistrationRead.data !== null && (
                      <> · {zoomRegistrationRead.data.delegates} Delegierte</>
                    )}
                </h2>
                <Button
                  type="button"
                  className="admin-button admin-button--danger-secondary admin-button--small"
                  onClick={clearZoomRegs}
                  disabled={
                    zoomTotal === 0 ||
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
                <Notice tone="success">
                  {zoomClearStatus.slice(3)} Alle Zoom-Anmeldungen wurden
                  gelöscht.
                </Notice>
              )}
              {zoomClearStatus &&
                zoomClearStatus !== "clearing" &&
                !zoomClearStatus.startsWith("ok:") && (
                  <Notice tone="error">{zoomClearStatus}</Notice>
                )}
              <ZoomRegistrationList
                key={zoomClears}
                api={api}
                askConfirmation={askConfirmation}
                read={zoomRegistrationRead}
                page={zoomPage}
                onPage={setZoomPage}
                search={zoomSearch}
                onSearch={setZoomSearch}
                showDelegierter={zoomShowDelegierter}
                regionLabel={KV_ON ? region.name : null}
              />
            </div>
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
            <EmailSetup
              api={api}
              onDirty={setEmailDirty}
              askConfirmation={askConfirmation}
            />
            <AdminStatistics api={api} onDirtyChange={setStatisticsDirty} />
            <div className="stat-tiles">
              <div className="stat-tile">
                <span>Unterschriften</span>
                <strong>{formatCount(stats?.signerCount)}</strong>
              </div>
              <div className="stat-tile">
                <span>Newsletter</span>
                <strong>{formatCount(stats?.subscriberCount)}</strong>
              </div>
            </div>
            <MilestoneSettings
              form={milestoneForm}
              signerCount={stats?.signerCount}
            />

            {KV_ON && STATES_ON && (
              <div className="admin-card admin-card--wide">
                <h2 className="admin-card-title">Bundesland-Zuordnung</h2>
                {mergeFeedback("state")}
                {stateResolution && (
                  <div className="state-resolution-stats">
                    <p>
                      <strong>{stateResolution.resolvedKvs}</strong>{" "}
                      {region.plural} zugeordnet,{" "}
                      <strong>{stateResolution.unresolvedKvs}</strong> offen
                    </p>
                    <p>
                      <strong>{stateResolution.resolvedSigners}</strong>{" "}
                      Unterschriften mit Bundesland,{" "}
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
                  <div>
                    <p className="admin-muted">Offene {region.plural}:</p>
                    <div className="state-resolution-list">
                      {unresolvedKvs.map((kv) => (
                        <div
                          key={kv.kreisverband}
                          className="state-resolution-row"
                        >
                          <span>
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
                            className="admin-button admin-button--small"
                            disabled={
                              !kvStateSelections[kv.kreisverband] ||
                              Boolean(mergeBusy)
                            }
                            onClick={() => assignState(kv)}
                          >
                            {mergeBusy === kv.kreisverband ? "…" : "Zuordnen"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="admin-actions">
                  <Button
                    type="button"
                    className="admin-button admin-button--primary"
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
                              ? `${data.enqueued} Unterschriften zur Zuordnung eingereiht.`
                              : "Keine Unterschriften ohne Bundesland gefunden.",
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
                    className="admin-button"
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
                {resolveMessage && <Notice>{resolveMessage}</Notice>}
              </div>
            )}
            {KV_ON &&
              outlierCard({
                key: "kv",
                title: `${region.name}-Tippfehler`,
                groups: outlierGroups,
                setGroups: setOutlierGroups,
                mergePath: "/api/admin/merge-kv",
                dismissPath: "/api/admin/dismiss-outlier",
              })}
            {OCCUPATION_ON &&
              outlierCard({
                key: "occupation",
                title: `${occupationLabel}: Schreibweisen`,
                groups: occOutlierGroups,
                setGroups: setOccOutlierGroups,
                mergePath: "/api/admin/merge-occupation",
                dismissPath: "/api/admin/dismiss-occupation-outlier",
              })}
            <SessionSettings
              api={api}
              askConfirmation={askConfirmation}
              onDone={() => {
                setLoggedOutEverywhere(true);
                endSessionHere();
              }}
            />
            <AdminLog api={api} enabled={sessionStatus === "active"} />
          </div>
        </section>
      )}
    </main>
  );
}
