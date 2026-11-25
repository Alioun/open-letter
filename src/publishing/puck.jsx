import { Input } from "@base-ui/react/input";
import { Puck, createUsePuck } from "@puckeditor/core";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import App from "../App.jsx";
import { Section } from "../SectionRenderer.jsx";
import { Choice } from "../ui.jsx";
import FaqField from "./FaqField.jsx";
import RichField from "./RichField.jsx";
import {
  anchorLayout,
  BLOCK_DEFAULTS,
  FIXED,
  SECTION_TYPES,
} from "../../config/publication.js";
import { themeCss } from "../../config/theme-css.js";
import { updateLayout } from "./layout.js";
import "@puckeditor/core/puck.css";

// The editor canvas renders the public page, so it loads the public
// stylesheets (filled in by admin-main from the server) instead of
// mirroring the admin's own styles.
export const previewStylesheets = [];
const usePuck = createUsePuck();
const EditorContext = createContext(null);
const SECTION_LABELS = {
  Header: "Kopfzeile",
  Hero: "Titel & Unterschriftenzahl",
  Letter: "Offener Brief",
  Sign: "Unterschreiben",
  Signers: "Unterzeichner*innen",
  Faq: "Fragen & Antworten",
  Meeting: "Treffen",
  Text: "Textabschnitt",
  Image: "Bild",
  CallToAction: "Aufruf",
  Footer: "Fußzeile",
};

// Puck's own interface texts (lib/dictionary.ts in @puckeditor/core).
const PUCK_DE = {
  "header-undo": "Rückgängig",
  "header-redo": "Wiederholen",
  "header-toggle-leftsidebar": "Linke Seitenleiste ein- oder ausblenden",
  "header-toggle-rightsidebar": "Rechte Seitenleiste ein- oder ausblenden",
  "header-toggle-menubar": "Menü ein- oder ausblenden",
  "action-selectparent": "Übergeordneten Abschnitt wählen",
  "action-drag": "Zum Verschieben ziehen",
  "action-duplicate": "Duplizieren",
  "action-delete": "Löschen",
  "label-page": "Seite",
  "label-component": "Abschnitt",
  "outline-empty": "Keine Abschnitte",
  "outline-item-collapse": "Einklappen",
  "outline-item-expand": "Ausklappen",
  "outline-header-title": "Gliederung",
  "outline-header-collapseall": "Alle einklappen",
  "outline-item-duplicate": "Duplizieren",
  "outline-item-delete": "Löschen",
  "drawer-category-collapse": "{title} einklappen",
  "drawer-category-expand": "{title} ausklappen",
  "drawer-category-other": "Weitere",
  "canvas-noconfig": "Keine Einstellungen für {type}",
  "field-readonly": "Nur lesen",
  "viewport-zoom-in": "Vergrößern",
  "viewport-zoom-out": "Verkleinern",
  "viewport-zoom-auto": "{zoom} % (auto)",
  "viewport-toggle-menu": "Ansichten ein- oder ausblenden",
  "viewport-switch": "Zur Ansicht {label} wechseln",
  "viewport-switch-default": "Ansicht wechseln",
  "plugin-blocks": "Abschnitte",
  "plugin-outline": "Gliederung",
  "plugin-fields": "Felder",
  "plugin-components": "Abschnitte",
  "layout-maximize": "Maximieren",
  "layout-minimize": "Minimieren",
  "loader-loading": "Wird geladen",
};

