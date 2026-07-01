import { useCallback, useEffect, useState } from "react";
import { DayPicker } from "react-day-picker";
import { format, parse, isValid } from "date-fns";
import { de } from "date-fns/locale";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import {
  Mark,
  mergeAttributes,
  markInputRule,
  markPasteRule,
} from "@tiptap/core";

const TOKEN_KEY = "gehaltsdeckel_admin_token";
const AUDIENCE_LABELS = {
  newsletter: "Newsletter-Unterschreiber",
  zoom: "Zoom-Anmelder",
  zoom_delegates: "Delegierte (Zoom)",
  email_not_zoom: "Newsletter-Unterschreiber ohne Zoom-Anmeldung",
  selection: "Auswahl",
};

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
  if (m.status === "failed") return "fehlgeschlagen — wird erneut versucht";
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
const variables = [
  "name",
  "firstName",
  "confirmUrl",
  "deleteUrl",
  "signerCount",
  "unsubscribeUrl",
  "eventLabel",
  "eventWhen",
  "zoomJaUrl",
  "zoomJaDelegiertUrl",
];

const TemplateVariable = Mark.create({
  name: "templateVariable",

  parseHTML() {
    return [{ tag: "span[data-template-variable]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-template-variable": "" }),
      0,
    ];
  },

  addInputRules() {
    return [
      markInputRule({
        find: /(\{\{\s*(?:name|confirmUrl|deleteUrl|signerCount|unsubscribeUrl)\s*\}\})$/,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: /\{\{\s*(?:name|confirmUrl|deleteUrl|signerCount|unsubscribeUrl)\s*\}\}/g,
        type: this.type,
      }),
    ];
  },
});

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ISO timestamp -> value for <input type="datetime-local"> in browser-local time.
function isoToLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function StatusBadge({ status }) {
  return <span className={`admin-status status-${status}`}>{status}</span>;
}

function ToolbarButton({ active, children, onClick, title }) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

