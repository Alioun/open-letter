const registeredAt = (value) =>
  new Date(value).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export default function ZoomRegistrations({
  registrations,
  showDelegierter,
  regionLabel,
}) {
  return (
    <>
      <ul className="zoom-registration-cards" aria-label="Zoom-Anmeldungen">
        {registrations.map((person) => (
          <li key={person.email}>
            <strong>{person.name}</strong>
            <span>{person.email}</span>
            <dl>
              <div>
                <dt>{regionLabel}</dt>
                <dd>{person.kreisverband || "–"}</dd>
              </div>
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
          </li>
        ))}
      </ul>
      <div className="admin-table-wrap zoom-registration-table">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>{regionLabel}</th>
              {showDelegierter && <th>Delegierte*r</th>}
              <th>E-Mail</th>
              <th>Angemeldet</th>
            </tr>
          </thead>
          <tbody>
            {registrations.map((person) => (
              <tr key={person.email}>
                <td>{person.name}</td>
                <td>{person.kreisverband || "–"}</td>
                {showDelegierter && <td>{person.delegierter ? "Ja" : "–"}</td>}
                <td>{person.email}</td>
                <td>{registeredAt(person.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