function LayoutSync({ layout }) {
  const data = usePuck((state) => state.appState.data);
  const dispatch = usePuck((state) => state.dispatch);
  const selected = usePuck((state) => state.selectedItem);
  const { pendingSection, setPendingSection, editorRoot } =
    useContext(EditorContext);
  useEffect(() => {
    if (JSON.stringify(anchorLayout(data)) !== JSON.stringify(layout))
      dispatch({ type: "setData", data: layout, recordHistory: false });
  }, [layout, dispatch]);
  useEffect(() => {
    if (!pendingSection) return;
    const index = data.content.findIndex(
      (block) => block.props.id === pendingSection,
    );
    if (index >= 0)
      dispatch({
        type: "setUi",
        ui: {
          itemSelector: { index },
          rightSideBarVisible: true,
          leftSideBarVisible: matchMedia("(width < 638px)").matches,
          plugin: { current: "fields" },
          mobilePanelExpanded: true,
        },
        recordHistory: false,
      });
  }, [data, pendingSection, dispatch]);
  useEffect(() => {
    if (!pendingSection || selected?.props.id !== pendingSection) return;
    const sidebar = editorRoot.current?.querySelector(
      matchMedia("(width < 638px)").matches
        ? '[class*="Sidebar--left"]'
        : '[class*="Sidebar--right"]',
    );
    if (!sidebar) return;
    const focusField = () => {
      if (sidebar.getBoundingClientRect().height < 80) return;
      const fields = sidebar.querySelectorAll(
        '.publication-localized-field [contenteditable="true"], .publication-localized-field input, .publication-localized-field button',
      );
      const visible = [...(fields || [])].filter(
        (element) => element.getClientRects().length > 0,
      );
      const field =
        visible.find(
          (element) => element.isContentEditable || element.matches("input"),
        ) || visible[0];
      if (!field) return;
      field?.scrollIntoView({ block: "center" });
      field?.focus({ preventScroll: true });
      setPendingSection(null);
    };
    const observer = new ResizeObserver(focusField);
    observer.observe(sidebar);
    const frame = requestAnimationFrame(focusField);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pendingSection, selected?.props.id, editorRoot, setPendingSection]);
  return null;
}

