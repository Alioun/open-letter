import { useEffect, useId, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Input } from "@base-ui/react/input";
import { Collapsible } from "@base-ui/react/collapsible";
import cfg from "../config/letter.config.js";
import { useAdminRead, AdminReadStatus } from "./admin-read.jsx";
import { EmptyState, Notice } from "./ui.jsx";
import { logTime } from "./admin-log-format.js";
import FirstSignerAdd from "./FirstSignerAdd.jsx";
import FirstSignerImport from "./FirstSignerImport.jsx";
import {
  duplicatesOf,
  isFirstSignerList,
  linkDuplicate,
  moveItem,
  sameOrder,
  saveOrder,
} from "./first-signer-admin.js";

// The "Position" field of a signer row. Typing a number and leaving the
// field (or Enter) puts the signature there and moves the others down;
// emptying it takes the position away.
export function PositionField({ signer, disabled, onSet, compact = false }) {
  const id = useId();
  const saved = signer.position == null ? "" : String(signer.position);
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const commit = () => {
    const text = value.trim();
    if (text === saved) return;
    const position = text === "" ? null : Number(text);
    if (position !== null && !(Number.isInteger(position) && position >= 1)) {
      setValue(saved);
      return;
    }
    onSet(signer, position);
  };
  return (
    <span className={`signer-position${compact ? " is-compact" : ""}`}>
      <label htmlFor={id} className={compact ? "sr-only" : undefined}>
        Position{compact && ` von ${signer.name}`}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        placeholder="–"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </span>
  );
}

