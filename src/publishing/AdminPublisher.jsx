import { useEffect, useState, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Tabs } from "@base-ui/react/tabs";
import { Menu } from "@base-ui/react/menu";
import { Collapsible } from "@base-ui/react/collapsible";
import { LANGUAGES, DEFAULT_LANG } from "../../config/letter.config.js";
import { setPath, GROUPS } from "../../config/editable.js";
import { resolvedMetadata } from "../../config/publication.js";
import {
  themeIssues,
  THEME_STYLE_FIELDS,
} from "../../config/theme-validation.js";
import { cssDiagnostics } from "../../config/css-policy.js";
import { Choice, ConfirmDialog } from "../ui.jsx";
import { FieldEditor } from "../AdminCopy.jsx";
import { usePublicationDraft } from "./draft.js";
import { publicationScope } from "./scope.js";
import VisualEditor from "./puck.jsx";
import CssEditor from "./CssEditor.jsx";
import TemplatesField from "./TemplatesField.jsx";
import RichField from "./RichField.jsx";
import ConflictResolution from "./ConflictResolution.jsx";
import { readPublicationPreview } from "./preview.js";
import PreviewFailure from "./PreviewFailure.jsx";
import { copyArea, copyLabel } from "./copy-labels.js";
import { templatePlaceholderIssues } from "../../config/template-placeholders.js";
import { useAdminRead, AdminReadStatus } from "../admin-read.jsx";

const validPublication = (data) =>
  data &&
  Number.isInteger(data.revision) &&
  data.document?.locales &&
  LANGUAGES.every(
    (lang) =>
      data.document.locales[lang] &&
      data.defaults?.[lang] &&
      Array.isArray(data.fields?.[lang]),
  );

const WORKSPACES = {
  visual: [
    "Layout",
    "Abschnitte gestalten",
    "Ordne die Abschnitte an und bearbeite ihre Inhalte. Navigation, Haupttitel und Fußzeile haben feste Positionen.",
  ],
  copy: [
    "Texte",
    "Alle öffentlichen Texte",
    "Bearbeite die Texte und rechtlichen Hinweise der gewählten Sprache. Den Brief und die FAQ bearbeitest du im Layout.",
  ],
  emails: [
    "E-Mail-Vorlagen",
    "Nachrichten gestalten",
    "Vorlagen gehören zu diesem Entwurf. Die Vorschau verwendet Beispieldaten.",
  ],
  theme: [
    "Design",
    "Farben und Gestaltung",
    "Das Design gilt für die Website in allen Sprachen. Die Verwaltung verwendet ihr eigenes Design.",
  ],
  metadata: [
    "Suchmaschinen & Teilen",
    "So erscheint deine Website",
    "Titel, Beschreibung und Vorschaubild werden aus deinen Inhalten erstellt. Hier kannst du eigene Angaben festlegen.",
  ],
  css: [
    "CSS",
    "Erweitertes Design",
    "Eigenes CSS wirkt in der vollständigen Vorschau und auf der veröffentlichten Website. Es wird vor der Übernahme geprüft.",
  ],
  preview: [
    "Vorschau",
    "Vor der Veröffentlichung prüfen",
    "Prüfe deine Website mit Beispieldaten in verschiedenen Sprachen und Bildschirmgrößen. Die Vorschau sendet keine Nachrichten und speichert keine Anmeldungen.",
  ],
};
const DESIGN_LABELS = {
  rot: "Hauptfarbe",
  rotText: "Kräftige Akzentfarbe für Text",
  akzent: "Dunkle Kontrastfarbe",
  weiss: "Weiß / helle Schrift",
  fond: "Seitenhintergrund",
  grau: "Zweittext",
  grauStark: "Kräftiger Zweittext",
  grauHell: "Linien und helle Details",
  erfolg: "Erfolg",
  fehler: "Fehler",
  display: "Schrift für Überschriften",
  body: "Schrift für Fließtext",
  shadowOffset: "Versatz des Schattens",
  radius: "Allgemeine Abrundung",
  borderWidth: "Linienstärke",
  cardRadius: "Abrundung der Karten",
  buttonRadius: "Abrundung der Schaltflächen",
  headlineMaxWidth: "Maximale Titelbreite",
  inputRadius: "Abrundung der Eingabefelder",
  checkRadius: "Abrundung der Auswahlkästchen",
  bannerRadius: "Äußere Ecken der Titelflächen",
  bannerPadBottom: "Abstand unter dem Titeltext",
};

export default function AdminPublisher({ api, workspace = "copy" }) {
  const resource = useAdminRead(
    api,
    "/api/admin/publication",
    true,
    validPublication,
  );
  const publication = resource.data;
  return publication ? (
    <Publisher
      key="publisher"
      publication={publication}
      setPublication={resource.setData}
      api={api}
      workspace={workspace}
    />
  ) : (
    <div className="admin-card">
      <AdminReadStatus resource={resource} label="Veröffentlichungsdaten" />
    </div>
  );
}

