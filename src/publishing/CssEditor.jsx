import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { css, cssCompletionSource } from "@codemirror/lang-css";
import { autocompletion } from "@codemirror/autocomplete";
import { linter, lintGutter } from "@codemirror/lint";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  cssDiagnostics,
  THEME_VARIABLES,
  SECTION_SELECTORS,
} from "../../config/css-policy.js";

export default function CssEditor({ value, onChange, assets }) {
  const host = useRef(null);
  const editor = useRef(null);
  const props = useRef({ onChange, assets });
  props.current = { onChange, assets };
  useEffect(() => {
    const suggestions = [...THEME_VARIABLES, ...SECTION_SELECTORS].map(
      (label) => ({
        label,
        type: label.startsWith("--") ? "variable" : "class",
      }),
    );
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          css(),
          lintGutter(),
          autocompletion({
            override: [
              (context) => {
                const word = context.matchBefore(/[\w\-\[\]="']*/);
                return word ? { from: word.from, options: suggestions } : null;
              },
              cssCompletionSource,
            ],
          }),
          linter((view) =>
            cssDiagnostics(view.state.doc.toString(), props.current.assets),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              props.current.onChange(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({
            "aria-label": "Eigenes CSS für die Website",
          }),
        ],
      }),
    });
    editor.current = view;
    return () => view.destroy();
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  return <div className="campaign-css-editor" ref={host} />;
}
