import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Choice } from "../ui.jsx";
import {
  reconcilePublication,
  reconcileImport,
  publicationChanges,
} from "./reconcile.js";
import { copyLabel } from "./copy-labels.js";
import {
  setPath,
  getPath,
  editableFields,
  LINE_STYLES,
  SECTION_LABELS,
} from "../../config/editable.js";
import { resolvedMetadata } from "../../config/publication.js";
import { richTextSummary } from "./rich-summary.js";

const metadataLabels = {
  title: "Seitentitel",
  description: "Beschreibung",
  ogDescription: "Beschreibung beim Teilen",
  imageText: "Text im Vorschaubild",
  ogImage: "Vorschaubild",
};
const templateLabels = {
  subject: "Betreff",
  html_body: "Nachricht",
  name: "Name",
};
const faqChange = (path) =>
  path[0] === "locales" &&
  path[2] === "blocks" &&
  ["items", "introductionHtml"].includes(path[4]);
function question(item, documents) {
  return documents
    .flatMap(
      (doc) =>
        doc?.locales?.[item.path[1]]?.blocks?.[item.path[3]]?.items || [],
    )
    .find((q) => q.id === item.path[6]);
}
function RichComparison({ html, title }) {
  return (
    <iframe
      className="publication-diff-rich"
      title={title}
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 system-ui;padding:12px;margin:0;overflow-wrap:anywhere}a{pointer-events:none}h1,h2,h3{font-size:18px}</style></head><body>${html}</body></html>`}
    />
  );
}
function label(item, documents) {
  const path = item.path;
  if (faqChange(path)) {
    const prefix = `${path[1].toUpperCase()} · FAQ`;
    if (path[4] === "introductionHtml") return `${prefix} · Einleitung`;
    if (path[5] === "order") return `${prefix} · Reihenfolge der Fragen`;
    const title = richTextSummary(
      question(item, documents)?.questionHtml || "",
    );
    return `${prefix} · ${title ? `"${title}"` : "Frage"} · ${{ questionHtml: "Frage", answerHtml: "Antwort" }[path[7]] || "Hinzufügen / Entfernen"}`;
  }
  if (path[0] === "locales" && path[2] === "copy")
    return `${path[1].toUpperCase()} · ${copyLabel({ path: path[3], default: item.local })}`;
  if (path[0] === "metadata")
    return `${path[1].toUpperCase()} · ${metadataLabels[path[2]] || "Metadaten"}`;
  if (path[0] === "templates") {
    const template = documents
      .flatMap((doc) => doc?.templates || [])
      .find((t) => String(t.id) === path[1]);
    return `${template?.name || "E-Mail-Vorlage"} · ${templateLabels[path[2]] || "Vorlage"}`;
  }
  return (
    {
      layout: "Anordnung und Eigenschaften der Abschnitte",
      assets: "Öffentliche Bilder",
      appearance: "Design",
    }[path[0]] || "Inhalt: " + path.join(" › ")
  );
}

function Value({ item, value, document, defaults, documents = [] }) {
  if (item.path[0] === "locales" && item.path[2] === "copy") {
    const [, lang, , path] = item.path;
    const config = defaults[lang] || {};
    const field = editableFields(config).find(
      (candidate) => candidate.path === path,
    );
    const effective = value === undefined ? getPath(config, path) : value;
    let content;
    if (effective === undefined) content = <p>Kein eigener Text festgelegt</p>;
    else if (field?.type === "lines")
      content = (
        <ol className="publication-headline-comparison">
          {effective.map((line, index) => (
            <li key={index}>
              <span>{line.text}</span>
              <small>
                {LINE_STYLES.find(
                  ([style]) => style === (line.style || ""),
                )?.[1] || "Weitere Hervorhebung"}
              </small>
            </li>
          ))}
        </ol>
      );
    else if (Array.isArray(effective))
      content = effective.length ? (
        <ul>
          {effective.map((text, index) => (
            <li key={index}>
              {field?.type === "sections" ? SECTION_LABELS[text] : text}
            </li>
          ))}
        </ul>
      ) : (
        <p>Keine Einträge</p>
      );
    else if (field?.type === "html")
      content = (
        <RichComparison title={label(item, [document])} html={effective} />
      );
    else
      content = (
        <p className="publication-diff-text">
          {typeof effective === "boolean"
            ? effective
              ? "Ja"
              : "Nein"
            : String(effective)}
        </p>
      );
    return (
      <>
        {value === undefined && (
          <p className="admin-muted">Vorgabe aus den Servereinstellungen</p>
        )}
        {content}
      </>
    );
  }
  if (faqChange(item.path)) {
    if (value === undefined) return <p>Frage nicht vorhanden</p>;
    if (item.path[5] === "order") {
      const questions = [document, ...documents].flatMap(
        (doc) =>
          doc?.locales?.[item.path[1]]?.blocks?.[item.path[3]]?.items || [],
      );
      return value.length ? (
        <ol className="publication-faq-order">
          {value.map((id) => (
            <li key={id}>
              {richTextSummary(
                questions.find((q) => q.id === id)?.questionHtml,
              ) || "Neue Frage"}
            </li>
          ))}
        </ol>
      ) : (
        <p>Keine Fragen</p>
      );
    }
    if (value && typeof value === "object")
      return (
        <>
          <h4>Frage</h4>
          <RichComparison title="Frage" html={value.questionHtml} />
          <h4>Antwort</h4>
          <RichComparison title="Antwort" html={value.answerHtml} />
        </>
      );
    return (
      <RichComparison
        title={label(item, [document, ...documents])}
        html={value}
      />
    );
  }
  if (item.path[0] === "metadata" && (value === undefined || value === "")) {
    const [, lang, key] = item.path;
    const config = structuredClone(defaults[lang] || {});
    for (const [path, text] of Object.entries(
      document.locales?.[lang]?.copy || {},
    ))
      setPath(config, path, text);
    const automatic = resolvedMetadata(config, document.metadata?.[lang]);
    return (
      <p>
        Automatisch:{" "}
        {key === "ogImage"
          ? "Generiertes Vorschaubild"
          : automatic[key] ||
            (key === "imageText" ? automatic.title : "Aus den Seiteninhalten")}
      </p>
    );
  }
  if (item.path[0] === "templates" && value && typeof value === "object")
    return (
      <>
        <h4>{value.name}</h4>
        <p>{value.subject}</p>
        <Value
          item={{ ...item, path: [...item.path, "html_body"] }}
          value={value.html_body}
          document={document}
          defaults={defaults}
          documents={documents}
        />
      </>
    );
  if (
    item.path[0] === "templates" &&
    item.path.at(-1) === "html_body" &&
    value !== undefined
  )
    return (
      <iframe
        className="publication-diff-email"
        title={`Nachricht: ${label(item, [document])}`}
        sandbox=""
        srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 system-ui;padding:12px;margin:0;overflow-wrap:anywhere}a{pointer-events:none}</style></head><body>${value}</body></html>`}
      />
    );
  return (
    <pre>
      {value === undefined
        ? "Entfernt"
        : typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function ConflictResolution({
  draft,
  existingDraft,
  current,
  defaults,
  onAccept,
  onCancel,
  exportDraft,
}) {
  const [choices, setChoices] = useState({});
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const result = existingDraft
    ? reconcileImport(existingDraft, draft, current.document, choices)
    : reconcilePublication(
        draft.base,
        draft.document,
        current.document,
        choices,
      );
  const remaining = result.conflicts.filter(
    (item) => !choices[item.key],
  ).length;
  const automatic = publicationChanges(
    current.document,
    result.document,
  ).filter(
    (item) =>
      !result.conflicts.some((conflict) =>
        conflict.path.every((part, index) => item.path[index] === part),
      ),
  );
  const documents = [
    draft.document,
    existingDraft?.document,
    current.document,
    result.document,
  ];
  const groups = Object.groupBy(automatic, (item) =>
    item.path[0] === "locales"
      ? `Inhalt · ${item.path[1].toUpperCase()}`
      : item.path[0] === "metadata"
        ? `Suchmaschinen und Teilen · ${item.path[1]?.toUpperCase()}`
        : {
            appearance: "Design",
            templates: "E-Mail-Vorlagen",
            layout: "Abschnitte",
            assets: "Bilder",
            analytics: "Statistik",
          }[item.path[0]] || "Weitere Änderungen",
  );
  return (
    <section
      className="publication-conflicts admin-card"
      aria-labelledby="conflict-heading"
    >
      <h2 id="conflict-heading" tabIndex={-1} ref={heading}>
        {existingDraft
          ? "Datei und Browserentwurf zusammenführen"
          : `Änderungen mit Revision ${current.revision} zusammenführen`}
      </h2>
      <p>
        {existingDraft
          ? "Vergleiche die Datei mit deinem Entwurf und der aktuellen Veröffentlichung. Änderungen an verschiedenen Feldern bleiben erhalten. Wähle bei widersprüchlichen Werten, welcher gelten soll."
          : "Dein Entwurf bleibt erhalten. Änderungen an verschiedenen Feldern werden zusammengeführt. Wähle bei widersprüchlichen Werten, welcher gelten soll."}{" "}
        Die Übernahme speichert den Vergleich als Entwurf im Browser.
        Veröffentliche ihn anschließend.
      </p>
      {!draft.base && (
        <p>
          Bei diesem älteren Entwurf fehlt die Ausgangsversion. Prüfe deshalb
          jeden Unterschied einzeln.
        </p>
      )}
      <h3>Änderungen gegenüber der aktuellen Veröffentlichung</h3>
      <p>
        {automatic.length} automatisch übernommene Änderungen ·{" "}
        {result.conflicts.length} Konflikte zur Entscheidung. Alle übrigen
        veröffentlichten Werte bleiben erhalten.
      </p>
      {Object.entries(groups).map(([group, items]) => (
        <Collapsible.Root
          className="publication-change-group"
          key={group}
          defaultOpen
        >
          <Collapsible.Trigger className="admin-disclosure-trigger">
            {group} · {items.length}
          </Collapsible.Trigger>
          <Collapsible.Panel keepMounted className="admin-disclosure-panel">
            {items.map((item) => (
              <div className="publication-conflict" key={item.key}>
                <h3>{label(item, documents)}</h3>
                <div className="publication-compare">
                  <div>
                    <strong>Aktuell veröffentlicht</strong>
                    <Value
                      item={item}
                      value={item.current}
                      document={current.document}
                      defaults={defaults}
                      documents={documents}
                    />
                  </div>
                  <div>
                    <strong>Nach Übernahme des Entwurfs</strong>
                    <Value
                      item={item}
                      value={item.local}
                      document={result.document}
                      defaults={defaults}
                      documents={documents}
                    />
                  </div>
                </div>
              </div>
            ))}
          </Collapsible.Panel>
        </Collapsible.Root>
      ))}
      {result.conflicts.map((item) => (
        <div className="publication-conflict" key={item.key}>
          <h3>{label(item, documents)}</h3>
          <div className="publication-compare">
            <div>
              <strong>{item.localLabel || "Dein Entwurf"}</strong>
              <Value
                item={item}
                value={item.local}
                document={draft.document}
                defaults={defaults}
                documents={documents}
              />
            </div>
            <div>
              <strong>{item.currentLabel || "Aktuell veröffentlicht"}</strong>
              <Value
                item={item}
                value={item.current}
                document={existingDraft?.document || current.document}
                defaults={defaults}
                documents={documents}
              />
            </div>
          </div>
          <Choice
            label={`Wert wählen: ${label(item, documents)}`}
            value={choices[item.key] || ""}
            options={[
              ["", "Bitte entscheiden"],
              ["local", `${item.localLabel || "Meinen Wert"} übernehmen`],
              [
                "current",
                `${item.currentLabel || "Veröffentlichten Wert"} behalten`,
              ],
            ]}
            onChange={(value) =>
              setChoices((old) => ({
                ...Object.fromEntries(
                  Object.entries(old).filter(
                    ([key]) =>
                      !item.key.startsWith("workspace:") ||
                      !key.startsWith("file:"),
                  ),
                ),
                [item.key]: value,
              }))
            }
          />
        </div>
      ))}
      <p role="status">
        {result.conflicts.length
          ? `${remaining} Konflikte offen`
          : automatic.length
            ? "Es gibt keine widersprüchlichen Änderungen. Prüfe die Werte oben, bevor du sie übernimmst."
            : "Keine Änderungen gegenüber der aktuellen Veröffentlichung."}
      </p>
      <div className="admin-actions">
        <Button
          className="admin-button admin-button--primary"
          disabled={remaining > 0}
          onClick={() => onAccept(result.document, current)}
        >
          Zusammengeführten Entwurf übernehmen
        </Button>
        <Button onClick={exportDraft}>Browserentwurf als Datei sichern</Button>
        <Button onClick={onCancel}>Zurück zum Entwurf</Button>
      </div>
    </section>
  );
}