function Publisher({ publication, setPublication, api, workspace }) {
  const draft = usePublicationDraft(publication);
  const doc = draft.document;
  const scope = publicationScope(draft.base || publication.document, doc);
  const [lang, setLang] = useState(DEFAULT_LANG);
  const [templateSelection, setTemplateSelection] = useState({
    slug: doc.templates[0]?.slug,
    language: DEFAULT_LANG,
  });
  const [tab, setActiveTab] = useState("visual");
  const lastWebsiteTab = useRef("visual");
  function setTab(next) {
    if (next !== "emails") lastWebsiteTab.current = next;
    setActiveTab(next);
  }
  useEffect(() => {
    if (workspace === "templates") setActiveTab("emails");
    else if (workspace === "copy") setActiveTab(lastWebsiteTab.current);
  }, [workspace]);
  const [status, setStatus] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [uploadState, setUploadState] = useState({
    busy: false,
    error: false,
    message: "",
  });
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewFailure, setPreviewFailure] = useState(null);
  const [metadataImage, setMetadataImage] = useState(null);
  const [width, setWidth] = useState("1200");
  const [pageState, setPageState] = useState("campaign");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [copyGroup, setCopyGroup] = useState("hero");
  const [conflict, setConflict] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [imported, setImported] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [rejectedStale, setStale] = useState(false);
  const stale = rejectedStale || draft.revision !== publication.revision;
  const recoveryPanel = useRef(null);
  const recoveryVisible = !conflict && Boolean(stale || publishError);
  function focusRecovery() {
    requestAnimationFrame(() => {
      recoveryPanel.current?.focus();
      recoveryPanel.current?.scrollIntoView({ block: "center" });
    });
  }
  useEffect(() => {
    if (recoveryVisible) {
      setReviewOpen(false);
      focusRecovery();
    }
  }, [stale, publishError]);
  const publisherHeading = useRef(null);
  const publisherRoot = useRef(null);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const focusPublisher = () =>
    requestAnimationFrame(() => publisherHeading.current?.focus());
  function continueEditing() {
    setPublishError(null);
    focusEditor();
  }
  function editWorkspace(next) {
    setTab(next);
    focusEditor();
  }
  function focusEditor() {
    setEditorFocusRequest((request) => request + 1);
  }
  useEffect(() => {
    if (!editorFocusRequest) return;
    const frame = requestAnimationFrame(() => {
      const panel = publisherRoot.current?.querySelector(
        '[role="tabpanel"]:not([hidden])',
      );
      const input = Array.from(
        panel?.querySelectorAll(
          'input:not([type="hidden"]):not([type="color"]):not([type="file"]), textarea, [contenteditable="true"]',
        ) || [],
      ).find(
        (element) =>
          !element.disabled &&
          !element.closest("[hidden]") &&
          element.getClientRects().length,
      );
      const target =
        panel?.querySelector('[aria-invalid="true"]') ||
        input ||
        publisherHeading.current;
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [editorFocusRequest]);
  const previewKey = JSON.stringify([doc, lang, pageState]);
  const currentPreviewKey = useRef(previewKey);
  currentPreviewKey.current = previewKey;
  const [renderedPreviewKey, setRenderedPreviewKey] = useState("");
  const previewFresh = renderedPreviewKey === previewKey;
  const previewImage =
    doc.metadata[lang]?.ogImage ||
    (metadataImage?.key === previewKey ? metadataImage.url : "");
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { document: doc, revision: draft.revision, base: draft.base },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `website-entwurf-revision-${draft.revision}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function compareCurrent() {
    try {
      const res = await api("/api/admin/publication");
      const latest = await res.json();
      if (!res.ok) throw new Error(latest.error);
      setConflict(latest);
    } catch (e) {
      setStatus(e.message);
    }
  }
  async function importDraft(file) {
    if (!file) return;
    setImportBusy(true);
    try {
      if (file.size > 4200000)
        throw new Error("Die Datei ist größer als 4 MB.");
      let input;
      try {
        input = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "Bitte eine gültige JSON-Entwurfsdatei aus dieser Verwaltung wählen.",
        );
      }
      const res = await api("/api/admin/publication/import", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const checked = await res.json();
      if (!res.ok)
        throw new Error(
          checked.error ||
            "Die Datei ist nicht kompatibel oder enthält nicht verfügbare Bilder.",
        );
      const current = await api("/api/admin/publication");
      const latest = await current.json();
      if (!current.ok) throw new Error(latest.error);
      setImported({ ...checked, key: crypto.randomUUID() });
      setConflict(latest);
      setImportOpen(false);
      setStatus(
        "Die Datei ist geprüft. Vergleiche sie mit der aktuellen Veröffentlichung. Dein Entwurf bleibt erhalten, bis du den Vergleich übernimmst.",
      );
    } catch (error) {
      setStatus(`Wiederherstellung nicht möglich: ${error.message}`);
    } finally {
      setImportBusy(false);
    }
  }
  const ask = (message, action) =>
    setConfirmation({
      message,
      returnFocus:
        document.querySelector('.publication-toolbar [aria-haspopup="menu"]') ||
        document.activeElement,
      resolve: (approved) => {
        setConfirmation(null);
        if (approved) action();
      },
    });
  async function loadPrevious() {
    if (historyBusy) return;
    setHistoryBusy(true);
    setHistoryError(false);
    setStatus("");
    try {
      const response = await api("/api/admin/publication/previous");
      if (!response.ok) throw new Error("History unavailable");
      const previous = await response.json();
      if (previous.document === null) {
        setStatus("Es gibt noch keine vorherige Veröffentlichung.");
      } else if (previous.document?.locales && previous.document?.layout) {
        setStatus("");
        ask(
          "Die vorherige Veröffentlichung als Entwurf laden? Sie ersetzt deine aktuellen Änderungen. Du kannst diesen Schritt rückgängig machen.",
          () => draft.change((d) => Object.assign(d, previous.document)),
        );
      } else throw new Error("Invalid history");
    } catch {
      setHistoryError(true);
    } finally {
      setHistoryBusy(false);
    }
  }
  const fields = publication.fields[lang];
  const groups = [...new Set(fields.map(copyArea))];
  const matchedFields = fields.filter(
    (f) =>
      (copyGroup === "all" || copyArea(f) === copyGroup) &&
      `${copyLabel(f)} ${GROUPS[copyArea(f)]} ${f.path} ${JSON.stringify(doc.locales[lang].copy[f.path])}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const config = structuredClone(publication.defaults[lang]);
  for (const [path, value] of Object.entries(doc.locales[lang].copy))
    setPath(config, path, value);
  config.theme = doc.appearance.theme;
  config.publication = { layout: doc.layout, blocks: doc.locales[lang].blocks };
  const metadata = resolvedMetadata(config, doc.metadata[lang]);
  const templateIssues = templatePlaceholderIssues(
    doc.templates,
    publication.document.templates,
    LANGUAGES,
  );
  const cssErrors = cssDiagnostics(doc.appearance.css, [
    ...doc.assets,
    "/signal-beige.png",
    "/signal-white.png",
    "/signal-red.png",
  ]).filter((d) => d.severity === "error");
  const designIssues = themeIssues(doc.appearance.theme);
  const errors = [
    ...cssErrors,
    ...designIssues,
    ...templateIssues.map((issue) => ({
      message: `${issue.name}: ${issue.missing.join(", ")} fehlt.`,
    })),
  ];
  function designError(group, key) {
    const issue = errors.find(
      (item) => item.group === group && item.key === key,
    );
    return issue ? (
      <span
        id={`design-error-${group}-${key}`}
        className="admin-field-error"
        role="alert"
      >
        {issue.message}
      </span>
    ) : null;
  }
  function designInputProps(group, key) {
    return designIssues.some(
      (issue) => issue.group === group && issue.key === key,
    )
      ? {
          "aria-invalid": true,
          "aria-describedby": `design-error-${group}-${key}`,
        }
      : {};
  }
  async function publish() {
    if (
      publishing ||
      errors.length ||
      !draft.dirty ||
      stale ||
      conflict ||
      importBusy
    )
      return;
    setPublishing(true);
    setReviewOpen(false);
    setPublishError(null);
    setStatus("Wird veröffentlicht…");
    try {
      const res = await api("/api/admin/publication", {
        method: "PUT",
        body: JSON.stringify({
          document: doc,
          expectedRevision: draft.revision,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setStale(true);
        setStatus("");
        return;
      }
      if (!res.ok) {
        setStatus("");
        setPublishError({
          rejected: res.status < 500,
          message:
            res.status === 401 || res.status === 403
              ? "Du bist nicht mehr angemeldet oder darfst nicht veröffentlichen. Sichere den Entwurf und melde dich erneut an."
              : res.status < 500
                ? "Der Server hat den Entwurf abgelehnt. Deine Änderungen bleiben erhalten. Behebe den unten beschriebenen Fehler, bevor du erneut veröffentlichst."
                : "Der Server hat die Veröffentlichung nicht bestätigt. Dein Entwurf bleibt erhalten. Versuche es später erneut.",
          reason: typeof data.error === "string" ? data.error : "",
        });
        return;
      }
      setPublication({ ...publication, ...data });
      const newerChanges = draft.published(data, doc);
      window.dispatchEvent(new Event("publication-published"));
      setStatus(
        `Revision ${data.revision} ist veröffentlicht.${newerChanges ? " Deine neueren Änderungen bleiben als lokaler Entwurf erhalten und sind noch nicht veröffentlicht." : ""}`,
      );
      setStale(false);
    } catch (e) {
      setStatus("");
      setPublishError({
        message:
          "Die Veröffentlichung ist nicht bestätigt. Dein Entwurf bleibt im Browser erhalten. Prüfe die Verbindung und versuche es erneut.",
        detail: e.message,
      });
    } finally {
      setPublishing(false);
    }
  }
  async function fullPreview(imageOnly = false) {
    const requestedKey = previewKey;
    let completed = false;
    if (
      previewFailure?.key !== requestedKey ||
      previewFailure.imageOnly !== imageOnly
    )
      setPreviewFailure(null);
    setReviewOpen(false);
    setPreviewBusy(true);
    try {
      const html = await readPublicationPreview(api, {
        document: doc,
        lang,
        pageState,
      });
      if (imageOnly)
        setMetadataImage({
          key: requestedKey,
          url: new DOMParser()
            .parseFromString(html, "text/html")
            .querySelector('meta[property="og:image"]').content,
        });
      else if (currentPreviewKey.current === requestedKey) {
        setPreview(html);
        setRenderedPreviewKey(requestedKey);
      }
      setPreviewFailure(null);
      completed = true;
    } catch (error) {
      if (currentPreviewKey.current === requestedKey)
        setPreviewFailure({
          key: requestedKey,
          imageOnly,
          message: error.detail
            ? error.message
            : "Die Vorschau konnte nicht erstellt werden. Dein lokaler Entwurf bleibt erhalten. Versuche es erneut.",
          detail: error.detail || error.message,
        });
    } finally {
      setPreviewBusy(false);
      if (
        completed &&
        (document.activeElement === document.body ||
          document.activeElement?.closest(".publication-preview-error"))
      )
        requestAnimationFrame(() => {
          const target = publisherRoot.current?.querySelector(
            `[data-preview-action="${imageOnly ? "image" : "website"}"]`,
          );
          if (target?.getClientRects().length) target.focus();
        });
    }
  }
  async function upload(file) {
    if (!file || uploadState.busy) return;
    setUploadState({
      busy: true,
      error: false,
      message: "Bild wird hochgeladen…",
    });
    try {
      const res = await api("/api/admin/publication/assets", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(
          result.error || "Das Bild konnte nicht hochgeladen werden.",
        );
      if (typeof result.url !== "string")
        throw new Error("Upload nicht bestätigt.");
      draft.change((d) => {
        if (!d.assets.includes(result.url)) d.assets.push(result.url);
      });
      setUploadState({
        busy: false,
        error: false,
        message:
          "Das Bild ist hochgeladen. Du kannst es im Layout und als Vorschaubild auswählen.",
      });
    } catch (error) {
      setUploadState({
        busy: false,
        error: true,
        message: `${error instanceof TypeError ? "Keine Serverbestätigung zum Hochladen." : error.message} Bitte die Datei erneut auswählen. Deine bisherigen Bilder bleiben erhalten.`,
      });
    }
  }
  return (
    <section
      ref={publisherRoot}
      className={`publication-admin ${tab === "emails" ? "is-template" : ""}`}
      data-workspace={tab}
    >
      <div className="publication-heading">
        <div>
          <h1 ref={publisherHeading} tabIndex={-1}>
            {tab === "emails" ? "E-Mail-Vorlagen" : "Veröffentlichen"}
          </h1>
          {draft.dirty && (
            <p
              className="publication-scope"
              id="publication-scope"
              role="status"
            >
              Diese Änderungen werden veröffentlicht: {scope.groups.join("; ")}
            </p>
          )}
        </div>
        <div className="publication-publish-controls">
          {draft.dirty && (
            <Collapsible.Root
              className="publication-review"
              open={reviewOpen && !recoveryVisible && !publishing && !conflict}
              onOpenChange={setReviewOpen}
              disabled={publishing || recoveryVisible || Boolean(conflict)}
            >
              <Collapsible.Trigger className="admin-disclosure-trigger">
                Änderungen prüfen · {scope.groups.length}{" "}
                {scope.groups.length === 1 ? "Bereich" : "Bereiche"}
              </Collapsible.Trigger>
              <Collapsible.Panel keepMounted className="admin-disclosure-panel">
                <div id="publication-review-content">
                  <strong>Änderungen dieser Veröffentlichung</strong>
                  <ul>
                    {scope.groups.map((group) => (
                      <li key={group}>{group}</li>
                    ))}
                  </ul>
                  {scope.groups.some((group) =>
                    group.startsWith("E-Mail ·"),
                  ) && (
                    <p>
                      Diese Änderungen gelten auch für geplante Nachrichten. Der
                      Versand verwendet die dann veröffentlichte Vorlage.
                    </p>
                  )}
                </div>
              </Collapsible.Panel>
            </Collapsible.Root>
          )}
          <Button
            className="publication-publish"
            aria-controls={recoveryVisible ? "publication-recovery" : undefined}
            aria-describedby={
              draft.dirty ? "publication-review-content" : undefined
            }
            disabled={
              publishing ||
              (!recoveryVisible &&
                (!draft.dirty || errors.length > 0 || stale)) ||
              Boolean(conflict) ||
              importBusy
            }
            onClick={recoveryVisible ? focusRecovery : publish}
          >
            {publishing
              ? "Wird veröffentlicht…"
              : recoveryVisible
                ? stale
                  ? "Versionskonflikt prüfen"
                  : "Fehlermeldung prüfen"
                : scope.label}
          </Button>
        </div>
      </div>
      <div className="publication-toolbar">
        <span className={`publication-state ${draft.dirty ? "is-dirty" : ""}`}>
          <span>{draft.dirty ? "● Lokaler Entwurf" : "✓ Veröffentlicht"}</span>
          <span className="publication-revision">
            {" "}
            · Revision {draft.revision}
          </span>
        </span>
        {tab !== "emails" && (
          <Choice
            label="Inhaltssprache"
            value={lang}
            onChange={setLang}
            options={LANGUAGES.map((l) => [l, l.toUpperCase()])}
          />
        )}
        <Button
          className="publication-undo"
          aria-label="Rückgängig"
          title="Rückgängig"
          disabled={!draft.canUndo}
          onClick={draft.undo}
        >
          <span className="publication-undo-icon" aria-hidden="true">
            ↶
          </span>
          <span className="publication-undo-label">Rückgängig</span>
        </Button>
        <Menu.Root>
          <Menu.Trigger
            className="publication-more"
            aria-label="Weitere Aktionen"
          >
            <span className="publication-actions-label">
              Weitere Aktionen ▾
            </span>
            <span className="publication-actions-icon" aria-hidden="true">
              ⋯
            </span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6}>
              <Menu.Popup className="admin-choice-popup">
                <Menu.Item
                  className="admin-choice-item"
                  disabled={!draft.dirty}
                  onClick={() =>
                    ask(
                      "Lokalen Entwurf verwerfen und zur veröffentlichten Version zurückkehren?",
                      async () => {
                        try {
                          const res = await api("/api/admin/publication");
                          const latest = await res.json();
                          if (!res.ok) throw new Error(latest.error);
                          setPublication(latest);
                          const newerChanges = draft.published(latest, doc);
                          setStale(false);
                          setConflict(null);
                          setImported(null);
                          setPublishError(null);
                          setStatus(
                            newerChanges
                              ? "Aktuelle Veröffentlichung geladen. Änderungen während des Ladens bleiben als lokaler Entwurf erhalten."
                              : "Entwurf verworfen. Aktuelle Veröffentlichung geladen.",
                          );
                        } catch (e) {
                          setStatus(e.message);
                        }
                      },
                    )
                  }
                >
                  Entwurf verwerfen
                </Menu.Item>
                <Menu.Item
                  className="admin-choice-item"
                  disabled={historyBusy}
                  onClick={loadPrevious}
                >
                  Vorherige Version laden
                </Menu.Item>
                <Menu.Item className="admin-choice-item" onClick={exportDraft}>
                  Entwurf als Datei sichern
                </Menu.Item>
                <Menu.Item
                  className="admin-choice-item"
                  onClick={() => setImportOpen(true)}
                >
                  Entwurf aus Datei wiederherstellen
                </Menu.Item>
                <Menu.Item
                  className="admin-choice-item"
                  aria-expanded={showHelp}
                  aria-controls="publication-help"
                  onClick={() => setShowHelp(!showHelp)}
                >
                  {showHelp
                    ? "Hinweise ausblenden"
                    : "Hinweise zu diesem Bereich"}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <Collapsible.Root open={showHelp} onOpenChange={setShowHelp}>
        <Collapsible.Panel id="publication-help" className="publication-help">
          <p>
            Website und E-Mail-Vorlagen teilen einen Entwurf. Bis zur
            Veröffentlichung bleiben deine Änderungen in diesem Browser.
          </p>
          <p>{WORKSPACES[tab][2]}</p>
          <Button onClick={() => setShowHelp(false)}>Hinweise schließen</Button>
        </Collapsible.Panel>
      </Collapsible.Root>
      {importOpen && (
        <section className="admin-card publication-import">
          <h2>Entwurf aus Datei wiederherstellen</h2>
          <p>
            Wähle eine hier gesicherte JSON-Datei mit höchstens 4 MB. Vergleiche
            die geprüften Inhalte mit der aktuellen Veröffentlichung. Die
            Übernahme erstellt einen Entwurf im Browser. Veröffentliche ihn
            anschließend.
          </p>
          <label>
            Entwurfsdatei
            <input
              type="file"
              accept="application/json,.json"
              disabled={importBusy}
              onChange={(e) => importDraft(e.target.files?.[0])}
            />
          </label>
          <Button disabled={importBusy} onClick={() => setImportOpen(false)}>
            Abbrechen
          </Button>
          {importBusy && <p role="status">Datei wird geprüft…</p>}
        </section>
      )}
      {status && (
        <p className="publication-feedback" role="status">
          {status}
        </p>
      )}
      {historyBusy && (
        <p className="publication-feedback" role="status">
          Vorherige Veröffentlichung wird geladen…
        </p>
      )}
      {historyError && (
        <div className="publication-feedback" role="alert">
          <p>
            Die vorherige Veröffentlichung konnte nicht geladen werden. Dein
            Entwurf bleibt erhalten.
          </p>
          <Button className="admin-button" onClick={loadPrevious}>
            Vorherige Version erneut laden
          </Button>
        </div>
      )}
      {recoveryVisible && (
        <div
          className="publication-stale publication-recovery admin-card"
          role="alert"
          id="publication-recovery"
          ref={recoveryPanel}
          tabIndex={-1}
        >
          <h2>
            {stale
              ? "Neuere Veröffentlichung verfügbar"
              : "Veröffentlichung nicht bestätigt"}
          </h2>
          <p>
            {stale
              ? `${draft.revision !== publication.revision ? `Dein Entwurf basiert auf Revision ${draft.revision}; veröffentlicht ist Revision ${publication.revision}. ` : ""}Deine Änderungen bleiben erhalten. Vergleiche die Versionen vor dem Veröffentlichen.`
              : publishError.message}
          </p>
          {publishError?.reason && <p>{publishError.reason}</p>}
          <div className="admin-actions">
            {stale ? (
              <Button onClick={compareCurrent}>
                Mit aktueller Veröffentlichung vergleichen
              </Button>
            ) : !publishError.rejected ? (
              <Button
                onClick={publish}
                disabled={publishing || errors.length > 0 || !draft.dirty}
              >
                Erneut veröffentlichen
              </Button>
            ) : null}
            <Button onClick={exportDraft}>Entwurf als Datei sichern</Button>
            {!stale && (
              <Button onClick={continueEditing}>Weiter bearbeiten</Button>
            )}
          </div>
          {publishError?.detail && (
            <Collapsible.Root>
              <Collapsible.Trigger>Technische Angaben</Collapsible.Trigger>
              <Collapsible.Panel>{publishError.detail}</Collapsible.Panel>
            </Collapsible.Root>
          )}
        </div>
      )}
      {conflict && (
        <ConflictResolution
          key={imported?.key || conflict.revision}
          draft={imported || draft}
          existingDraft={imported ? draft : undefined}
          defaults={publication.defaults}
          current={conflict}
          exportDraft={exportDraft}
          onCancel={() => {
            setConflict(null);
            setImported(null);
            focusPublisher();
          }}
          onAccept={(document, latest) => {
            setPublication(latest);
            draft.rebase(document, latest);
            setConflict(null);
            setImported(null);
            setStale(false);
            setPublishError(null);
            focusPublisher();
            setStatus(
              `Entwurf mit Revision ${latest.revision} zusammengeführt. Prüfe die Vorschau und veröffentliche anschließend.`,
            );
          }}
        />
      )}
      {draft.storageWarning && <p role="alert">{draft.storageWarning}</p>}
      {designIssues.length > 0 && tab !== "theme" && (
        <div className="email-failure" role="alert">
          <p>Prüfe die markierten Designwerte, bevor du veröffentlichst.</p>
          <Button
            className="admin-button"
            onClick={() => editWorkspace("theme")}
          >
            Designwerte korrigieren
          </Button>
        </div>
      )}
      {templateIssues.length > 0 && tab !== "emails" && (
        <div className="email-failure" role="alert">
          <p>
            Veröffentlichen ist gesperrt: In {templateIssues.length}{" "}
            E-Mail-Vorlagen fehlen erforderliche Links oder Platzhalter.
          </p>
          <Button
            className="admin-button"
            onClick={() => editWorkspace("emails")}
          >
            E-Mail-Vorlagen reparieren
          </Button>
        </div>
      )}
      <ConfirmDialog
        request={confirmation}
        resolve={(approved) => confirmation?.resolve(approved)}
      />
      <Tabs.Root value={tab} onValueChange={setTab}>
        {workspace !== "templates" && (
          <div className="admin-mobile-section">
            <label>Website bearbeiten</label>
            <Choice
              label="Website bearbeiten"
              value={tab}
              onChange={setTab}
              options={Object.entries(WORKSPACES).map(([value, item]) => [
                value,
                item[0],
              ])}
            />
          </div>
        )}
        {workspace !== "templates" && (
          <Tabs.List className="publication-tabs">
            {Object.keys(WORKSPACES).map((v) => (
              <Tabs.Tab key={v} value={v}>
                {WORKSPACES[v][0]}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        )}
        {tab !== "visual" && (
          <div
            className={`publication-workspace-heading ${tab === "emails" ? "template-workspace-heading" : ""}`}
          >
            <h2>{WORKSPACES[tab][1]}</h2>
            <p>{WORKSPACES[tab][2]}</p>
          </div>
        )}
        <Tabs.Panel value="visual">
          <VisualEditor
            document={doc}
            config={config}
            lang={lang}
            change={draft.change}
            publish={publish}
            publishLabel={publishing ? "Wird veröffentlicht…" : scope.label}
            publishDisabled={
              publishing ||
              errors.length > 0 ||
              stale ||
              !draft.dirty ||
              Boolean(conflict) ||
              importBusy
            }
            editCopy={(group) => {
              setCopyGroup(group);
              setSearch("");
              setTab("copy");
            }}
          />
        </Tabs.Panel>
        <Tabs.Panel value="copy">
          <div className="publication-copy-tools">
            <Choice
              label="Textbereich"
              value={copyGroup}
              onChange={setCopyGroup}
              options={[
                ["all", "Alle Bereiche"],
                ...groups.map((g) => [g, GROUPS[g] || g]),
              ]}
            />
            <Input
              type="search"
              aria-label="Öffentliche Texte durchsuchen"
              placeholder="Text oder Beschriftung suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span>{matchedFields.length} Felder</span>
          </div>
          <div className="publication-fields publication-copy-fields">
            {matchedFields.map((field) => (
              <div key={field.path} className="field">
                <label htmlFor={`copy-${field.path}`}>{copyLabel(field)}</label>
                {field.type === "html" ? (
                  <RichField
                    label={copyLabel(field)}
                    value={doc.locales[lang].copy[field.path]}
                    onChange={(v) =>
                      draft.change((d) => {
                        d.locales[lang].copy[field.path] = v;
                      })
                    }
                  />
                ) : (
                  <FieldEditor
                    field={field}
                    value={doc.locales[lang].copy[field.path]}
                    onChange={(v) =>
                      draft.change((d) => {
                        d.locales[lang].copy[field.path] = v;
                      })
                    }
                  />
                )}
                <Collapsible.Root className="publication-field-path">
                  <Collapsible.Trigger className="admin-disclosure-trigger">
                    Zurücksetzen & Details
                  </Collapsible.Trigger>
                  <Collapsible.Panel
                    keepMounted
                    className="admin-disclosure-panel"
                  >
                    <code>{field.path}</code>
                    <Button
                      onClick={() =>
                        draft.change((d) => {
                          d.locales[lang].copy[field.path] = field.default;
                        })
                      }
                    >
                      Feld zurücksetzen
                    </Button>
                  </Collapsible.Panel>
                </Collapsible.Root>
              </div>
            ))}
          </div>
          {!matchedFields.length && (
            <p className="admin-empty">
              Keine passenden Texte. Ändere den Suchbegriff oder wähle einen
              anderen Bereich.
            </p>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="emails">
          <TemplatesField
            selection={templateSelection}
            onSelectionChange={setTemplateSelection}
            templates={doc.templates}
            publishedTemplates={publication.document.templates}
            nextTemplateId={publication.nextTemplateId}
            issues={templateIssues}
            change={draft.change}
            api={api}
          />
          <Collapsible.Root className="template-scope">
            <Collapsible.Trigger className="admin-disclosure-trigger">
              Gemeinsame Vorlagen & Sprachvarianten
            </Collapsible.Trigger>
            <Collapsible.Panel keepMounted className="admin-disclosure-panel">
              <p>
                Wähle bei Systemnachrichten die Sprache an der Vorlage. Dort
                kannst du auch fehlende Übersetzungen anlegen. Der Versand
                verwendet die Sprache der Person oder die Standardsprache.
                Newsletter-Vorlagen wählst du im Bereich Versand für jede
                Sprache. Alle Vorlagenänderungen gehören zu diesem Entwurf.
              </p>
            </Collapsible.Panel>
          </Collapsible.Root>
        </Tabs.Panel>
        <Tabs.Panel value="theme">
          <div className="publication-fields">
            {Object.entries(doc.appearance.theme.colors).map(([key, value]) => (
              <div className="field publication-color-field" key={key}>
                <label htmlFor={`theme-color-${key}`}>
                  {DESIGN_LABELS[key] || key}
                </label>
                <div className="publication-color-row">
                  <input
                    type="color"
                    aria-label={`${DESIGN_LABELS[key] || key} · Farbauswahl`}
                    value={
                      /^#[0-9a-f]{6}$/i.test(value)
                        ? value
                        : /^#[0-9a-f]{3,4}$/i.test(value)
                          ? "#" +
                            value
                              .slice(1, 4)
                              .split("")
                              .map((c) => c + c)
                              .join("")
                          : /^#[0-9a-f]{8}$/i.test(value)
                            ? value.slice(0, 7)
                            : "#000000"
                    }
                    onChange={(e) =>
                      draft.change((d) => {
                        d.appearance.theme.colors[key] = e.target.value;
                      })
                    }
                  />
                  <Input
                    id={`theme-color-${key}`}
                    {...designInputProps("colors", key)}
                    aria-label={`${DESIGN_LABELS[key] || key} · Hexadezimalwert`}
                    value={value}
                    placeholder="#123456"
                    spellCheck={false}
                    onChange={(e) =>
                      draft.change((d) => {
                        d.appearance.theme.colors[key] = e.target.value;
                      })
                    }
                  />
                </div>
                {designError("colors", key)}
              </div>
            ))}
            {Object.entries(doc.appearance.theme.fonts).map(([key, value]) => (
              <label key={key}>
                {DESIGN_LABELS[key] || key}
                <Input
                  {...designInputProps("fonts", key)}
                  value={value}
                  onChange={(e) =>
                    draft.change((d) => {
                      d.appearance.theme.fonts[key] = e.target.value;
                    })
                  }
                />
                {designError("fonts", key)}
              </label>
            ))}
            {THEME_STYLE_FIELDS.map((key) => (
              <label key={key}>
                {DESIGN_LABELS[key]}
                <Input
                  {...designInputProps("style", key)}
                  placeholder={
                    key === "shadowOffset"
                      ? "z. B. 8px 8px 0"
                      : key === "headlineMaxWidth"
                        ? "z. B. 1000px"
                        : "z. B. 8px · leer = Standard"
                  }
                  value={doc.appearance.theme.style?.[key] || ""}
                  onChange={(e) =>
                    draft.change((d) => {
                      d.appearance.theme.style ||= {};
                      if (e.target.value)
                        d.appearance.theme.style[key] = e.target.value;
                      else delete d.appearance.theme.style[key];
                    })
                  }
                />
                {designError("style", key)}
              </label>
            ))}
            <Choice
              label="Schattenstil"
              value={doc.appearance.theme.style?.shadow || "hard"}
              options={[
                ["hard", "Versetzt"],
                ["soft", "Weich"],
              ]}
              onChange={(v) =>
                draft.change((d) => {
                  d.appearance.theme.style ||= {};
                  d.appearance.theme.style.shadow = v;
                })
              }
            />
          </div>
          <label>
            Öffentliches Bild hochladen · PNG, JPEG oder WebP, bis 8 MB
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploadState.busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                upload(file);
              }}
            />
          </label>
          {uploadState.message && (
            <p role={uploadState.error ? "alert" : "status"}>
              {uploadState.message}
            </p>
          )}
          {doc.assets.map((a) => (
            <img key={a} src={a} alt="Hochgeladenes Bild" width="100" />
          ))}
        </Tabs.Panel>
        <Tabs.Panel value="metadata">
          <div className="publication-metadata-preview">
            <div>
              <span className="admin-eyebrow">
                Suchergebnis · {lang.toUpperCase()}
              </span>
              <p className="metadata-url">{config.meta.canonicalUrl}</p>
              <h3>{metadata.title}</h3>
              <p>{metadata.description}</p>
            </div>
            <div>
              <span className="admin-eyebrow">Geteilte Vorschau</span>
              {previewImage && (
                <img
                  src={previewImage}
                  alt="Vorschaubild für soziale Netzwerke"
                />
              )}
              <h3>{metadata.title}</h3>
              <p>{metadata.ogDescription}</p>
              <Button
                data-preview-action="image"
                disabled={previewBusy || errors.length > 0}
                onClick={() => fullPreview(true)}
              >
                {previewBusy
                  ? "Bild wird erstellt…"
                  : "Vorschaubild aktualisieren"}
              </Button>
              {previewFailure?.key === previewKey &&
                previewFailure.imageOnly && (
                  <PreviewFailure
                    failure={previewFailure}
                    busy={previewBusy}
                    onRetry={() => fullPreview(true)}
                  />
                )}
            </div>
          </div>
          {["title", "description", "ogDescription", "imageText"].map((key) => (
            <label className="field" key={key}>
              {
                {
                  title: "Seitentitel",
                  description: "Beschreibung für Suchmaschinen",
                  ogDescription: "Beschreibung beim Teilen",
                  imageText: "Text im generierten Vorschaubild",
                }[key]
              }
              <Input
                value={doc.metadata[lang]?.[key] || ""}
                placeholder="Automatisch aus deinen Inhalten"
                onChange={(e) =>
                  draft.change((d) => {
                    d.metadata[lang][key] = e.target.value;
                  })
                }
              />
            </label>
          ))}
          <Choice
            label="Vorschaubild"
            value={doc.metadata[lang]?.ogImage || ""}
            onChange={(v) =>
              draft.change((d) => {
                d.metadata[lang].ogImage = v;
              })
            }
            options={[
              ["", "Automatisch generiertes Bild"],
              ...doc.assets.map((a) => [a, a]),
            ]}
          />
          <Button
            onClick={() =>
              draft.change((d) => {
                d.metadata[lang] = {};
              })
            }
          >
            Auf automatisch zurücksetzen
          </Button>
        </Tabs.Panel>
        <Tabs.Panel value="css">
          <p>
            Abschnitts-Selektoren: [data-section="brief"],
            [data-section="hero"]. Design-Variablen: --rot, --fond, --akzent.
          </p>
          <CssEditor
            value={doc.appearance.css}
            assets={doc.assets}
            onChange={(value) =>
              draft.change((d) => {
                d.appearance.css = value;
              })
            }
          />
          {cssErrors.map((e, i) => (
            <p role="alert" key={i}>
              {e.message}
            </p>
          ))}
        </Tabs.Panel>
        <Tabs.Panel value="preview">
          <div className="admin-actions">
            <Choice
              label="Bildschirmgröße"
              value={width}
              onChange={setWidth}
              options={[
                ["360", "Mobil"],
                ["768", "Tablet"],
                ["1200", "Desktop"],
              ]}
            />
            <Choice
              label="Seitenzustand"
              value={pageState}
              onChange={setPageState}
              options={[
                ["campaign", "Kampagne"],
                ["success", "Erfolg"],
                ["confirmation", "Bestätigung"],
                ["error", "Fehler"],
              ]}
            />
            <Button
              data-preview-action="website"
              disabled={previewBusy || errors.length > 0}
              onClick={() => fullPreview()}
            >
              {previewBusy
                ? "Vorschau wird erstellt…"
                : preview
                  ? "Vorschau aktualisieren"
                  : "Vollständige Vorschau öffnen"}
            </Button>
          </div>
          {preview && !previewFresh && (
            <p className="publication-feedback" role="status">
              Die Vorschau ist veraltet. Aktualisiere sie für die gewählte
              Sprache, den Seitenzustand und deinen aktuellen Entwurf.
            </p>
          )}
          {previewFailure?.key === previewKey && !previewFailure.imageOnly && (
            <PreviewFailure
              failure={previewFailure}
              busy={previewBusy}
              onRetry={() => fullPreview()}
            />
          )}
          {!preview && (
            <div className="admin-empty">
              <h3>Website prüfen</h3>
              <p>
                Wähle Bildschirmgröße und Seitenzustand. Öffne dann die
                Vorschau. Deine Änderungen werden dabei nicht veröffentlicht.
              </p>
            </div>
          )}
          {preview && previewFresh && (
            <div className="publication-preview-stage">
              <p>
                Aktueller Entwurf · {lang.toUpperCase()} ·{" "}
                {
                  {
                    campaign: "Kampagne",
                    success: "Erfolg",
                    confirmation: "Bestätigung",
                    error: "Fehler",
                  }[pageState]
                }{" "}
                · Basisrevision {draft.revision}
              </p>
              <iframe
                title="Vollständige Vorschau mit Beispieldaten"
                sandbox="allow-scripts"
                srcDoc={preview}
                style={{
                  width: Number(width),
                  maxWidth: "none",
                  height: 900,
                  border: "1px solid #ccc",
                }}
              />
            </div>
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </section>
  );
}
