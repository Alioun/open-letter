import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Breakable, EmptyState, Notice } from "./ui.jsx";
import Pager from "./Pager.jsx";

const registeredAt = (value) =>
  new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export const ZOOM_REGISTRATION_PAGE_SIZE = 100;

export function isZoomRegistrationPage(data) {
  return (
    Number.isInteger(data?.total) &&
    Number.isInteger(data.delegates) &&
    Array.isArray(data.registrations)
  );
}

export function zoomRegistrationsPath(page, search = "") {
  return `/api/admin/zoom-registrations?limit=${ZOOM_REGISTRATION_PAGE_SIZE}&offset=${page * ZOOM_REGISTRATION_PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
}

// The list of a Treffen's registrations with its search, removal and paging.
// `read` is the page that `zoomRegistrationsPath(page, search)` loads.
// Whoever resets `search` from outside remounts the list (a new `key`), so
// the field does not put the old term back.
export function ZoomRegistrationList({
  api,
  askConfirmation,
  read,
  page,
  onPage,
  search,
  onSearch,
  showDelegierter,
  regionLabel,
}) {
  const fieldId = useId();
  const [typed, setTyped] = useState(search);
  const [busy, setBusy] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const feedbackBox = useRef(null);
  useEffect(() => {
    if (typed === search) return undefined;
    const timer = setTimeout(() => {
      onPage(0);
      onSearch(typed);
    }, 250);
    return () => clearTimeout(timer);
  }, [typed, search, onPage, onSearch]);
  useEffect(() => {
    if (feedback) feedbackBox.current?.focus();
  }, [feedback]);

  async function remove(person, returnFocus) {
    setFeedback(null);
    if (
      !(await askConfirmation(
        `${person.name} wird vom Treffen abgemeldet. Die Anmeldung und noch nicht versendete E-Mails zum Treffen werden gelöscht. Unterschrift und Newsletter bleiben, wie sie sind. Die Person bekommt keine Nachricht und kann sich erneut anmelden.`,
        {
          title: "Anmeldung entfernen?",
          confirmLabel: "Anmeldung entfernen",
          danger: true,
          returnFocus,
        },
      ))
    )
      return;
    setBusy(person.id);
    try {
      const response = await api(`/api/admin/zoom-registrations/${person.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error);
      }
      setFeedback({
        tone: "success",
        text: `Die Anmeldung von ${person.name} wurde entfernt.`,
      });
      if (read.data.registrations.length === 1 && page > 0) onPage(page - 1);
      else read.reload();
    } catch (failure) {
      setFeedback({
        tone: "error",
        text:
          (failure instanceof TypeError ? "" : failure.message) ||
          "Der Server hat das Entfernen nicht bestätigt. Lade die Liste erneut, bevor du es wiederholst.",
      });
    } finally {
      setBusy(null);
    }
  }

  const data = read.data;
  const matches = data?.matches ?? data?.total ?? 0;
  return (
    <>
      {(data?.total > 0 || typed) && (
        <div className="field zoom-registration-search">
          <label htmlFor={`${fieldId}-search`}>Suche (Name oder E-Mail)</label>
          <Input
            id={`${fieldId}-search`}
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Suchen…"
          />
        </div>
      )}
      {feedback && (
        <Notice ref={feedbackBox} tabIndex={-1} tone={feedback.tone}>
          {feedback.text}
        </Notice>
      )}
      {search.trim() && data && (
        <p className="admin-muted" role="status">
          {matches === 1 ? "1 Treffer" : `${matches} Treffer`} von {data.total}{" "}
          Anmeldungen
        </p>
      )}
      {!data ? null : matches === 0 ? (
        !read.error && (
          <EmptyState
            compact
            title={
              search.trim()
                ? "Keine Anmeldung passt zur Suche."
                : "Noch keine Anmeldungen."
            }
          />
        )
      ) : (
        <ZoomRegistrations
          registrations={data.registrations}
          showDelegierter={showDelegierter}
          regionLabel={regionLabel}
          onRemove={remove}
          busy={busy !== null || read.loading}
        />
      )}
      <Pager
        page={page}
        pages={Math.ceil(matches / ZOOM_REGISTRATION_PAGE_SIZE)}
        onPage={onPage}
      />
    </>
  );
}

function RemoveButton({ person, onRemove, busy }) {
  return (
    <Button
      type="button"
      className="admin-button admin-button--danger-secondary admin-button--small"
      disabled={busy}
      aria-label={`Anmeldung von ${person.name} entfernen`}
      onClick={(event) => onRemove(person, event.currentTarget)}
    >
      Entfernen
    </Button>
  );
}

export default function ZoomRegistrations({
  registrations,
  showDelegierter,
  regionLabel,
  onRemove,
  busy,
}) {
  return (
    <>
      <ul className="admin-cards" aria-label="Zoom-Anmeldungen">
        {registrations.map((person) => (
          <li key={person.id}>
            <div className="admin-card-person">
              <strong>{person.name}</strong>
              <span>
                <Breakable text={person.email} />
              </span>
            </div>
            <dl className="admin-facts">
              {regionLabel && person.kreisverband && (
                <div>
                  <dt>{regionLabel}</dt>
                  <dd>{person.kreisverband}</dd>
                </div>
              )}
              {showDelegierter && (
                <div>
                  <dt>Delegierte*r</dt>
                  <dd>{person.delegierter ? "Ja" : "Nein"}</dd>
                </div>
              )}
              <div>
                <dt>Angemeldet</dt>
                <dd>{registeredAt(person.created_at)}</dd>
              </div>
            </dl>
            <RemoveButton person={person} onRemove={onRemove} busy={busy} />
          </li>
        ))}
      </ul>
      <div className="admin-table-wrap has-cards">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col" className="admin-sticky admin-sticky-edge">
                Name
              </th>
              {regionLabel && <th scope="col">{regionLabel}</th>}
              {showDelegierter && <th scope="col">Delegierte*r</th>}
              <th scope="col">E-Mail</th>
              <th scope="col">Angemeldet</th>
              <th scope="col" className="admin-row-action">
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {registrations.map((person) => (
              <tr key={person.id}>
                <td className="admin-sticky admin-sticky-edge admin-cell-wrap">
                  {person.name}
                </td>
                {regionLabel && (
                  <td className="admin-cell-wrap">
                    {person.kreisverband || "–"}
                  </td>
                )}
                {showDelegierter && <td>{person.delegierter ? "Ja" : "–"}</td>}
                <td className="admin-cell-wrap">
                  <Breakable text={person.email} />
                </td>
                <td>{registeredAt(person.created_at)}</td>
                <td className="admin-row-action">
                  <RemoveButton
                    person={person}
                    onRemove={onRemove}
                    busy={busy}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
