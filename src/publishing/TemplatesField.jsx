import { Collapsible } from "@base-ui/react/collapsible";
import { Input } from "@base-ui/react/input";
import { useEffect, useState, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { Choice } from "../ui.jsx";
import RichField from "./RichField.jsx";
import {
  TEMPLATE_LINKS,
  TEMPLATE_VALUES,
  templateTokenLabel,
  templateTokenContent,
  appendTemplateToken,
} from "../../config/template-placeholders.js";
import { isCampaignTemplate } from "../../config/campaign-templates.js";
import { LANGUAGES, DEFAULT_LANG } from "../../config/letter.config.js";
import {
  systemTemplateBase,
  systemTemplateSlug,
  createSystemTranslation,
  allocateTemplateId,
} from "../../config/template-localization.js";

export default function TemplatesField({
  selection,
  onSelectionChange,
  templates,
  publishedTemplates,
  nextTemplateId,
  issues,
  change,
  api,
}) {
  const { slug: selected, language } = selection;
  const [translationStatus, setTranslationStatus] = useState("");
  const subjectField = useRef(null);
  const focusTranslation = useRef(false);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const source = templates.find((t) => t.slug === selected) || templates[0];
  const baseSlug = source && systemTemplateBase(source.slug, LANGUAGES);
  const template = baseSlug
    ? templates.find(
        (t) => t.slug === systemTemplateSlug(baseSlug, language, DEFAULT_LANG),
      )
    : source;
  const previewTemplate =
    template || (baseSlug && templates.find((t) => t.slug === baseSlug));
  const entries = templates.filter(
    (t) =>
      !systemTemplateBase(t.slug, LANGUAGES) ||
      systemTemplateBase(t.slug, LANGUAGES) === t.slug,
  );
  let allocationError = "";
  try {
    allocateTemplateId([...publishedTemplates, ...templates], nextTemplateId);
  } catch (error) {
    allocationError = error.message;
  }
  function select(slug) {
    onSelectionChange({ slug, language: DEFAULT_LANG });
    setTranslationStatus("");
  }
  const index = templates.indexOf(template);
  const issue = issues.find((item) => item.id === template?.id);
  const original =
    publishedTemplates.find((t) => t.id === template?.id) ||
    (baseSlug && templates.find((t) => t.slug === baseSlug));
  const variables = [...TEMPLATE_VALUES, ...TEMPLATE_LINKS].filter(
    ([token]) =>
      String(original?.html_body || template?.html_body || "").includes(
        token,
      ) ||
      (isCampaignTemplate(template) &&
        [
          "{{name}}",
          "{{firstName}}",
          "{{signerCount}}",
          "{{unsubscribeUrl}}",
        ].includes(token)),
  );
  useEffect(() => {
    if (!template) setTranslationStatus("");
    if (focusTranslation.current && template) {
      focusTranslation.current = false;
      subjectField.current?.focus();
    }
  }, [template?.id]);
  useEffect(() => {
    setPreview("");
    setPreviewSubject("");
    setPreviewError(false);
    if (!previewTemplate) {
      setPreviewStatus("");
      return;
    }
    setPreviewStatus("Vorschau wird aktualisiert…");
    let cancelled = false;
    const timer = setTimeout(
      () =>
        api("/api/admin/preview", {
          method: "POST",
          body: JSON.stringify({
            html_body: previewTemplate.html_body,
            subject: previewTemplate.subject,
            lang: baseSlug ? language : DEFAULT_LANG,
          }),
        })
          .then(async (r) => {
            if (!r.ok) throw new Error("Vorschau konnte nicht geladen werden.");
            return r.json();
          })
          .then((data) => {
            if (typeof data.html !== "string" || !data.html)
              throw new Error("Ungültige Vorschau");
            if (!cancelled) {
              setPreviewSubject(data.subject || "");
              setPreview(data.html);
              setPreviewStatus("");
            }
          })
          .catch(() => {
            if (!cancelled) {
              setPreviewError(true);
              setPreviewStatus(
                "Vorschau konnte nicht geladen werden. Lade sie erneut; dein Entwurf bleibt erhalten.",
              );
            }
          }),
      350,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    previewTemplate?.html_body,
    previewTemplate?.subject,
    previewTemplate?.id,
    language,
    api,
    previewAttempt,
  ]);
  return (
    <div className="publication-template-grid">
      <aside>
        {issues.length > 0 && (
          <div className="template-issues" role="alert">
            <strong>Veröffentlichung gesperrt</strong>
            {issues.map((item) => (
              <Button
                key={item.id}
                onClick={() => {
                  const target = templates.find((t) => t.id === item.id);
                  const base = systemTemplateBase(target.slug, LANGUAGES);
                  onSelectionChange({
                    slug: base || target.slug,
                    language:
                      base && base !== target.slug
                        ? target.slug.slice(base.length + 1)
                        : DEFAULT_LANG,
                  });
                }}
              >
                {item.name} reparieren
              </Button>
            ))}
          </div>
        )}
        <div className="admin-mobile-section">
          <label>E-Mail-Vorlage</label>
          <Choice
            label="E-Mail-Vorlage"
            value={baseSlug || source?.slug || ""}
            onChange={select}
            options={entries.map((t) => [t.slug, t.name])}
          />
        </div>
        <Collapsible.Root className="template-create">
          <Collapsible.Trigger className="admin-disclosure-trigger">
            Neue Newsletter-Vorlage
          </Collapsible.Trigger>
          <Collapsible.Panel keepMounted className="admin-disclosure-panel">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim() || allocationError) return;
                const slug = `newsletter-${crypto.randomUUID()}`;
                change((d) => {
                  d.templates.push({
                    id: allocateTemplateId(
                      [...publishedTemplates, ...d.templates],
                      nextTemplateId,
                    ),
                    slug,
                    name: name.trim(),
                    subject: name.trim(),
                    html_body:
                      '<p>Hello {{firstName}},</p><p>Your update.</p><p><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>',
                  });
                });
                select(slug);
                setName("");
              }}
            >
              <label>
                Name
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              {allocationError && <p role="status">{allocationError}</p>}
              <Button type="submit" disabled={Boolean(allocationError)}>
                Im Entwurf anlegen
              </Button>
            </form>
          </Collapsible.Panel>
        </Collapsible.Root>
        <nav aria-label="E-Mail-Vorlagen">
          {entries.map((t) => (
            <Button
              key={t.id}
              aria-pressed={t.slug === (baseSlug || source?.slug)}
              onClick={() => select(t.slug)}
            >
              {t.name}
              <small>
                {isCampaignTemplate(t)
                  ? "Newsletter-Vorlage"
                  : "Systemnachricht"}
              </small>
            </Button>
          ))}
        </nav>
      </aside>
      <div>
        {baseSlug && (
          <div className="template-language">
            <div className="template-language-row">
              <label>Sprache</label>
              <Choice
                label="Sprache der Systemnachricht"
                value={language}
                options={LANGUAGES.map((lang) => [
                  lang,
                  `${lang.toUpperCase()} · ${templates.some((t) => t.slug === systemTemplateSlug(baseSlug, lang, DEFAULT_LANG)) ? "Eigene Vorlage" : `Ersatzvorlage in ${DEFAULT_LANG.toUpperCase()}`}`,
                ])}
                onChange={(lang) => {
                  onSelectionChange({ slug: selected, language: lang });
                  setTranslationStatus("");
                }}
              />
            </div>
            {!template && (
              <div className="template-fallback-notice" role="status">
                <p>
                  Für {language.toUpperCase()} fehlt diese Systemnachricht. Der
                  Versand verwendet derzeit die Vorlage in{" "}
                  {DEFAULT_LANG.toUpperCase()}.
                </p>
                <Button
                  disabled={Boolean(allocationError)}
                  onClick={() => {
                    focusTranslation.current = true;
                    change((d) => {
                      d.templates.push(
                        createSystemTranslation(
                          d.templates,
                          baseSlug,
                          language,
                          LANGUAGES,
                          allocateTemplateId(
                            [...publishedTemplates, ...d.templates],
                            nextTemplateId,
                          ),
                        ),
                      );
                    });
                    setTranslationStatus(
                      `Kopie aus ${DEFAULT_LANG.toUpperCase()} angelegt. Übersetze Betreff und Nachricht vor der Veröffentlichung.`,
                    );
                  }}
                >
                  Übersetzung für {language.toUpperCase()} anlegen
                </Button>
                {allocationError && <p>{allocationError}</p>}
              </div>
            )}
            {template && translationStatus && (
              <p role="status">{translationStatus}</p>
            )}
          </div>
        )}
        {template && (
          <div>
            <label>
              Betreff
              <Input
                ref={subjectField}
                value={template.subject}
                onChange={(e) =>
                  change((d) => {
                    d.templates[index].subject = e.target.value;
                  })
                }
              />
            </label>
            <RichField
              key={template.id}
              label={`E-Mail-Nachricht · ${template.name}${baseSlug ? ` · ${language.toUpperCase()}` : ""}`}
              invalid={Boolean(issue)}
              linkTargets={TEMPLATE_LINKS.filter(([token]) =>
                variables.some(([value]) => value === token),
              )}
              variables={variables}
              value={template.html_body}
              onChange={(html) =>
                change((d) => {
                  d.templates[index].html_body = html;
                })
              }
            />
            {issue && (
              <div className="email-failure" role="alert">
                <strong>Erforderliche Bestandteile fehlen</strong>
                <ul>
                  {issue.missing.map((token) => (
                    <li key={token}>
                      {templateTokenLabel(token)}
                      {templateTokenContent(token) && (
                        <Button
                          className="admin-button"
                          aria-label={`${templateTokenLabel(token)} ergänzen`}
                          onClick={() =>
                            change((d) => {
                              d.templates[index].html_body =
                                appendTemplateToken(
                                  d.templates[index].html_body,
                                  token,
                                );
                            })
                          }
                        >
                          Fehlenden Bestandteil ergänzen
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <p>
                  Veröffentlichen ist gesperrt.{" "}
                  {original
                    ? 'Ergänze die fehlenden Links oder Platzhalter einzeln. Sie erscheinen am Ende der Nachricht und lassen sich im Editor verschieben. Dein Text bleibt erhalten. Du kannst stattdessen den gesamten Nachrichtentext zurücksetzen und dies mit "Rückgängig" widerrufen.'
                    : "Ergänze den Abmeldelink. Dein Text bleibt erhalten."}
                </p>
                {original && (
                  <Button
                    onClick={() =>
                      change((d) => {
                        d.templates[index].html_body = original.html_body;
                      })
                    }
                  >
                    Gesamten Nachrichtentext zurücksetzen
                  </Button>
                )}
              </div>
            )}
            <p>
              Vor der Veröffentlichung prüft die Verwaltung die erforderlichen
              Links und Platzhalter. Beim Versand setzt die Vorlage die Angaben
              der Person ein.
            </p>
            <Collapsible.Root className="template-variable-help">
              <Collapsible.Trigger className="admin-disclosure-trigger">
                Verfügbare Platzhalter
              </Collapsible.Trigger>
              <Collapsible.Panel keepMounted className="admin-disclosure-panel">
                <div className="publication-variable-list">
                  {variables.map(([token, explanation]) => (
                    <div key={token}>
                      <strong>{explanation}</strong>
                      <code>{token}</code>
                    </div>
                  ))}
                </div>
              </Collapsible.Panel>
            </Collapsible.Root>
            {template.slug.startsWith("newsletter-") && (
              <Button
                onClick={() =>
                  change((d) => {
                    d.templates.splice(index, 1);
                  })
                }
              >
                Aus Entwurf entfernen
              </Button>
            )}
          </div>
        )}
        {previewTemplate && (
          <div className="template-effective-preview">
            <h3>
              {template
                ? "Vorschau mit Beispieldaten"
                : `Verwendete Ersatzvorlage · ${DEFAULT_LANG.toUpperCase()}`}
            </h3>
            {!template && (
              <p>
                <strong>Betreffvorlage:</strong> {previewTemplate.subject}
                <br />
                Die Vorschau zeigt die Ersatzvorlage aus deinem Entwurf. Nach
                der Veröffentlichung verwendet der Versand diese Version.
              </p>
            )}
            {previewStatus && (
              <p role={previewError ? "alert" : "status"}>{previewStatus}</p>
            )}
            {previewError && (
              <Button onClick={() => setPreviewAttempt((n) => n + 1)}>
                Vorschau erneut laden
              </Button>
            )}
            {preview && (
              <div>
                <p>
                  <strong>Beispielbetreff:</strong> {previewSubject}
                </p>
                <iframe
                  title={`E-Mail mit Beispieldaten${!template ? ` · ${language.toUpperCase()} mit Ersatzvorlage ${DEFAULT_LANG.toUpperCase()}` : ""}`}
                  sandbox=""
                  srcDoc={preview}
                  className="publication-email-preview"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
