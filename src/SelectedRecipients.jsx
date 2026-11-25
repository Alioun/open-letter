import { useEffect, useState, useRef } from "react";
import { Button } from "@base-ui/react/button";
import { Notice } from "./ui.jsx";

export default function SelectedRecipients({
  api,
  ids,
  filterQuery,
  filterError,
  remove,
  clear,
  compose,
  onLoaded,
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const toggle = useRef(null);
  const signature = JSON.stringify([ids, filterQuery]);
  useEffect(() => setPage(0), [signature]);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    onLoaded(null);
    if (!ids.length || filterError) return;
    api(`/api/admin/newsletter-selection?${filterQuery}`, {
      method: "POST",
      body: JSON.stringify({ ids, offset: page * 25 }),
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            "Auswahl konnte nicht geladen werden. Bitte erneut öffnen.",
          );
        return r.json();
      })
      .then((next) => {
        if (!cancelled) {
          if (page > 0 && page * 25 >= next.total)
            setPage(Math.max(0, Math.ceil(next.total / 25) - 1));
          setData(next);
          onLoaded(next);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, signature, page, open, onLoaded, filterError]);
  if (!ids.length) return null;
  return (
    <section
      className="selected-recipients"
      aria-label="Gespeicherte Empfängerauswahl"
    >
      <div className="selected-recipient-heading">
        <strong>{ids.length.toLocaleString("de-DE")} ausgewählt</strong>
        <div className="selected-recipient-actions">
          <Button
            ref={toggle}
            className="admin-button admin-button--small"
            aria-label={
              open ? "Auswahl schließen" : "Ausgewählte Empfänger prüfen"
            }
            aria-expanded={open}
            aria-controls="selected-recipient-list"
            onClick={() => setOpen(!open)}
          >
            {open ? "Schließen" : "Prüfen"}
          </Button>
          <Button
            className="admin-button admin-button--small"
            aria-label={`Nachricht an ${ids.length} verfassen`}
            onClick={compose}
          >
            Nachricht verfassen
          </Button>
        </div>
      </div>
      <p role="status">
        {data
          ? `${data.outsideFilter.toLocaleString("de-DE")} außerhalb des aktuellen Filters`
          : filterError
            ? "Korrigiere den Zeitraum, um die Auswahl mit dem Filter zu vergleichen. Deine Auswahl bleibt erhalten."
            : error
              ? "Auswahlprüfung fehlgeschlagen"
              : "Auswahl wird geprüft…"}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {open && (
        <div id="selected-recipient-list">
          <h3>Ausgewählte Empfänger</h3>
          <Button className="admin-button admin-button--small" onClick={clear}>
            Auswahl aufheben
          </Button>
          <p>
            Hier stehen alle ausgewählten Personen, auch die außerhalb des
            aktuellen Filters. Du kannst sie einzeln entfernen.
          </p>
          {data?.unavailable > 0 && (
            <Notice
              tone="warning"
              action={
                <Button
                  className="admin-button admin-button--small"
                  onClick={clear}
                >
                  Auswahl leeren und neu wählen
                </Button>
              }
            >
              {data.unavailable} gespeicherte Einträge sind nicht mehr als
              Newsletter-Empfänger verfügbar und erhalten keine Nachricht.
            </Notice>
          )}
          <ul>
            {data?.signers.map((person) => (
              <li key={person.id}>
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.email}</small>
                </span>
                <Button
                  className="admin-button admin-button--small"
                  onClick={() => {
                    remove(person.id);
                    (ids.length > 1
                      ? toggle.current
                      : document.querySelector(
                          ".signer-selection-actions button",
                        )
                    )?.focus();
                  }}
                  aria-label={`${person.name}, ${person.email} aus Auswahl entfernen`}
                >
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
          {data && data.total > 25 && (
            <div className="admin-actions">
              <Button
                className="admin-button admin-button--small"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Zurück
              </Button>
              <span>
                Seite {page + 1} / {Math.ceil(data.total / 25)}
              </span>
              <Button
                className="admin-button admin-button--small"
                disabled={(page + 1) * 25 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Weiter
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
