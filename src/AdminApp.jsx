import { useCallback, useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { Mark, mergeAttributes, markInputRule, markPasteRule } from "@tiptap/core";

const TOKEN_KEY = "gehaltsdeckel_admin_token";
const variables = ["name", "confirmUrl", "deleteUrl", "signerCount", "unsubscribeUrl"];

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
  const [message, setMessage] = useState("");

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
    onUpdate({ editor }) {
      setHtmlBody(editor.getHTML());
    },
  });

  useEffect(() => {
    setSubject(template?.subject || "");
    setHtmlBody(template?.html_body || "");
    setMessage("");
    editor?.commands.setContent(template?.html_body || "", false);
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
    const href = window.prompt("Link URL", previous);
    if (href === null) return;
    if (!href) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }, [editor]);

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch(`/api/admin/templates/${template.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ subject, html_body: htmlBody }),
    });
    setSaving(false);
    if (!res.ok) {
      setMessage("Speichern fehlgeschlagen.");
      return;
    }
    const updated = await res.json();
    setMessage("Gespeichert.");
    onSaved(updated);
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
          <ToolbarButton title="Fett" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>B</ToolbarButton>
          <ToolbarButton title="Kursiv" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</ToolbarButton>
          <ToolbarButton title="Unterstrichen" active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()}>U</ToolbarButton>
          <ToolbarButton title="Durchgestrichen" active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()}>S</ToolbarButton>
          <ToolbarButton title="H2" active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
          <ToolbarButton title="H3" active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
          <ToolbarButton title="Liste" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
          <ToolbarButton title="Nummerierte Liste" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
          <ToolbarButton title="Zitat" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>”</ToolbarButton>
          <ToolbarButton title="Link" active={editor?.isActive("link")} onClick={setLink}>↗</ToolbarButton>
          <ToolbarButton title="Trennlinie" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>—</ToolbarButton>
          <ToolbarButton title="Rückgängig" onClick={() => editor?.chain().focus().undo().run()}>↶</ToolbarButton>
          <ToolbarButton title="Wiederholen" onClick={() => editor?.chain().focus().redo().run()}>↷</ToolbarButton>
        </div>

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
          <button type="button" className="cta" onClick={save} disabled={saving}>
            {saving ? "Speichert ..." : "Speichern"}
          </button>
          {!template.system && (
            <button type="button" className="admin-danger" onClick={() => onDeleted(template.id)}>
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
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState("templates");
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState({ signerCount: 0, subscriberCount: 0 });
  const [newName, setNewName] = useState("");
  const [scheduleTemplate, setScheduleTemplate] = useState("");
  const [scheduleSubject, setScheduleSubject] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTime, setSelectedTime] = useState("10:00");

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
        sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
      }
      return res;
    },
    [token],
  );

  const loadAll = useCallback(async () => {
    if (!token) return;
    const [templateRes, campaignRes, statsRes] = await Promise.all([
      api("/api/admin/templates"),
      api("/api/admin/campaigns"),
      api("/api/admin/stats"),
    ]);
    if (templateRes.ok) {
      const data = await templateRes.json();
      setTemplates(data);
      setSelectedId((current) => current || data[0]?.id || null);
      if (!scheduleTemplate && data[0]) {
        setScheduleTemplate(String(data[0].id));
        setScheduleSubject(data[0].subject);
      }
    }
    if (campaignRes.ok) setCampaigns(await campaignRes.json());
    if (statsRes.ok) setStats(await statsRes.json());
  }, [api, token, scheduleTemplate]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedId || !token) return;
    api(`/api/admin/templates/${selectedId}`).then(async (res) => {
      if (res.ok) setSelectedTemplate(await res.json());
    });
  }, [api, selectedId, token]);

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
    const data = await res.json();
    sessionStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setPassword("");
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
      setSelectedId(templates.find((template) => template.id !== id)?.id || null);
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
      }),
    });
    if (res.ok) loadAll();
  }

  async function cancel(id) {
    const res = await api(`/api/admin/campaigns/${id}`, { method: "DELETE" });
    if (res.ok) loadAll();
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
  }

  const selectedTemplateSummary = useMemo(
    () => templates.find((template) => String(template.id) === scheduleTemplate),
    [templates, scheduleTemplate],
  );

  if (!token) {
    return (
      <main className="admin-shell login-shell">
        <form className="form-card admin-login" onSubmit={login}>
          <span className="badge">Admin</span>
          <h1>Verwaltung</h1>
          <p className="sub2">Passwort eingeben, Sitzung bleibt nur in diesem Tab aktiv.</p>
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
          <button className="cta" type="submit">Anmelden</button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="topbar admin-topbar">
        <div className="wordmark"><span className="dot" />Verwaltung</div>
        <nav aria-label="Admin Bereiche">
          <button className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}>Vorlagen</button>
          <button className={tab === "campaigns" ? "active" : ""} onClick={() => setTab("campaigns")}>Versand</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Einstellungen</button>
        </nav>
      </header>

      {tab === "templates" && (
        <section className="section">
          <div className="section-inner admin-layout">
            <aside className="admin-sidebar">
              <form className="admin-card" onSubmit={createTemplate}>
                <label>Neue Newsletter-Vorlage</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" />
                <button className="cta" type="submit">Anlegen</button>
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
                    template.id === updated.id ? { ...template, ...updated } : template,
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
            <form className="admin-card campaign-form" onSubmit={scheduleCampaign}>
              <div className="admin-card-title">Versand planen</div>
              <div className="field">
                <label>Vorlage</label>
                <select
                  value={scheduleTemplate}
                  onChange={(e) => {
                    setScheduleTemplate(e.target.value);
                    const template = templates.find((item) => String(item.id) === e.target.value);
                    if (template) setScheduleSubject(template.subject);
                  }}
                >
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Betreff</label>
                <input value={scheduleSubject} onChange={(e) => setScheduleSubject(e.target.value)} />
              </div>
              <div className="admin-date-grid">
                <DayPicker
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  locale={de}
                />
                <div className="field">
                  <label>Uhrzeit</label>
                  <input type="time" value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)} />
                  <p>{selectedDate ? format(selectedDate, "PPPP", { locale: de }) : ""}</p>
                </div>
              </div>
              <button className="cta" type="submit">Termin speichern</button>
              {selectedTemplateSummary && <p className="admin-muted">Empfänger*innen: {stats.subscriberCount.toLocaleString("de-DE")}</p>}
            </form>

            <div className="admin-card campaign-list">
              <div className="admin-card-title">Kampagnen</div>
              {campaigns.length === 0 && <p className="admin-muted">Noch keine Kampagnen geplant.</p>}
              {campaigns.map((campaign) => (
                <div className="campaign-row" key={campaign.id}>
                  <div>
                    <strong>{campaign.subject}</strong>
                    <span>{campaign.template_name || "Vorlage gelöscht"}</span>
                    <small>{new Date(campaign.scheduled_at).toLocaleString("de-DE")}</small>
                  </div>
                  <StatusBadge status={campaign.status} />
                  {campaign.status === "scheduled" && (
                    <button type="button" onClick={() => cancel(campaign.id)}>Absagen</button>
                  )}
                </div>
              ))}
            </div>
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
            <div className="admin-card">
              <div className="admin-card-title">Sitzung</div>
              <button className="admin-danger" type="button" onClick={logout}>Abmelden</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