// "Mit Duplikat verknüpfen": the entry added by hand and the signature the
// person made themselves become one. Shows the candidates for `signer`.
export function LinkDuplicateDialog({
  api,
  signer,
  returnFocus,
  onClose,
  onLinked,
}) {
  const id = useId();
  const [candidates, setCandidates] = useState(null);
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    duplicatesOf(api, signer.id)
      .then((found) => current && setCandidates(found))
      .catch(
        () =>
          current &&
          setFailure("Die möglichen Duplikate konnten nicht geladen werden."),
      );
    return () => {
      current = false;
    };
  }, [api, signer.id]);

  async function link(candidate) {
    const [hand, real] = signer.handAdded
      ? [signer, candidate]
      : [candidate, signer];
    setBusy(true);
    setFailure(null);
    try {
      await linkDuplicate(api, hand.id, real.id);
      onLinked(
        `„${real.name}“ ist jetzt mit dem Eintrag von Hand verknüpft. Die eigene Unterschrift übernimmt Markierung und Position; der Eintrag von Hand ist gelöscht und zählt nicht mehr doppelt.`,
      );
    } catch (error) {
      setFailure(error.message);
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-modal-backdrop" />
        <Dialog.Popup
          className="admin-dialog admin-dialog--form"
          aria-labelledby={`${id}-title`}
          finalFocus={() => (returnFocus?.isConnected ? returnFocus : true)}
        >
          <h2 id={`${id}-title`}>Mögliches Duplikat verknüpfen</h2>
          <div className="admin-dialog-message">
            <p>
              {signer.handAdded
                ? `„${signer.name}“ wurde von Hand eingetragen. Diese Unterschriften mit demselben Namen kamen über das Formular:`
                : `„${signer.name}“ hat über das Formular unterschrieben. Diese Einträge mit demselben Namen wurden von Hand angelegt:`}
            </p>
            <p className="admin-muted">
              Ist es dieselbe Person, verknüpfe die beiden. Die Unterschrift aus
              dem Formular übernimmt die Markierung und die Position, der
              Eintrag von Hand wird gelöscht. So zählt die Person nur einmal.
              Was öffentlich steht, entscheiden weiter die Angaben der
              Unterschrift aus dem Formular.
            </p>
            {!candidates && !failure && (
              <p role="status" className="admin-muted">
                Wird geladen…
              </p>
            )}
            {candidates?.length === 0 && (
              <EmptyState
                compact
                title="Kein passender Eintrag mehr gefunden."
              />
            )}
            {candidates?.length > 0 && (
              <ul className="first-signer-candidates">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <span>
                      <strong>{candidate.name}</strong>
                      <span className="admin-muted">
                        {candidate.handAdded
                          ? `Von Hand eingetragen am ${logTime(candidate.createdAt)}`
                          : `${candidate.email} · unterschrieben am ${logTime(candidate.createdAt)}`}
                      </span>
                    </span>
                    <Button
                      type="button"
                      className="admin-button admin-button--primary admin-button--small"
                      disabled={busy}
                      onClick={() => link(candidate)}
                    >
                      Verknüpfen
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {failure && <Notice tone="error">{failure}</Notice>}
          </div>
          <div className="admin-actions">
            <Button type="button" className="admin-button" onClick={onClose}>
              Abbrechen
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function personLine(signer) {
  return [
    signer.handAdded ? "von Hand eingetragen" : null,
    !signer.firstSigner ? "nicht markiert" : null,
    !signer.showPublicly ? "nicht öffentlich" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// The place number in the order editor. Typing a number and pressing Enter
// (or leaving the field) moves the signature there; a number past the end
// moves it to the end.
function PlaceField({ signer, place, count, onMove }) {
  const id = useId();
  const [value, setValue] = useState(String(place));
  useEffect(() => setValue(String(place)), [place]);
  const commit = (keepFocus) => {
    const target = Number(value.trim());
    if (!Number.isInteger(target) || target < 1) {
      setValue(String(place));
      return;
    }
    if (Math.min(target, count) !== place)
      onMove(Math.min(target, count) - 1, keepFocus);
    else setValue(String(place));
  };
  return (
    <span className="first-signer-place">
      <label htmlFor={id} className="sr-only">
        Stelle von {signer.name}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={count}
        step={1}
        value={value}
        data-order-place={signer.id}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(true);
          }
        }}
      />
    </span>
  );
}

// The order editor: everyone with a position, rearranged by dragging, with
// the arrow buttons or by typing a place, and saved as a whole.
function OrderList({ api, data, onSaved }) {
  const [items, setItems] = useState(data.ordered);
  const [revision, setRevision] = useState(data.revision);
  const [dragging, setDragging] = useState(null);
  const [state, setState] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    setItems(data.ordered);
    setRevision(data.revision);
  }, [data]);
  const changed = !sameOrder(items, data.ordered);

  const move = (from, to, focus) => {
    if (to < 0 || to >= items.length) return;
    setItems(moveItem(items, from, to));
    setAnnouncement(`${items[from].name} steht jetzt an Stelle ${to + 1}.`);
    if (focus)
      requestAnimationFrame(() =>
        document
          .querySelector(
            focus === "place"
              ? `[data-order-place="${items[from].id}"]`
              : `[data-order-button="${items[from].id}-${focus}"]`,
          )
          ?.focus(),
      );
  };
  const addMarked = (signer) => {
    setItems([...items, signer]);
    setAnnouncement(
      `${signer.name} steht jetzt an Stelle ${items.length + 1}.`,
    );
  };

  async function save() {
    setState({ busy: true });
    try {
      const next = await saveOrder(
        api,
        items.map((item) => item.id),
        revision,
      );
      setState({ saved: true });
      onSaved(next);
    } catch (error) {
      setState({
        error: error.message,
        conflict: error.status === 409,
      });
    }
  }

  const unordered = data.marked.filter(
    (signer) => !items.some((item) => item.id === signer.id),
  );
  const dropped = data.ordered.filter(
    (signer) => !items.some((item) => item.id === signer.id),
  );

  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {items.length === 0 ? (
        <EmptyState compact title="Noch niemand hat eine feste Position.">
          Gib einer Unterschrift in der Liste unten eine Position oder wähle
          dort „Nach oben anheften“.
        </EmptyState>
      ) : (
        <ol className="first-signer-order" aria-label="Reihenfolge">
          {items.map((signer, index) => (
            <li
              key={signer.id}
              draggable
              className={dragging === index ? "is-dragging" : undefined}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(signer.id));
                setDragging(index);
              }}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                if (dragging !== index) {
                  setItems(moveItem(items, dragging, index));
                  setDragging(index);
                }
              }}
              onDrop={(event) => event.preventDefault()}
              onDragEnd={() => setDragging(null)}
            >
              <span className="first-signer-handle" aria-hidden="true">
                ⠿
              </span>
              <PlaceField
                signer={signer}
                place={index + 1}
                count={items.length}
                onMove={(to, keepFocus) =>
                  move(index, to, keepFocus ? "place" : null)
                }
              />
              <span className="first-signer-person">
                <strong>{signer.name}</strong>
                {personLine(signer) && (
                  <span className="admin-muted">{personLine(signer)}</span>
                )}
              </span>
              <span className="first-signer-moves">
                <Button
                  type="button"
                  className="admin-button admin-button--quiet admin-button--small"
                  data-order-button={`${signer.id}-up`}
                  aria-label={`${signer.name} nach oben`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1, "up")}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  className="admin-button admin-button--quiet admin-button--small"
                  data-order-button={`${signer.id}-down`}
                  aria-label={`${signer.name} nach unten`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1, "down")}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  className="admin-button admin-button--quiet admin-button--small"
                  aria-label={`${signer.name} aus der Reihenfolge nehmen`}
                  onClick={() => {
                    setItems(items.filter((item) => item.id !== signer.id));
                    setAnnouncement(
                      `${signer.name} ist aus der Reihenfolge genommen.`,
                    );
                  }}
                >
                  ✕
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {dropped.length > 0 && (
        <p className="admin-muted">
          Beim Speichern verlieren ihre Position:{" "}
          {dropped.map((signer) => signer.name).join(", ")}. Die Markierung
          bleibt.
        </p>
      )}
      <div className="admin-actions">
        <Button
          type="button"
          className="admin-button admin-button--primary"
          disabled={!changed || state?.busy}
          onClick={save}
        >
          {state?.busy ? "Wird gespeichert…" : "Reihenfolge speichern"}
        </Button>
        <Button
          type="button"
          className="admin-button admin-button--quiet"
          disabled={!changed || state?.busy}
          onClick={() => {
            setItems(data.ordered);
            setState(null);
          }}
        >
          Änderungen verwerfen
        </Button>
      </div>
      {state?.saved && !changed && (
        <Notice tone="success">
          Die Reihenfolge ist gespeichert und gilt ab sofort auf der Website.
        </Notice>
      )}
      {state?.error && (
        <Notice
          tone="error"
          action={
            state.conflict && (
              <Button
                type="button"
                className="admin-button admin-button--small"
                onClick={() => {
                  setState(null);
                  onSaved(null);
                }}
              >
                Neu laden
              </Button>
            )
          }
        >
          {state.error}
        </Notice>
      )}

      <h3 className="signer-edit-heading">Markiert, ohne Position</h3>
      <p className="admin-muted">
        Sie stehen auf der Website direkt nach der Reihenfolge, älteste
        Unterschrift zuerst.
      </p>
      {unordered.length === 0 ? (
        <EmptyState compact title="Alle Markierten haben eine Position." />
      ) : (
        <ul className="first-signer-marked">
          {unordered.map((signer) => (
            <li key={signer.id}>
              <span className="first-signer-person">
                <strong>{signer.name}</strong>
                {personLine(signer) && (
                  <span className="admin-muted">{personLine(signer)}</span>
                )}
              </span>
              <Button
                type="button"
                className="admin-button admin-button--small"
                onClick={() => addMarked(signer)}
              >
                Ans Ende der Reihenfolge
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// The "Erstunterzeichner*innen" card in Unterschriften. `version` changes
// when the signer list changed something; `onChanged` tells the page this
// card did.
export default function FirstSigners({
  api,
  enabled,
  version,
  onChanged,
  askConfirmation,
}) {
  const list = useAdminRead(
    api,
    "/api/admin/first-signers",
    enabled,
    isFirstSignerList,
  );
  const reload = list.reload;
  useEffect(() => {
    if (version) reload();
  }, [version, reload]);
  const changed = () => {
    reload();
    onChanged();
  };
  return (
    <div className="admin-card first-signers">
      <h2 className="admin-card-title">Erstunterzeichner*innen</h2>
      <p className="admin-muted">
        Markierte Erstunterzeichner*innen tragen auf der Website unter dem Namen
        den Hinweis „{cfg.ui.list.firstSigner}“. Wer eine Position hat, steht in
        der Ansicht „{cfg.ui.list.filterAll}“ ganz oben, in dieser Reihenfolge.
        Funktion und Organisation erscheinen nur, wenn die Person zugestimmt
        hat.
      </p>
      <AdminReadStatus resource={list} label="Erstunterzeichner*innen" />
      {list.data && (
        <OrderList
          api={api}
          data={list.data}
          onSaved={(next) => {
            if (next) list.setData(next);
            else reload();
            onChanged();
          }}
        />
      )}
      <Collapsible.Root>
        <Collapsible.Trigger className="admin-disclosure-trigger">
          Von Hand hinzufügen
        </Collapsible.Trigger>
        <Collapsible.Panel className="signer-tool-panel">
          <FirstSignerAdd api={api} onAdded={changed} />
        </Collapsible.Panel>
      </Collapsible.Root>
      <Collapsible.Root>
        <Collapsible.Trigger className="admin-disclosure-trigger">
          Aus CSV-Datei übernehmen
        </Collapsible.Trigger>
        <Collapsible.Panel className="signer-tool-panel">
          <FirstSignerImport
            api={api}
            askConfirmation={askConfirmation}
            onImported={changed}
          />
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