function TemplateEditor({ token, template, onSaved, onDeleted }) {
  const [subject, setSubject] = useState(template?.subject || "");
  const [htmlBody, setHtmlBody] = useState(template?.html_body || "");
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [linkInput, setLinkInput] = useState(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "E-Mail-Text schreiben ..." }),
      CharacterCount.configure({ limit: 20000 }),
      TemplateVariable,
    ],
    content: htmlBody,
    immediatelyRender: false,
    onUpdate({ editor }) {
      setHtmlBody(editor.getHTML());
    },
  });

  useEffect(() => {
    setSubject(template?.subject || "");
    setHtmlBody(template?.html_body || "");
    setMessage("");
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(template?.html_body || "", false);
    }
  }, [template, editor]);

  useEffect(() => {
    if (!htmlBody) {
      setPreview("");
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch("/api/admin/preview", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ html_body: htmlBody }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreview(data.html);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [htmlBody, token]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href || "";
    setLinkInput(previous);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor || linkInput === null) return;
    const href = linkInput.trim();
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkInput(null);
  }, [editor, linkInput]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setMessage("");
    const start = Date.now();
    const res = await fetch(`/api/admin/templates/${template.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ subject, html_body: htmlBody }),
    });
    const elapsed = Date.now() - start;
    if (elapsed < 600) await new Promise((r) => setTimeout(r, 600 - elapsed));
    setSaving(false);
    if (!res.ok) {
      setMessage("Speichern fehlgeschlagen.");
      return;
    }
    const updated = await res.json();
    setSaved(true);
    onSaved(updated);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!template) return <div className="admin-empty">Vorlage auswählen.</div>;

  return (
    <div className="admin-editor-grid">
      <div className="admin-card editor-card">
        <div className="field">
          <label>Betreff</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>

        <div className="editor-toolbar" aria-label="Editor-Werkzeuge">
          <ToolbarButton
            title="Fett"
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            title="Kursiv"
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            I
          </ToolbarButton>
          <ToolbarButton
            title="Unterstrichen"
            active={editor?.isActive("underline")}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            U
          </ToolbarButton>
          <ToolbarButton
            title="Durchgestrichen"
            active={editor?.isActive("strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            S
          </ToolbarButton>
          <ToolbarButton
            title="H2"
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            title="H3"
            active={editor?.isActive("heading", { level: 3 })}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            H3
          </ToolbarButton>
          <ToolbarButton
            title="Liste"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            •
          </ToolbarButton>
          <ToolbarButton
            title="Nummerierte Liste"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            1.
          </ToolbarButton>
          <ToolbarButton
            title="Zitat"
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            ”
          </ToolbarButton>
          <ToolbarButton
            title="Link"
            active={editor?.isActive("link")}
            onClick={setLink}
          >
            ↗
          </ToolbarButton>
          <ToolbarButton
            title="Trennlinie"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          >
            —
          </ToolbarButton>
          <ToolbarButton
            title="Rückgängig"
            onClick={() => editor?.chain().focus().undo().run()}
          >
            ↶
          </ToolbarButton>
          <ToolbarButton
            title="Wiederholen"
            onClick={() => editor?.chain().focus().redo().run()}
          >
            ↷
          </ToolbarButton>
        </div>

        {linkInput !== null && (
          <div
            className="link-input-row"
            role="dialog"
            aria-modal="false"
            aria-label="Link einfügen"
          >
            <input
              autoFocus
              type="url"
              placeholder="https://..."
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLink();
                if (e.key === "Escape") setLinkInput(null);
              }}
            />
            <button type="button" onClick={applyLink}>
              OK
            </button>
            <button
              type="button"
              aria-label="Abbrechen"
              onClick={() => setLinkInput(null)}
            >
              ✕
            </button>
          </div>
        )}

        <div className="admin-editor-surface">
          <EditorContent editor={editor} />
        </div>

        <div className="admin-variable-row">
          {variables.map((variable) => (
            <button
              type="button"
              key={variable}
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .insertContent(
                    `<span data-template-variable>{{${variable}}}</span>`,
                  )
                  .run()
              }
            >
              {`{{${variable}}}`}
            </button>
          ))}
        </div>

        <div className="admin-actions">
          <button
            type="button"
            className={"cta" + (saved ? " cta--saved" : "")}
            onClick={save}
            disabled={saving || saved}
          >
            {saving ? "Speichert …" : saved ? "Gespeichert ✓" : "Speichern"}
          </button>
          {!template.system && (
            <button
              type="button"
              className="admin-danger"
              onClick={() => onDeleted(template.id)}
            >
              Löschen
            </button>
          )}
          <span>{message}</span>
        </div>
      </div>

      <aside className="admin-card preview-card">
        <div className="admin-card-title">Vorschau</div>
        <iframe title="E-Mail Vorschau" sandbox="" srcDoc={preview} />
      </aside>
    </div>
  );
}

export default function AdminApp() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || "",
  );
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState("templates");
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState({
    signerCount: 0,
    subscriberCount: 0,
    newsletterNotZoomCount: 0,
    zoomCount: 0,
    zoomDelegateCount: 0,
  });
  const [newName, setNewName] = useState("");
  const [scheduleTemplate, setScheduleTemplate] = useState("");
  const [scheduleSubject, setScheduleSubject] = useState("");
  const [audience, setAudience] = useState("newsletter");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState("10:00");
  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState(null);
  const [dateInput, setDateInput] = useState(() =>
    format(new Date(), "dd.MM.yyyy"),
  );
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
  const [zoomRegs, setZoomRegs] = useState([]);
  const [zoomMailings, setZoomMailings] = useState(null);
  const [zoomTestEmail, setZoomTestEmail] = useState("");
  const [zoomTestStatus, setZoomTestStatus] = useState(null);
  const [zoomClearStatus, setZoomClearStatus] = useState(null);
  const [zoomEventAtInput, setZoomEventAtInput] = useState("");
  const [zoomLinkInput, setZoomLinkInput] = useState("");
  const [zoomLinkOffset, setZoomLinkOffset] = useState(24);
  const [zoomReminderOffset, setZoomReminderOffset] = useState(2);
  // Ported operational Treffen settings (admin-editable, no redeploy).
  const [zoomShowDelegierter, setZoomShowDelegierter] = useState(false);
  const [zoomMode, setZoomMode] = useState("online");
  const [zoomLocationName, setZoomLocationName] = useState("");
  const [zoomLocationAddress, setZoomLocationAddress] = useState("");
  const [zoomLocationMapsUrl, setZoomLocationMapsUrl] = useState("");
  const [zoomEventLabel, setZoomEventLabel] = useState("");
  const [zoomNavLabel, setZoomNavLabel] = useState("");
  const [zoomSettingsStatus, setZoomSettingsStatus] = useState(null);
  const [milestonesInput, setMilestonesInput] = useState("");
  const [milestonesStatus, setMilestonesStatus] = useState(null);

  // Unterzeichner (newsletter signer list) tab
  const SIGNER_PAGE_SIZE = 25;
  const [signerRows, setSignerRows] = useState([]);
  const [signerTotal, setSignerTotal] = useState(0);
  const [signerLoading, setSignerLoading] = useState(false);
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
  const [selectedSignerIds, setSelectedSignerIds] = useState(() => new Set());
  const [selTemplate, setSelTemplate] = useState("");
  const [selSubject, setSelSubject] = useState("");
  const [selDate, setSelDate] = useState(new Date());
  const [selDateInput, setSelDateInput] = useState(() =>
    format(new Date(), "dd.MM.yyyy"),
  );
  const [selTime, setSelTime] = useState("10:00");
  const [selSendStatus, setSelSendStatus] = useState(null);
  const [selTestEmail, setSelTestEmail] = useState("");
  const [selTestStatus, setSelTestStatus] = useState(null);

  // Resolve the active date range (ISO strings) from preset / custom inputs.
  function signerDateRange() {
    const now = Date.now();
    if (signerDatePreset === "24h")
      return { from: new Date(now - 24 * 3600e3).toISOString(), to: null };
    if (signerDatePreset === "7d")
      return { from: new Date(now - 7 * 24 * 3600e3).toISOString(), to: null };
    if (signerDatePreset === "custom") {
      const from = signerDateFrom
        ? new Date(signerDateFrom + "T00:00:00").toISOString()
        : null;
      const to = signerDateTo
        ? new Date(signerDateTo + "T23:59:59").toISOString()
        : null;
      return { from, to };
    }
    return { from: null, to: null };
  }

  function signerQuery(extra = {}) {
    const { from, to } = signerDateRange();
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
    const raw = e.target.value;
    setSelDateInput(raw);
    if (raw.length === 10) {
      const parsed = parse(raw, "dd.MM.yyyy", new Date());
      if (isValid(parsed)) setSelDate(parsed);
    }
  }

  function handleDateInput(e) {
    const raw = e.target.value;
    setDateInput(raw);
    if (raw.length === 10) {
      const parsed = parse(raw, "dd.MM.yyyy", new Date());
      if (isValid(parsed)) setSelectedDate(parsed);
    }
  }

  const api = useCallback(
    async (path, options = {}) => {
      const res = await fetch(path, {
        ...options,
        headers: {
          ...authHeaders(token),
          ...(options.headers || {}),
        },
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
      }
      return res;
    },
    [token],
  );

  const loadAll = useCallback(async () => {
    if (!token) return;
    const [
      templateRes,
      campaignRes,
      statsRes,
      stateRes,
      outlierRes,
      unresolvedRes,
      occOutlierRes,
      milestonesRes,
    ] = await Promise.all([
      api("/api/admin/templates"),
      api("/api/admin/campaigns"),
      api("/api/admin/stats"),
      api("/api/admin/state-resolution-status"),
      api("/api/admin/kv-outliers"),
      api("/api/admin/unresolved-kvs"),
      api("/api/admin/occupation-outliers"),
      api("/api/admin/milestones"),
    ]);
    if (templateRes.ok) {
      const data = await templateRes.json();
      setTemplates(data);
      setSelectedId((current) => current || data[0]?.id || null);
      setScheduleTemplate((t) => t || (data[0] ? String(data[0].id) : ""));
      setScheduleSubject((s) => s || (data[0] ? data[0].subject : ""));
    }
    if (campaignRes.ok) setCampaigns(await campaignRes.json());
    if (statsRes.ok) setStats(await statsRes.json());
    if (stateRes.ok) setStateResolution(await stateRes.json());
    if (outlierRes.ok) setOutlierGroups(await outlierRes.json());
    if (unresolvedRes.ok) setUnresolvedKvs(await unresolvedRes.json());
    if (occOutlierRes.ok) setOccOutlierGroups(await occOutlierRes.json());
    if (milestonesRes.ok) {
      const { milestones } = await milestonesRes.json();
      setMilestonesInput((milestones || []).join(", "));
    }
  }, [api, token]);

  const reloadCampaigns = useCallback(async () => {
    const [campaignRes, statsRes] = await Promise.all([
      api("/api/admin/campaigns"),
      api("/api/admin/stats"),
    ]);
    if (campaignRes.ok) setCampaigns(await campaignRes.json());
    if (statsRes.ok) setStats(await statsRes.json());
  }, [api]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedId || !token) return;
    api(`/api/admin/templates/${selectedId}`).then(async (res) => {
      if (res.ok) setSelectedTemplate(await res.json());
    });
  }, [api, selectedId, token]);

  const loadSigners = useCallback(async () => {
    if (!token) return;
    setSignerLoading(true);
    const qs = signerQuery({
      limit: String(SIGNER_PAGE_SIZE),
      offset: String(signerPage * SIGNER_PAGE_SIZE),
    });
    const res = await api(`/api/admin/newsletter-signers?${qs}`);
    if (res.ok) {
      const data = await res.json();
      setSignerRows(data.signers || []);
      setSignerTotal(data.total || 0);
    }
    setSignerLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    token,
    signerPage,
    signerSearch,
    signerStateFilter,
    signerKvFilter,
    signerDatePreset,
    signerDateFrom,
    signerDateTo,
  ]);

  // Debounced fetch when the signers tab is active or its filters change.
  useEffect(() => {
    if (tab !== "signers" || !token) return;
    const t = setTimeout(loadSigners, 250);
    return () => clearTimeout(t);
  }, [tab, token, loadSigners]);

  // Load filter dropdown options once when entering the signers tab.
  useEffect(() => {
    if (tab !== "signers" || !token) return;
    api("/api/admin/newsletter-signer-filters").then(async (res) => {
      if (res.ok) setSignerFilterOpts(await res.json());
    });
  }, [api, tab, token]);

  // Seed the selection send form's template/subject from loaded templates.
  useEffect(() => {
    if (!selTemplate && templates[0]) {
      setSelTemplate(String(templates[0].id));
      setSelSubject(templates[0].subject);
    }
  }, [templates, selTemplate]);

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

  useEffect(() => {
    if (tab !== "zoom" || !token) return;
    api("/api/admin/zoom-registrations").then(async (res) => {
      if (res.ok) setZoomRegs(await res.json());
    });
    api("/api/admin/zoom-mailings").then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        setZoomMailings(data);
        setZoomEventAtInput(isoToLocalInput(data.eventAt));
        setZoomLinkInput(data.link || "");
        setZoomLinkOffset(data.linkOffsetHours ?? 24);
        setZoomReminderOffset(data.reminderOffsetHours ?? 2);
        setZoomShowDelegierter(Boolean(data.showDelegierter));
        setZoomMode(data.mode === "inperson" ? "inperson" : "online");
        setZoomLocationName(data.location?.name || "");
        setZoomLocationAddress(data.location?.address || "");
        setZoomLocationMapsUrl(data.location?.mapsUrl || "");
        setZoomEventLabel(data.eventLabelFallback || "");
        setZoomNavLabel(data.navLabel || "");
      }
    });
  }, [api, tab, token]);

  async function login(e) {
    e.preventDefault();
    setLoginError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginError("Anmeldung fehlgeschlagen.");
      return;
    }
    const { token: newToken } = await res.json();
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setPassword("");
    // Bootstrap data immediately with the fresh token — don't wait for the hook chain
    const h = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${newToken}`,
    };
    const [tRes, cRes, sRes] = await Promise.all([
      fetch("/api/admin/templates", { headers: h }),
      fetch("/api/admin/campaigns", { headers: h }),
      fetch("/api/admin/stats", { headers: h }),
    ]);
    if (tRes.ok) {
      const data = await tRes.json();
      setTemplates(data);
      setSelectedId(data[0]?.id || null);
      if (data[0]) {
        setScheduleTemplate(String(data[0].id));
        setScheduleSubject(data[0].subject);
      }
    }
    if (cRes.ok) setCampaigns(await cRes.json());
    if (sRes.ok) setStats(await sRes.json());
  }

  async function createTemplate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await api("/api/admin/templates", {
      method: "POST",
      body: JSON.stringify({
        name: newName,
        subject: "Neuer Newsletter",
        html_body: "<h2>Neue Nachricht</h2><p>Hallo {{name}},</p><p>...</p>",
      }),
    });
    if (res.ok) {
      const created = await res.json();
      setNewName("");
      setTemplates((prev) => [created, ...prev]);
      setSelectedId(created.id);
    }
  }

  async function deleteTemplate(id) {
    if (!window.confirm("Diese Vorlage löschen?")) return;
    const res = await api(`/api/admin/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates((prev) => prev.filter((template) => template.id !== id));
      setSelectedId(
        templates.find((template) => template.id !== id)?.id || null,
      );
    }
  }

  async function scheduleCampaign(e) {
    e.preventDefault();
    if (!scheduleTemplate || !selectedDate) return;
    const [hour, minute] = selectedTime.split(":").map(Number);
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(hour || 0, minute || 0, 0, 0);

    const res = await api("/api/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({
        template_id: scheduleTemplate,
        subject: scheduleSubject,
        scheduled_at: scheduledAt.toISOString(),
        audience,
      }),
    });
    if (res.ok) reloadCampaigns();
  }

  async function sendNow(e) {
    e.preventDefault();
    if (!scheduleTemplate) return;
    if (
      !window.confirm(
        `Jetzt an „${AUDIENCE_LABELS[audience]}" (${audienceCount.toLocaleString(
          "de-DE",
        )} Empfänger*innen) senden?`,
      )
    )
      return;
    const res = await api("/api/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({
        template_id: scheduleTemplate,
        subject: scheduleSubject,
        scheduled_at: new Date().toISOString(),
        audience,
      }),
    });
    if (res.ok) reloadCampaigns();
  }

  async function sendTest(e) {
    e.preventDefault();
    if (!scheduleTemplate || !testEmail) return;
    setTestStatus("sending");
    const res = await api("/api/admin/test-send", {
      method: "POST",
      body: JSON.stringify({
        template_id: scheduleTemplate,
        subject: scheduleSubject,
        to: testEmail,
        audience,
      }),
    });
    if (res.ok) {
      setTestStatus("ok");
      setTimeout(() => setTestStatus(null), 4000);
    } else {
      const data = await res.json().catch(() => ({}));
      setTestStatus(data.error || "Fehler beim Senden");
    }
  }

  async function cancel(id) {
    const res = await api(`/api/admin/campaigns/${id}`, { method: "DELETE" });
    if (res.ok) reloadCampaigns();
  }

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
    const res = await api(`/api/admin/newsletter-signer-ids?${signerQuery()}`);
    if (res.ok) {
      const data = await res.json();
      setSelectedSignerIds(new Set(data.ids || []));
    }
  }

  function clearSelection() {
    setSelectedSignerIds(new Set());
  }

  async function submitSelectionCampaign(scheduledAt) {
    if (!selTemplate || selectedSignerIds.size === 0) return;
    const res = await api("/api/admin/campaigns", {
      method: "POST",
      body: JSON.stringify({
        template_id: selTemplate,
        subject: selSubject,
        scheduled_at: scheduledAt.toISOString(),
        audience: "selection",
        recipient_ids: [...selectedSignerIds],
      }),
    });
    if (res.ok) {
      reloadCampaigns();
      setSelSendStatus("ok");
      setTimeout(() => setSelSendStatus(null), 4000);
      return true;
    }
    const data = await res.json().catch(() => ({}));
    setSelSendStatus(data.error || "Fehler beim Senden");
    return false;
  }

  async function sendSelectionNow() {
    if (
      !window.confirm(
        `Jetzt an ${selectedSignerIds.size.toLocaleString("de-DE")} ausgewählte Empfänger*innen senden?`,
      )
    )
      return;
    await submitSelectionCampaign(new Date());
  }

  function scheduleSelection(e) {
    e.preventDefault();
    if (!selDate) return;
    const [hour, minute] = selTime.split(":").map(Number);
    const when = new Date(selDate);
    when.setHours(hour || 0, minute || 0, 0, 0);
    submitSelectionCampaign(when);
  }

  async function sendSelectionTest() {
    if (!selTemplate || !selTestEmail) return;
    setSelTestStatus("sending");
    const res = await api("/api/admin/test-send", {
      method: "POST",
      body: JSON.stringify({
        template_id: selTemplate,
        subject: selSubject,
        to: selTestEmail,
        audience: "newsletter",
      }),
    });
    if (res.ok) {
      setSelTestStatus("ok");
      setTimeout(() => setSelTestStatus(null), 4000);
    } else {
      const data = await res.json().catch(() => ({}));
      setSelTestStatus(data.error || "Fehler beim Senden");
    }
  }

  async function saveZoomSettings(e) {
    e.preventDefault();
    if (!zoomEventAtInput) return;
    setZoomSettingsStatus("saving");
    const res = await api("/api/admin/zoom-settings", {
      method: "POST",
      body: JSON.stringify({
        eventAt: new Date(zoomEventAtInput).toISOString(),
        zoomLink: zoomLinkInput,
        linkOffsetHours: Number(zoomLinkOffset),
        reminderOffsetHours: Number(zoomReminderOffset),
        showDelegierter: zoomShowDelegierter,
        mode: zoomMode,
        locationName: zoomLocationName,
        locationAddress: zoomLocationAddress,
        locationMapsUrl: zoomLocationMapsUrl,
        eventLabel: zoomEventLabel,
        navLabel: zoomNavLabel,
      }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setZoomSettingsStatus(data.mailingsReset ? "ok-reset" : "ok");
      // reload status panel
      api("/api/admin/zoom-mailings").then(async (r) => {
        if (r.ok) setZoomMailings(await r.json());
      });
      setTimeout(() => setZoomSettingsStatus(null), 5000);
    } else {
      const data = await res.json().catch(() => ({}));
      setZoomSettingsStatus(data.error || "Fehler beim Speichern");
    }
  }

  async function saveMilestones(e) {
    e.preventDefault();
    const parsed = milestonesInput
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number);
    if (parsed.some((n) => !Number.isFinite(n) || n <= 0)) {
      setMilestonesStatus("Nur positive Zahlen, mit Komma getrennt.");
      return;
    }
    setMilestonesStatus("saving");
    const res = await api("/api/admin/milestones", {
      method: "POST",
      body: JSON.stringify({ milestones: parsed }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMilestonesInput((data.milestones || []).join(", "));
      setMilestonesStatus("ok");
      setTimeout(() => setMilestonesStatus(null), 5000);
    } else {
      setMilestonesStatus(data.error || "Fehler beim Speichern");
    }
  }

  async function sendZoomTest(kind) {
    if (!zoomTestEmail) return;
    setZoomTestStatus("sending");
    const res = await api("/api/admin/zoom-test-send", {
      method: "POST",
      body: JSON.stringify({ to: zoomTestEmail, kind }),
    });
    if (res.ok) {
      setZoomTestStatus("ok");
      setTimeout(() => setZoomTestStatus(null), 4000);
    } else {
      const data = await res.json().catch(() => ({}));
      setZoomTestStatus(data.error || "Fehler beim Senden");
    }
  }

  async function clearZoomRegs() {
    if (
      !confirm(
        `Wirklich ALLE ${zoomRegs.length} Zoom-Anmeldungen unwiderruflich löschen? ` +
          "Nutze das, um den Zoom für eine neue Runde (z. B. Auswertungszoom) freizuräumen.",
      )
    )
      return;
    setZoomClearStatus("clearing");
    const res = await api("/api/admin/zoom-registrations/clear", {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setZoomRegs([]);
      setZoomClearStatus(`ok:${data.removed ?? 0}`);
      setTimeout(() => setZoomClearStatus(null), 5000);
    } else {
      const data = await res.json().catch(() => ({}));
      setZoomClearStatus(data.error || "Fehler beim Löschen");
    }
  }

  function logout() {
    if (!confirm("Wirklich abmelden?")) return;
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
  }

  const audienceCount =
    audience === "zoom"
      ? stats.zoomCount
      : audience === "zoom_delegates"
        ? stats.zoomDelegateCount
        : audience === "email_not_zoom"
          ? stats.newsletterNotZoomCount
          : stats.subscriberCount;

  if (!token) {
    return (
      <main className="admin-shell login-shell">
        <form className="form-card admin-login" onSubmit={login}>
          <span className="badge">Admin</span>
          <h1>Verwaltung</h1>
          <p className="sub2">
            Passwort eingeben, Sitzung bleibt nur in diesem Tab aktiv.
          </p>
          <div className="field">
            <label>Passwort</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {loginError && <p className="error">{loginError}</p>}
          <button className="cta" type="submit">
            Anmelden
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar admin-topbar">
        <div className="wordmark">
          <span className="dot" />
          Verwaltung
        </div>
        <nav aria-label="Admin Bereiche">
          <button
            className={tab === "templates" ? "active" : ""}
            aria-current={tab === "templates" ? "page" : undefined}
            onClick={() => setTab("templates")}
          >
            Vorlagen
          </button>
          <button
            className={tab === "campaigns" ? "active" : ""}
            aria-current={tab === "campaigns" ? "page" : undefined}
            onClick={() => setTab("campaigns")}
          >
            Versand
          </button>
          <button
            className={tab === "signers" ? "active" : ""}
            aria-current={tab === "signers" ? "page" : undefined}
            onClick={() => setTab("signers")}
          >
            Unterzeichner
          </button>
          <button
            className={tab === "zoom" ? "active" : ""}
            aria-current={tab === "zoom" ? "page" : undefined}
            onClick={() => setTab("zoom")}
          >
            Zoom
          </button>
          <button
            className={tab === "settings" ? "active" : ""}
            aria-current={tab === "settings" ? "page" : undefined}
            onClick={() => setTab("settings")}
          >
            Einstellungen
          </button>
        </nav>
      </header>

      {tab === "templates" && (
        <section className="section">
          <div className="section-inner admin-layout">
            <aside className="admin-sidebar">
              <form className="admin-card" onSubmit={createTemplate}>
                <label>Neue Newsletter-Vorlage</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                />
                <button className="cta" type="submit">
                  Anlegen
                </button>
              </form>

              <div className="admin-list">
                {templates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className={template.id === selectedId ? "active" : ""}
                    onClick={() => setSelectedId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.system ? "System" : template.slug}</span>
                  </button>
                ))}
              </div>
            </aside>

            <TemplateEditor
              token={token}
              template={selectedTemplate}
              onSaved={(updated) => {
                setSelectedTemplate(updated);
                setTemplates((prev) =>
                  prev.map((template) =>
                    template.id === updated.id
                      ? { ...template, ...updated }
                      : template,
                  ),
                );
              }}
              onDeleted={deleteTemplate}
            />
          </div>
        </section>
      )}

      {tab === "campaigns" && (
        <section className="section">
          <div className="section-inner admin-campaigns">
            <form
              className="admin-card campaign-form"
              onSubmit={scheduleCampaign}
            >
              <div className="admin-card-title">Versand planen</div>
              <div className="field">
                <label>Empfängergruppe</label>
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                >
                  <option value="newsletter">Newsletter-Unterschreiber</option>
                  <option value="email_not_zoom">Newsletter ohne Zoom</option>
                  <option value="zoom">Zoom-Anmelder (alle)</option>
                  {zoomShowDelegierter && (
                    <option value="zoom_delegates">Nur Delegierte (Zoom)</option>
                  )}
                </select>
              </div>
              <div className="field">
                <label>Vorlage</label>
                <select
                  value={scheduleTemplate}
                  onChange={(e) => {
                    setScheduleTemplate(e.target.value);
                    const template = templates.find(
                      (item) => String(item.id) === e.target.value,
                    );
                    if (template) setScheduleSubject(template.subject);
                  }}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Betreff</label>
                <input
                  value={scheduleSubject}
                  onChange={(e) => setScheduleSubject(e.target.value)}
                />
              </div>
              <div className="admin-picker-wrapper">
                <div className="admin-date-row">
                  <div className="field">
                    <label>Datum</label>
                    <input
                      type="text"
                      value={dateInput}
                      onChange={handleDateInput}
                      placeholder="TT.MM.JJJJ"
                      maxLength={10}
                    />
                  </div>
                  <div className="field">
                    <label>Uhrzeit</label>
                    <input
                      type="time"
                      value={selectedTime}
                      onChange={(e) => setSelectedTime(e.target.value)}
                      lang="de"
                    />
                  </div>
                </div>
                <DayPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date);
                      setDateInput(format(date, "dd.MM.yyyy"));
                    }
                  }}
                  locale={de}
                />
                <p className="admin-muted">
                  {selectedDate
                    ? format(selectedDate, "PPPP", { locale: de })
                    : ""}
                </p>
              </div>
              <div className="admin-actions">
                <button className="cta" type="submit">
                  Termin speichern
                </button>
                <button className="cta" type="button" onClick={sendNow}>
                  Jetzt senden
                </button>
              </div>
              <p className="admin-muted">
                Empfänger*innen ({AUDIENCE_LABELS[audience]}):{" "}
                {audienceCount.toLocaleString("de-DE")}
              </p>

              <div className="admin-test-send">
                <div className="field">
                  <label>Testversand an</label>
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="test@beispiel.de"
                  />
                </div>
                <button
                  className="cta cta--outline"
                  type="button"
                  onClick={sendTest}
                  disabled={!testEmail || testStatus === "sending"}
                >
                  {testStatus === "sending"
                    ? "Wird gesendet\u2026"
                    : "Test senden"}
                </button>
                {testStatus === "ok" && (
                  <p className="admin-test-feedback admin-test-ok">
                    E-Mail gesendet
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
              <div className="admin-card-title">Kampagnen</div>
              {campaigns.length === 0 && (
                <p className="admin-muted">Noch keine Kampagnen geplant.</p>
              )}
              {campaigns.map((campaign) => (
                <div className="campaign-row" key={campaign.id}>
                  <div>
                    <strong>{campaign.subject}</strong>
                    <span>
                      {campaign.template_name || "Vorlage gelöscht"} ·{" "}
                      {AUDIENCE_LABELS[campaign.audience] || "Newsletter"}
                    </span>
                    <small>
                      {new Date(campaign.scheduled_at).toLocaleString("de-DE", {
                        hour12: false,
                      })}
                    </small>
                  </div>
                  <StatusBadge status={campaign.status} />
                  {campaign.status === "failed" && campaign.sent_offset > 0 && (
                    <small style={{ color: "#b45309" }}>
                      {campaign.sent_offset} gesendet — wird fortgesetzt
                    </small>
                  )}
                  {campaign.status === "scheduled" && (
                    <button type="button" onClick={() => cancel(campaign.id)}>
                      Absagen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === "signers" && (
        <section className="section">
          <div className="section-inner">
            <div className="admin-card" style={{ marginBottom: 16 }}>
              <div className="admin-card-title">Filter</div>
              <div className="signer-filter-bar">
                <div className="field">
                  <label>Suche (Name, E-Mail, Kreisverband)</label>
                  <input
                    value={signerSearch}
                    onChange={(e) => setSignerSearch(e.target.value)}
                    placeholder="Suchen…"
                  />
                </div>
                <div className="field">
                  <label>Bundesland</label>
                  <select
                    value={signerStateFilter}
                    onChange={(e) => setSignerStateFilter(e.target.value)}
                  >
                    <option value="">Alle</option>
                    {signerFilterOpts.states.map((s) => (
                      <option key={s.state} value={s.state}>
                        {s.state} ({s.count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Kreisverband</label>
                  <select
                    value={signerKvFilter}
                    onChange={(e) => setSignerKvFilter(e.target.value)}
                  >
                    <option value="">Alle</option>
                    {signerFilterOpts.kvs.map((k) => (
                      <option key={k.kreisverband} value={k.kreisverband}>
                        {k.kreisverband} ({k.count})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Zeitraum</label>
                  <select
                    value={signerDatePreset}
                    onChange={(e) => setSignerDatePreset(e.target.value)}
                  >
                    <option value="alle">Alle</option>
                    <option value="24h">Letzte 24 Stunden</option>
                    <option value="7d">Letzte 7 Tage</option>
                    <option value="custom">Benutzerdefiniert</option>
                  </select>
                </div>
                {signerDatePreset === "custom" && (
                  <>
                    <div className="field">
                      <label>Von</label>
                      <input
                        type="date"
                        value={signerDateFrom}
                        onChange={(e) => setSignerDateFrom(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>Bis</label>
                      <input
                        type="date"
                        value={signerDateTo}
                        onChange={(e) => setSignerDateTo(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="admin-signers-layout">
              <div className="admin-card">
                <div className="admin-card-title">
                  {signerTotal.toLocaleString("de-DE")} gefiltert &middot;{" "}
                  {selectedSignerIds.size.toLocaleString("de-DE")} ausgewählt
                </div>
                <div className="signer-selection-actions">
                  <button
                    type="button"
                    onClick={selectAllMatching}
                    disabled={signerTotal === 0}
                  >
                    Alle {signerTotal.toLocaleString("de-DE")} auswählen
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    disabled={selectedSignerIds.size === 0}
                  >
                    Auswahl aufheben
                  </button>
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label="Seite auswählen"
                            checked={
                              signerRows.length > 0 &&
                              signerRows.every((r) =>
                                selectedSignerIds.has(r.id),
                              )
                            }
                            onChange={(e) => toggleCurrentPage(e.target.checked)}
                          />
                        </th>
                        <th>Name</th>
                        <th>E-Mail</th>
                        <th>Kreisverband</th>
                        <th>Bundesland</th>
                        <th>Tätigkeit</th>
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
                            <input
                              type="checkbox"
                              aria-label={`${r.name} auswählen`}
                              checked={selectedSignerIds.has(r.id)}
                              onChange={() => toggleSigner(r.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td>{r.name}</td>
                          <td>{r.email}</td>
                          <td>{r.kreisverband || "—"}</td>
                          <td>{r.state || "—"}</td>
                          <td>{r.occupation || "—"}</td>
                          <td>
                            {new Date(r.created_at).toLocaleDateString("de-DE")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {signerLoading && <p className="admin-muted">Lädt…</p>}
                {!signerLoading && signerRows.length === 0 && (
                  <p className="admin-muted">Keine Unterzeichner gefunden.</p>
                )}
                <div className="signer-pagination">
                  <button
                    type="button"
                    disabled={signerPage === 0}
                    onClick={() => setSignerPage((p) => Math.max(0, p - 1))}
                  >
                    Zurück
                  </button>
                  <span className="admin-muted">
                    Seite {signerPage + 1} /{" "}
                    {Math.max(1, Math.ceil(signerTotal / SIGNER_PAGE_SIZE))}
                  </span>
                  <button
                    type="button"
                    disabled={
                      (signerPage + 1) * SIGNER_PAGE_SIZE >= signerTotal
                    }
                    onClick={() => setSignerPage((p) => p + 1)}
                  >
                    Weiter
                  </button>
                </div>
              </div>

              <form
                className="admin-card campaign-form"
                onSubmit={scheduleSelection}
              >
                <div className="admin-card-title">An Auswahl senden</div>
                <p className="admin-muted">
                  {selectedSignerIds.size.toLocaleString("de-DE")}{" "}
                  Empfänger*innen ausgewählt
                </p>
                <div className="field">
                  <label>Vorlage</label>
                  <select
                    value={selTemplate}
                    onChange={(e) => {
                      setSelTemplate(e.target.value);
                      const t = templates.find(
                        (x) => String(x.id) === e.target.value,
                      );
                      if (t) setSelSubject(t.subject);
                    }}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Betreff</label>
                  <input
                    value={selSubject}
                    onChange={(e) => setSelSubject(e.target.value)}
                  />
                </div>
                <div className="admin-picker-wrapper">
                  <div className="admin-date-row">
                    <div className="field">
                      <label>Datum</label>
                      <input
                        type="text"
                        value={selDateInput}
                        onChange={handleSelDateInput}
                        placeholder="TT.MM.JJJJ"
                        maxLength={10}
                      />
                    </div>
                    <div className="field">
                      <label>Uhrzeit</label>
                      <input
                        type="time"
                        value={selTime}
                        onChange={(e) => setSelTime(e.target.value)}
                        lang="de"
                      />
                    </div>
                  </div>
                  <DayPicker
                    mode="single"
                    selected={selDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelDate(date);
                        setSelDateInput(format(date, "dd.MM.yyyy"));
                      }
                    }}
                    locale={de}
                  />
                </div>
                <div className="admin-actions">
                  <button
                    className="cta"
                    type="submit"
                    disabled={!selTemplate || selectedSignerIds.size === 0}
                  >
                    Planen
                  </button>
                  <button
                    className="cta"
                    type="button"
                    onClick={sendSelectionNow}
                    disabled={!selTemplate || selectedSignerIds.size === 0}
                  >
                    Jetzt senden
                  </button>
                </div>
                {selSendStatus === "ok" && (
                  <p className="admin-test-feedback admin-test-ok">
                    Kampagne erstellt
                  </p>
                )}
                {selSendStatus && selSendStatus !== "ok" && (
                  <p className="admin-test-feedback admin-test-error">
                    {selSendStatus}
                  </p>
                )}

                <div className="admin-test-send">
                  <div className="field">
                    <label>Testversand an</label>
                    <input
                      type="email"
                      value={selTestEmail}
                      onChange={(e) => setSelTestEmail(e.target.value)}
                      placeholder="test@beispiel.de"
                    />
                  </div>
                  <button
                    className="cta cta--outline"
                    type="button"
                    onClick={sendSelectionTest}
                    disabled={!selTestEmail || selTestStatus === "sending"}
                  >
                    {selTestStatus === "sending"
                      ? "Wird gesendet…"
                      : "Test senden"}
                  </button>
                  {selTestStatus === "ok" && (
                    <p className="admin-test-feedback admin-test-ok">
                      E-Mail gesendet
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
            <form
              className="admin-card"
              style={{ marginBottom: 20 }}
              onSubmit={saveZoomSettings}
            >
              <div className="admin-card-title">Termin & Versand-Timing</div>
              <div className="field">
                <label>Termin (Datum & Uhrzeit)</label>
                <input
                  type="datetime-local"
                  value={zoomEventAtInput}
                  onChange={(e) => setZoomEventAtInput(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Zoom-Link</label>
                <input
                  type="url"
                  value={zoomLinkInput}
                  onChange={(e) => setZoomLinkInput(e.target.value)}
                  placeholder="https://zoom.us/j/..."
                />
              </div>
              <div className="admin-date-row">
                <div className="field">
                  <label>Link-Mail: Stunden vor dem Termin</label>
                  <input
                    type="number"
                    min="0"
                    value={zoomLinkOffset}
                    onChange={(e) => setZoomLinkOffset(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Erinnerung: Stunden vor dem Termin</label>
                  <input
                    type="number"
                    min="0"
                    value={zoomReminderOffset}
                    onChange={(e) => setZoomReminderOffset(e.target.value)}
                  />
                </div>
              </div>
              <p className="admin-muted">
                Bei Änderung des Termins wird der Versand-Status zurückgesetzt,
                sodass Link-Mail und Erinnerung neu ausgelöst werden.
              </p>

              <div className="admin-card-title">Format & Anzeige</div>
              <div className="field">
                <label>Format des Treffens</label>
                <select
                  value={zoomMode}
                  onChange={(e) => setZoomMode(e.target.value)}
                >
                  <option value="online">Online (Videocall)</option>
                  <option value="inperson">Vor Ort (Präsenz)</option>
                </select>
              </div>
              {zoomMode === "inperson" && (
                <>
                  <div className="field">
                    <label>Ort – Name</label>
                    <input
                      type="text"
                      value={zoomLocationName}
                      onChange={(e) => setZoomLocationName(e.target.value)}
                      placeholder="z. B. Karl-Liebknecht-Haus"
                    />
                  </div>
                  <div className="field">
                    <label>Ort – Adresse</label>
                    <input
                      type="text"
                      value={zoomLocationAddress}
                      onChange={(e) => setZoomLocationAddress(e.target.value)}
                      placeholder="Straße, PLZ Ort"
                    />
                  </div>
                  <div className="field">
                    <label>Ort – Karten-Link (optional)</label>
                    <input
                      type="url"
                      value={zoomLocationMapsUrl}
                      onChange={(e) => setZoomLocationMapsUrl(e.target.value)}
                      placeholder="https://maps.google.com/..."
                    />
                  </div>
                </>
              )}
              <div className="admin-date-row">
                <div className="field">
                  <label>Titel/Label (wenn kein Termin gesetzt)</label>
                  <input
                    type="text"
                    value={zoomEventLabel}
                    onChange={(e) => setZoomEventLabel(e.target.value)}
                    placeholder="z. B. Termin folgt"
                  />
                </div>
                <div className="field">
                  <label>Label in Navigation & Button</label>
                  <input
                    type="text"
                    value={zoomNavLabel}
                    onChange={(e) => setZoomNavLabel(e.target.value)}
                    placeholder="z. B. Auswertungstreffen"
                  />
                </div>
              </div>
              <div className="field">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={zoomShowDelegierter}
                    onChange={(e) => setZoomShowDelegierter(e.target.checked)}
                  />
                  <span>Delegierte*r-Feld anzeigen</span>
                </label>
              </div>

              <p className="admin-muted">
                Einstellungen werden zusammen mit dem Termin gespeichert – bitte
                oben ein gültiges Datum setzen.
              </p>
              <div className="admin-actions">
                <button
                  className="cta"
                  type="submit"
                  disabled={
                    !zoomEventAtInput || zoomSettingsStatus === "saving"
                  }
                >
                  {zoomSettingsStatus === "saving"
                    ? "Wird gespeichert…"
                    : "Speichern"}
                </button>
              </div>
              {zoomSettingsStatus === "ok" && (
                <p className="admin-test-feedback admin-test-ok">Gespeichert</p>
              )}
              {zoomSettingsStatus === "ok-reset" && (
                <p className="admin-test-feedback admin-test-ok">
                  Gespeichert · Versand-Status zurückgesetzt
                </p>
              )}
              {zoomSettingsStatus &&
                !["ok", "ok-reset", "saving"].includes(zoomSettingsStatus) && (
                  <p className="admin-test-feedback admin-test-error">
                    {zoomSettingsStatus}
                  </p>
                )}
            </form>

            {zoomMailings && (
              <div className="admin-card" style={{ marginBottom: 20 }}>
                <div className="admin-card-title">Automatische E-Mails</div>
                <p className="admin-muted">
                  Termin: {zoomMailings.eventLabel} (
                  {new Date(zoomMailings.eventAt).toLocaleString("de-DE")}) ·
                  Zoom-Link{" "}
                  {zoomMailings.hasLink ? "gesetzt" : "fehlt noch (ZOOM_LINK)"}
                </p>
                <p>
                  <strong>Link-Mail (1 Tag vorher, mit .ics):</strong>{" "}
                  {zoomMailingStatus(zoomMailings.mailings, "link")}
                </p>
                <p>
                  <strong>Erinnerung (2 Std. vorher):</strong>{" "}
                  {zoomMailingStatus(zoomMailings.mailings, "reminder")}
                </p>
              </div>
            )}

            <div className="admin-card" style={{ marginBottom: 20 }}>
              <div className="admin-card-title">Test-Mails</div>
              <p className="admin-muted">
                Schickt die jeweilige Zoom-Mail an eine einzelne Adresse (ohne
                die echten Anmeldungen anzurühren).
              </p>
              <div className="field">
                <label>Test-Adresse</label>
                <input
                  type="email"
                  value={zoomTestEmail}
                  onChange={(e) => setZoomTestEmail(e.target.value)}
                  placeholder="test@beispiel.de"
                />
              </div>
              <div className="admin-actions">
                <button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => sendZoomTest("confirmation")}
                  disabled={!zoomTestEmail || zoomTestStatus === "sending"}
                >
                  Bestätigung testen
                </button>
                <button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => sendZoomTest("link")}
                  disabled={!zoomTestEmail || zoomTestStatus === "sending"}
                >
                  Link-Mail (.ics) testen
                </button>
                <button
                  type="button"
                  className="cta cta--outline"
                  onClick={() => sendZoomTest("reminder")}
                  disabled={!zoomTestEmail || zoomTestStatus === "sending"}
                >
                  Erinnerung testen
                </button>
              </div>
              {zoomTestStatus === "ok" && (
                <p className="admin-test-feedback admin-test-ok">
                  Test-Mail gesendet
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
                Zoom-Anmeldungen · {zoomRegs.length} gesamt
                {zoomShowDelegierter && (
                  <>
                    {" "}
                    · {zoomRegs.filter((r) => r.delegierter).length} Delegierte
                  </>
                )}
              </span>
              <button
                type="button"
                className="admin-danger"
                onClick={clearZoomRegs}
                disabled={
                  zoomRegs.length === 0 || zoomClearStatus === "clearing"
                }
              >
                {zoomClearStatus === "clearing"
                  ? "Wird gelöscht…"
                  : "Alle Zoom-Anmeldungen löschen"}
              </button>
            </div>
            {zoomClearStatus && zoomClearStatus.startsWith("ok:") && (
              <p className="admin-test-feedback admin-test-ok">
                {zoomClearStatus.slice(3)} Anmeldungen gelöscht. Der Zoom ist
                jetzt frei für eine neue Runde.
              </p>
            )}
            {zoomClearStatus &&
              zoomClearStatus !== "clearing" &&
              !zoomClearStatus.startsWith("ok:") && (
                <p className="admin-test-feedback admin-test-error">
                  {zoomClearStatus}
                </p>
              )}
            {zoomRegs.length === 0 ? (
              <p>Noch keine Anmeldungen.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Kreisverband</th>
                      {zoomShowDelegierter && <th>Delegierte*r</th>}
                      <th>E-Mail</th>
                      <th>Angemeldet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zoomRegs.map((r) => (
                      <tr key={r.email}>
                        <td>{r.name}</td>
                        <td>{r.kreisverband || "—"}</td>
                        {zoomShowDelegierter && (
                          <td>{r.delegierter ? "Ja" : "—"}</td>
                        )}
                        <td>{r.email}</td>
                        <td>
                          {new Date(r.created_at).toLocaleString("de-DE", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="section">
          <div className="section-inner settings-grid">
            <div className="admin-card stat-card">
              <span>Mitzeichner*innen</span>
              <strong>{stats.signerCount.toLocaleString("de-DE")}</strong>
            </div>
            <div className="admin-card stat-card">
              <span>Newsletter</span>
              <strong>{stats.subscriberCount.toLocaleString("de-DE")}</strong>
            </div>
            <form
              className="admin-card"
              style={{ gridColumn: "1 / -1" }}
              onSubmit={saveMilestones}
            >
              <div className="admin-card-title">Meilensteine (Ziel)</div>
              <p className="admin-muted" style={{ marginBottom: 8 }}>
                Kommagetrennte Zielmarken für den Fortschrittsbalken. Die nächste
                Marke oberhalb der aktuellen Unterschriftenzahl ist das Ziel.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={milestonesInput}
                  onChange={(e) => setMilestonesInput(e.target.value)}
                  placeholder="1000, 1300, 1600, 2000"
                  style={{ flex: 1, minWidth: 220 }}
                  aria-label="Meilensteine, kommagetrennt"
                />
                <button type="submit" disabled={milestonesStatus === "saving"}>
                  {milestonesStatus === "saving" ? "Speichern…" : "Speichern"}
                </button>
              </div>
              {milestonesStatus === "ok" && (
                <p className="admin-test-feedback admin-test-ok">Gespeichert</p>
              )}
              {milestonesStatus &&
                !["ok", "saving"].includes(milestonesStatus) && (
                  <p className="admin-test-feedback admin-test-error">
                    {milestonesStatus}
                  </p>
                )}
            </form>

            <div className="admin-card" style={{ gridColumn: "1 / -1" }}>
              <div className="admin-card-title">Bundesland-Zuordnung</div>
              {stateResolution && (
                <div className="state-resolution-stats">
                  <p>
                    <strong>{stateResolution.resolvedKvs}</strong> Kreisverbände
                    zugeordnet, <strong>{stateResolution.unresolvedKvs}</strong>{" "}
                    offen
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
                    Offene Kreisverbände:
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
                        <select
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
                        </select>
                        <button
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
                              /* ignore */
                            }
                            setAssigningKv(null);
                          }}
                        >
                          {assigningKv === kv.kreisverband ? "…" : "Zuordnen"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="admin-actions">
                <button
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
                </button>
                <button
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
                        setResolveMessage("Fehler bei der erneuten Zuordnung.");
                      }
                    } catch {
                      setResolveMessage("Fehler bei der erneuten Zuordnung.");
                    }
                    setResolving(false);
                  }}
                >
                  {resolving ? "Wird gestartet…" : "Alle erneut prüfen"}
                </button>
              </div>
              {resolveMessage && (
                <p className="admin-muted">{resolveMessage}</p>
              )}
            </div>
            {outlierGroups.length > 0 && (
              <div className="admin-card" style={{ gridColumn: "1 / -1" }}>
                <div className="admin-card-title">
                  KV-Tippfehler (
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
                            <button
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
                                  /* ignore */
                                }
                                setMerging(null);
                              }}
                            >
                              {merging === outlier.name
                                ? "…"
                                : `→ ${group.canonical.name}`}
                            </button>
                            <button
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
                                  /* ignore */
                                }
                                setMerging(null);
                              }}
                            >
                              {merging === outlier.name
                                ? "…"
                                : `→ ${outlier.name}`}
                            </button>
                            <button
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
                                  /* ignore */
                                }
                                setMerging(null);
                              }}
                            >
                              Stimmt so
                            </button>
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
                            <button
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
                                  /* ignore */
                                }
                                setOccMerging(null);
                              }}
                            >
                              {occMerging === outlier.name
                                ? "…"
                                : `→ ${group.canonical.name}`}
                            </button>
                            <button
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
                                  /* ignore */
                                }
                                setOccMerging(null);
                              }}
                            >
                              {occMerging === outlier.name
                                ? "…"
                                : `→ ${outlier.name}`}
                            </button>
                            <button
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
                                  /* ignore */
                                }
                                setOccMerging(null);
                              }}
                            >
                              Stimmt so
                            </button>
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
              <button className="admin-danger" type="button" onClick={logout}>
                Abmelden
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