function createPuckConfig(showMeeting) {
  const select = (label, options) => ({
    type: "custom",
    render: ({ value, onChange }) => (
      <label className="publication-property-field">
        <span>{label}</span>
        <Choice
          label={label}
          value={value}
          onChange={onChange}
          options={options.map((v) => [
            v,
            {
              stacked: "Untereinander",
              split: "Nebeneinander",
              narrow: "Schmal",
              wide: "Breit",
              full: "Volle Breite",
              left: "Links",
              center: "Mittig",
              right: "Rechts",
              body: "Fließtext",
              display: "Überschrift",
            }[v] || v,
          ])}
        />
      </label>
    ),
  });
  const number = (label, min, max) => ({
    type: "custom",
    render: ({ value, onChange }) => (
      <label className="publication-property-field">
        <span>{label}</span>
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    ),
  });
  const appearanceFields = {
    arrangement: select("Anordnung", ["stacked", "split"]),
    width: select("Breite", ["narrow", "wide", "full"]),
    align: select("Ausrichtung", ["left", "center", "right"]),
    font: select("Schrift", ["body", "display"]),
    spacing: number("Abstand", 0, 160),
    fontSize: number("Schriftgröße", 12, 96),
    ...Object.fromEntries(
      ["background", "color"].map((key) => [
        key,
        {
          type: "custom",
          render: ({ value, onChange }) => (
            <label className="publication-property-field">
              <span>
                {key === "background" ? "Hintergrundfarbe" : "Textfarbe"}
              </span>
              <Input
                value={value || ""}
                placeholder="#ffffff"
                onChange={(e) => onChange(e.target.value)}
              />
            </label>
          ),
        },
      ]),
    ),
  };
  const puckConfig = {
    root: { fields: {} },
    components: Object.fromEntries(
      SECTION_TYPES.filter((type) => type !== "Meeting" || showMeeting).map(
        (type) => [
          type,
          {
            label: SECTION_LABELS[type],
            defaultProps: { ...BLOCK_DEFAULTS },
            permissions: {
              delete: !FIXED[type],
              duplicate: !FIXED[type],
              drag: !["Header", "Hero", "Footer"].includes(type),
              insert: !FIXED[type],
            },
            fields: {
              localized: {
                type: "custom",
                render: ({ id }) => {
                  const { document, lang, change, editCopy } =
                    useContext(EditorContext);
                  // Custom fields operate on localized block content, never a second layout document.
                  const selected = usePuck((state) => state.selectedItem);
                  const block = document.layout.content.find(
                    (b) => b.props.id === selected?.props.id,
                  );
                  const blockId = block?.props.id || id;
                  const text = document.locales[lang].blocks[blockId] || {};
                  const update = (key, value) =>
                    change((d) => {
                      d.locales[lang].blocks[blockId] = {
                        ...d.locales[lang].blocks[blockId],
                        [key]: value,
                      };
                    });
                  if (type === "Faq")
                    return (
                      <FaqField
                        value={text}
                        onChange={(value) =>
                          change((d) => {
                            d.locales[lang].blocks[blockId] = value;
                          })
                        }
                      />
                    );
                  if (["Letter", "Text"].includes(type))
                    return (
                      <div className="publication-localized-field">
                        <RichField
                          label={
                            type === "Letter" ? "Briefinhalt" : "Textabschnitt"
                          }
                          value={text.html}
                          onChange={(v) => update("html", v)}
                        />
                      </div>
                    );
                  if (type === "Image")
                    return (
                      <div className="publication-localized-field">
                        <label>
                          Bildquelle
                          <Choice
                            label="Bildquelle"
                            value={text.src || ""}
                            options={[
                              ["", "Hochgeladenes Bild wählen"],
                              ...document.assets.map((a) => [a, a]),
                            ]}
                            onChange={(v) => update("src", v)}
                          />
                        </label>
                        <label>
                          Alternativtext
                          <Input
                            value={text.alt || ""}
                            onChange={(e) => update("alt", e.target.value)}
                          />
                        </label>
                      </div>
                    );
                  if (type === "CallToAction")
                    return (
                      <div className="publication-localized-field">
                        {["title", "text", "href", "label"].map((key) => (
                          <label key={key}>
                            {
                              {
                                title: "Überschrift",
                                text: "Beschreibung",
                                href: "Linkziel",
                                label: "Beschriftung der Schaltfläche",
                              }[key]
                            }
                            <Input
                              value={text[key] || ""}
                              onChange={(e) => update(key, e.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    );
                  const group = {
                    Header: "nav",
                    Hero: "hero",
                    Sign: "sign",
                    Signers: "list",
                    Meeting: "zoom",
                    Footer: "footer",
                  }[type];
                  return (
                    <Button onClick={() => editCopy(group || "all")}>
                      Texte dieses Abschnitts bearbeiten
                    </Button>
                  );
                },
              },
              appearance: {
                type: "custom",
                render: function AppearanceField() {
                  const { document, change } = useContext(EditorContext);
                  const selected = usePuck((state) => state.selectedItem);
                  const block = document.layout.content.find(
                    (b) => b.props.id === selected?.props.id,
                  );
                  if (!block) return null;
                  return (
                    <Collapsible.Root className="publication-appearance-fields">
                      <Collapsible.Trigger className="admin-disclosure-trigger">
                        Gestaltung & Abstände
                      </Collapsible.Trigger>
                      <Collapsible.Panel>
                        {Object.entries(appearanceFields).map(
                          ([key, field]) => {
                            const Field = field.render;
                            return (
                              <Field
                                key={key}
                                value={block.props[key]}
                                onChange={(value) =>
                                  change((d) => {
                                    const target = d.layout.content.find(
                                      (b) => b.props.id === block.props.id,
                                    );
                                    target.props[key] = value;
                                  })
                                }
                              />
                            );
                          },
                        )}
                      </Collapsible.Panel>
                    </Collapsible.Root>
                  );
                },
              },
            },
            render: (props) => {
              const { config } = useContext(EditorContext);
              const block = { type, props };
              return FIXED[type] ? (
                <App preview previewConfig={config} onlySection={props.id} />
              ) : (
                <Section block={block} config={config} />
              );
            },
          },
        ],
      ),
    ),
  };
  // Navigation and legal chrome use the shared theme; only their copy is editable here.
  for (const type of ["Header", "Footer"])
    puckConfig.components[type].fields = {
      localized: puckConfig.components[type].fields.localized,
    };
  return puckConfig;
}

// Publishing and undo live above the editor, for the whole draft; the
// header only keeps Puck in step with the draft's layout.
const editorOverrides = {
  headerActions: function HeaderActions() {
    const { document } = useContext(EditorContext);
    return <LayoutSync layout={document.layout} />;
  },
  iframe: function PreviewFrame({ children, document: frame }) {
    const { document } = useContext(EditorContext);
    // The letter stylesheet scopes its rules to <html data-letter>, which the
    // admin page itself does not carry.
    useEffect(() => {
      const letter = window.document.querySelector('meta[name="x-letter"]');
      if (frame && letter)
        frame.documentElement.dataset.letter = letter.content;
    }, [frame]);
    return (
      <>
        {previewStylesheets.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <style>{themeCss(document.appearance.theme)}</style>
        {children}
      </>
    );
  },
};

export default function VisualEditor({
  document,
  config,
  lang,
  change,
  sectionRequest,
  editCopy,
}) {
  const pendingDuplicate = useRef(null);
  const editorRoot = useRef(null);
  const [pendingSection, setPendingSection] = useState(null);
  useEffect(() => {
    if (sectionRequest) setPendingSection(sectionRequest.id);
  }, [sectionRequest]);
  const [addedSection, setAddedSection] = useState(null);
  const puckConfig = useMemo(
    () => createPuckConfig(config.features.zoomEvent),
    [config.features.zoomEvent],
  );
  return (
    <EditorContext.Provider
      value={{
        document,
        config,
        lang,
        change,
        editCopy,
        pendingSection,
        setPendingSection,
        editorRoot,
      }}
    >
      <div
        className="admin-actions publication-add-section"
        role="group"
        aria-label="Abschnitt hinzufügen"
      >
        <span>Abschnitt hinzufügen</span>
        {[
          ["Text", "Text"],
          ["Image", "Bild"],
          ["CallToAction", "Aufruf"],
        ].map(([type, label]) => (
          <Button
            key={type}
            className="admin-button admin-button--small"
            aria-label={`${label}-Abschnitt hinzufügen`}
            onClick={() => {
              const id = `${type}-${crypto.randomUUID()}`;
              setPendingSection(id);
              setAddedSection({ id, label });
              change((d) => {
                d.layout.content.splice(d.layout.content.length - 1, 0, {
                  type,
                  props: { ...BLOCK_DEFAULTS, id, spacing: 32 },
                });
                for (const [language, locale] of Object.entries(d.locales))
                  locale.blocks[id] =
                    type === "Text"
                      ? {
                          html:
                            language === "de"
                              ? "<p>Dein Text</p>"
                              : "<p>Your text</p>",
                        }
                      : type === "Image"
                        ? { src: "", alt: "" }
                        : {
                            title:
                              language === "de"
                                ? "Gemeinsam handeln"
                                : "Take action together",
                            text: "",
                            href: "#unterzeichnen",
                            label:
                              language === "de"
                                ? "Unterzeichnen"
                                : "Sign the letter",
                          };
              });
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {addedSection &&
        document.layout.content.some(
          (block) => block.props.id === addedSection.id,
        ) && (
          <p role="status">
            {addedSection.label}-Abschnitt hinzugefügt.{" "}
            {pendingSection
              ? "Die Inhaltsfelder werden geöffnet…"
              : "Die Inhaltsfelder sind geöffnet."}
          </p>
        )}
      <div ref={editorRoot}>
        <Puck
          height="max(640px, calc(100dvh - 120px))"
          headerTitle="Layout bearbeiten"
          config={puckConfig}
          data={document.layout}
          iframe={{ syncHostStyles: false }}
          onAction={(action, next, previous) => {
            if (action.type !== "duplicate") return;
            const source = previous.data.content[action.sourceIndex];
            const target = next.data.content.find(
              (block) =>
                !previous.data.content.some(
                  (old) => old.props.id === block.props.id,
                ),
            );
            if (source && target)
              pendingDuplicate.current = {
                sourceId: source.props.id,
                targetId: target.props.id,
              };
          }}
          onChange={(layout) => {
            const duplicate = pendingDuplicate.current;
            pendingDuplicate.current = null;
            change((d) => {
              updateLayout(d, layout, duplicate);
            });
          }}
          overrides={editorOverrides}
          dictionary={PUCK_DE}
          viewports={[
            { width: 360, height: "auto", label: "Smartphone" },
            { width: 768, height: "auto", label: "Tablet" },
            { width: 1440, height: "auto", label: "Desktop" },
          ]}
        />
      </div>
    </EditorContext.Provider>
  );
}
