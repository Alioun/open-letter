import { PUBLICATION_VERSION } from "../../config/publication.js";
import { useEffect, useState, useRef } from "react";
const KEY = "open-letter-publication-draft-v2";

// A draft keeps the revision and the id of the publication it was made
// from. Both have to be the current publication's for the draft to be
// published: after a backup is restored, another publication can have the
// same revision number.
export const draftIsStale = (draft, publication) =>
  draft.revision !== publication.revision || draft.id !== publication.id;

export function draftAfterPublication(current, publication, submitted) {
  const newerChanges =
    JSON.stringify(current.document) !== JSON.stringify(submitted);
  return {
    newerChanges,
    state: {
      document: newerChanges ? current.document : publication.document,
      base: publication.document,
      revision: publication.revision,
      id: publication.id,
    },
  };
}

export function usePublicationDraft(publication) {
  const [state, setState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (
        saved?.document?.schemaVersion === PUBLICATION_VERSION &&
        Number.isInteger(saved.revision)
      )
        return saved;
    } catch {}
    return {
      document: publication.document,
      base: publication.document,
      revision: publication.revision,
      id: publication.id,
    };
  });
  const [storageWarning, setStorageWarning] = useState("");
  const [history, setHistory] = useState([]);
  const latestState = useRef(state);
  latestState.current = state;
  const dirty =
    JSON.stringify(state.document) !== JSON.stringify(publication.document);
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(KEY, JSON.stringify(state));
      else localStorage.removeItem(KEY);
      setStorageWarning("");
    } catch {
      setStorageWarning(
        'Der Browser konnte den Entwurf nicht speichern. Lass diesen Tab geöffnet. Wähle unter "Weitere Aktionen" die Option "Entwurf als Datei sichern", bevor du ihn schließt.',
      );
    }
  }, [state, dirty]);
  useEffect(() => {
    const guard = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const change = (fn) =>
    setState((old) => {
      const document = structuredClone(old.document);
      fn(document);
      if (JSON.stringify(document) === JSON.stringify(old.document)) return old;
      setHistory((h) => [...h.slice(-39), old.document]);
      return { ...old, document };
    });
  return {
    ...state,
    dirty,
    canUndo: history.length > 0,
    rebase(document, current) {
      setHistory((h) => [...h.slice(-39), state.document]);
      setState({
        document,
        base: current.document,
        revision: current.revision,
        id: current.id,
      });
    },
    storageWarning,
    change,
    undo() {
      if (history.length) {
        setState((s) => ({ ...s, document: history.at(-1) }));
        setHistory((h) => h.slice(0, -1));
      }
    },
    reset() {
      setState({
        document: publication.document,
        base: publication.document,
        revision: publication.revision,
        id: publication.id,
      });
      setHistory([]);
      try {
        localStorage.removeItem(KEY);
      } catch {}
    },
    published(next, submitted) {
      const result = draftAfterPublication(
        latestState.current,
        next,
        submitted,
      );
      setState(result.state);
      if (!result.newerChanges) {
        setHistory([]);
        try {
          localStorage.removeItem(KEY);
        } catch {}
      }
      return result.newerChanges;
    },
  };
}
