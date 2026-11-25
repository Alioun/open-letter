import { Input } from "@base-ui/react/input";
import { useEffect, useState, useRef, useId } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Button } from "@base-ui/react/button";
import { validRichLink } from "../../config/rich-links.js";
import { Choice } from "../ui.jsx";
import { templateTokenContent } from "../../config/template-placeholders.js";

const icons = {
  toggleBold: <strong>B</strong>,
  toggleItalic: <em>I</em>,
  toggleBulletList: (
    <svg viewBox="0 0 24 24">
      <path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1" />
    </svg>
  ),
  toggleOrderedList: (
    <svg viewBox="0 0 24 24">
      <path d="M10 6h11M10 12h11M10 18h11M3 4h1v5M3 13c3-2 4 1 1 3l-1 2h3" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24">
      <path d="m10 13 4-4M9 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24">
      <path d="m9 4-5 5 5 5M4 9h10a6 6 0 0 1 0 12" />
    </svg>
  ),
};

export default function RichField({
  value = "",
  onChange,
  label = "Formatierter Text",
  invalid = false,
  linkTargets = [],
  variables = [],
}) {
  const [link, setLink] = useState(null);
  const [linkError, setLinkError] = useState("");
  const [formattingOpen, setFormattingOpen] = useState(false);
  const formattingId = useId();
  const linkField = useRef(null);
  const linkTrigger = useRef(null);
  const linkErrorId = useId();
  useEffect(() => {
    if (link !== null) linkField.current?.focus();
  }, [link !== null]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        protocols: ["https", "mailto"],
        isAllowedUri: (value) => validRichLink(value, linkTargets),
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        "aria-invalid": String(invalid),
      },
    },
  });
  useEffect(() => {
    if (editor && editor.getHTML() !== value)
      editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);
  return (
    <div className="publication-rich-field">
      <Button
        className="admin-button admin-button--small admin-button--block rich-format-toggle"
        aria-expanded={formattingOpen}
        aria-controls={formattingId}
        onClick={() => setFormattingOpen((open) => !open)}
      >
        {variables.length ? "Formatierung und Platzhalter" : "Formatierung"}
        <span aria-hidden="true">{formattingOpen ? "▴" : "▾"}</span>
      </Button>
      <div
        id={formattingId}
        className="rich-formatting"
        data-open={formattingOpen || undefined}
      >
        <div className="admin-actions">
          {[
            ["Fett", "toggleBold", "bold"],
            ["Kursiv", "toggleItalic", "italic"],
            ["Liste", "toggleBulletList", "bulletList"],
            [
              "Nummerierte Liste",
              "toggleOrderedList",
              "orderedList",
              "Nummern",
            ],
          ].map(([label, command, mark, shortLabel]) => (
            <Button
              key={command}
              aria-label={label}
              title={label}
              aria-pressed={editor?.isActive(mark) || false}
              onClick={() => editor?.chain().focus()[command]().run()}
            >
              <span className="rich-tool-icon" aria-hidden="true">
                {icons[command]}
              </span>
              <span className="rich-tool-label">{shortLabel || label}</span>
            </Button>
          ))}
          <Button
            ref={linkTrigger}
            aria-label="Link"
            title="Link"
            onClick={() => {
              setLinkError("");
              setLink(editor?.getAttributes("link").href || "");
            }}
          >
            <span className="rich-tool-icon" aria-hidden="true">
              {icons.link}
            </span>
            <span className="rich-tool-label">Link</span>
          </Button>
          <Button
            aria-label="Rückgängig"
            title="Rückgängig"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <span className="rich-tool-icon" aria-hidden="true">
              {icons.undo}
            </span>
            <span className="rich-tool-label">Rückgängig</span>
          </Button>
        </div>
        {variables.length > 0 && (
          <div className="rich-variable-picker">
            <Choice
              label="Persönliche Angabe oder Link einfügen"
              value=""
              options={[["", "Angabe oder Link einfügen…"], ...variables]}
              onChange={(token) => {
                const content = templateTokenContent(token);
                if (content)
                  editor?.chain().focus().insertContent(content).run();
              }}
            />
          </div>
        )}
      </div>
      {link !== null && (
        <div className="publication-rich-link">
          <label>
            Linkadresse
            <Input
              ref={linkField}
              type="text"
              inputMode="url"
              aria-invalid={Boolean(linkError)}
              aria-describedby={linkError ? linkErrorId : undefined}
              value={link}
              placeholder="https://example.org"
              onChange={(e) => {
                setLink(e.target.value);
                setLinkError("");
              }}
            />
          </label>
          {linkTargets.length > 0 && (
            <label>
              Persönlichen Link einsetzen
              <Choice
                label="Persönlichen Link einsetzen"
                value={
                  linkTargets.some(([target]) => target === link) ? link : ""
                }
                onChange={(value) => {
                  if (value) setLink(value);
                  setLinkError("");
                }}
                options={[["", "Link auswählen…"], ...linkTargets]}
              />
            </label>
          )}
          {linkError && (
            <p id={linkErrorId} className="admin-field-error" role="alert">
              {linkError}
            </p>
          )}
          <div className="publication-rich-link-actions">
            <Button
              className="admin-button"
              onClick={() => {
                if (validRichLink(link, linkTargets)) {
                  editor
                    ?.chain()
                    .focus()
                    .extendMarkRange("link")
                    .setLink({ href: link })
                    .run();
                  setLink(null);
                } else {
                  setLinkError(
                    "Bitte eine vollständige Adresse mit https:// oder einen Link mit /, #, mailto: oder tel: eingeben.",
                  );
                  linkField.current?.focus();
                }
              }}
            >
              Link übernehmen
            </Button>
            <Button
              className="admin-button"
              onClick={() => {
                editor
                  ?.chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLink(null);
              }}
            >
              Link entfernen
            </Button>
            <Button
              className="admin-button"
              onClick={() => {
                setLink(null);
                linkTrigger.current?.focus();
              }}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
