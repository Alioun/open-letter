import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { Choice } from "./ui.jsx";
import StatisticsChart, { statisticsDate as date } from "./StatisticsChart.jsx";

const number = (value) => Number(value || 0).toLocaleString("de-DE");
const STATISTICS_MODES = [
  ["disabled", "Deaktiviert"],
  ["builtin", "Integrierte Statistik"],
  ["external", "Externe Statistik aus den Servereinstellungen"],
];
export default function AdminStatistics({ api, onDirtyChange }) {
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("disabled");
  const [status, setStatus] = useState("");
  const [readError, setReadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const saveFeedback = useRef(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  async function refresh({ reset = false } = {}) {
    setLoading(true);
    try {
      const res = await api("/api/admin/statistics");
      if (!res.ok)
        throw new Error(
          "Statistik ist gerade nicht verfügbar. Bitte erneut laden.",
        );
      const next = await res.json();
      setData(next);
      setMode((selected) =>
        !reset && data && selected !== data.mode ? selected : next.mode,
      );
      setStatus("");
      setSaveError("");
      setReadError("");
      return true;
    } catch {
      setReadError("Statistik ist gerade nicht verfügbar. Bitte erneut laden.");
      return false;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!saveError) return;
    saveFeedback.current?.focus({ preventScroll: true });
    saveFeedback.current?.scrollIntoView({ block: "nearest" });
  }, [saveError]);
  const dirty = Boolean(data && mode !== data.mode);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const series = data?.series || [];
  const views = series.reduce((total, day) => total + day.pageviews, 0);
  const dailyVisitors = series.reduce((total, day) => total + day.visitors, 0);
  return (
    <section
      className="admin-card admin-statistics"
      aria-labelledby="statistics-heading"
    >
      <span className="admin-eyebrow">Reichweite</span>
      <h2 id="statistics-heading" tabIndex={-1}>
        Besuchsstatistik
      </h2>
      <p>
        Seitenaufrufe und geschätzte Besucher pro Tag für die letzten 30 Tage.
        Die Zahlen zählen Besuche, keine Unterschriften.
      </p>
      <div className="admin-actions">
        {data && (
          <>
            <Choice
              label="Statistikerfassung"
              disabled={busy}
              value={mode}
              onChange={setMode}
              options={STATISTICS_MODES}
            />
            <Button
              disabled={busy || loading || mode === data.mode}
              onClick={async () => {
                setBusy(true);
                setStatus("");
                setSaveError("");
                try {
                  const res = await api("/api/admin/statistics", {
                    method: "PUT",
                    body: JSON.stringify({
                      mode,
                      expectedRevision: data.revision,
                    }),
                  });
                  if (!res.ok) {
                    setSaveError(
                      res.status === 409
                        ? "Inzwischen wurde eine neue Version veröffentlicht. Lade die Statistik neu und prüfe den gespeicherten Stand. Deine Auswahl bleibt erhalten."
                        : res.status === 401
                          ? "Der Server hat das Speichern nicht bestätigt. Melde dich erneut an und lade die Statistik neu. Deine Auswahl bleibt erhalten."
                          : res.status === 503
                            ? "Die Statistik ist derzeit nicht verfügbar. Deine Auswahl bleibt erhalten. Lade die Statistik neu und prüfe den gespeicherten Stand, bevor du erneut speicherst."
                            : "Die Statistikeinstellung wurde abgelehnt. Deine Auswahl bleibt erhalten. Lade den aktuellen Stand neu, prüfe deine Auswahl und versuche es erneut.",
                    );
                    return;
                  }
                  if (await refresh({ reset: true }))
                    setStatus("Statistikeinstellung veröffentlicht.");
                  else
                    setSaveError(
                      "Die Einstellung ist gespeichert. Der aktuelle Stand konnte danach nicht geladen werden. Lade die Statistik neu, um ihn zu prüfen.",
                    );
                } catch {
                  setSaveError(
                    "Der Server hat das Speichern nicht bestätigt. Deine Auswahl bleibt erhalten. Prüfe die Verbindung und lade den gespeicherten Stand, bevor du erneut speicherst.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Wird gespeichert…" : "Einstellung speichern"}
            </Button>
          </>
        )}
        <Button
          className="admin-button"
          disabled={busy || loading}
          onClick={() => refresh()}
        >
          {loading ? "Wird geladen…" : readError ? "Erneut laden" : "Neu laden"}
        </Button>
      </div>
      {data && (
        <p className="admin-muted">
          Gespeicherte Statistikerfassung:{" "}
          {STATISTICS_MODES.find(([key]) => key === data.mode)?.[1]}
        </p>
      )}
      {saveError && (
        <p
          className="statistics-read-error"
          role="alert"
          tabIndex={-1}
          ref={saveFeedback}
        >
          {saveError}
        </p>
      )}
      {readError && (
        <div className="statistics-read-error" role="alert">
          {data && <strong>Stand veraltet · zuletzt geladene Zahlen</strong>}
          <p>{readError}</p>
        </div>
      )}
      <p role="status">
        {status || (!data && !readError ? "Statistik wird geladen…" : "")}
      </p>
      {data && (
        <>
          {data.mode !== "builtin" && (
            <div className="admin-empty">
              <h3>
                {data.mode === "disabled"
                  ? "Aufzeichnung ist deaktiviert"
                  : "Externe Statistik ist ausgewählt"}
              </h3>
              <p>
                {data.mode === "disabled"
                  ? "Neue Aufrufe werden nicht erfasst. Aktiviere die integrierte Statistik, wenn du die Reichweite hier verfolgen möchtest."
                  : "Berichte findest du bei deinem externen Anbieter. Die integrierte Aufzeichnung ist ausgeschaltet."}
              </p>
            </div>
          )}
          {data.unavailable && (
            <p role="alert">
              Der Statistik-Speicher ist nicht erreichbar. Die öffentlichen
              Seiten funktionieren weiter.
            </p>
          )}
          {(data.mode === "builtin" || views > 0) && (
            <>
              <p className="admin-muted">
                Zeitraum: {date(data.from || Date.now() - 30 * 86400000)} –{" "}
                {date(data.to || Date.now())} · 30 Kalendertage · UTC
                <br />
                Der heutige Tag ist noch unvollständig.
              </p>
              <div className="statistics-totals">
                <div>
                  <span>Seitenaufrufe</span>
                  <strong>{number(views)}</strong>
                </div>
                <div>
                  <span>Geschätzte Tagesbesucher, summiert</span>
                  <strong>{number(dailyVisitors)}</strong>
                  <small>
                    Wer an mehreren Tagen kommt, zählt an jedem dieser Tage.
                  </small>
                </div>
              </div>
              {views === 0 ? (
                <div className="admin-empty">
                  <h3>Noch keine Seitenaufrufe</h3>
                  <p>
                    Der Verlauf erscheint nach den ersten erfassten Besuchen.
                    Verwaltungsseiten, Vorschauen und erkannte Bots zählen
                    nicht. Anfragen mit DNT oder GPC werden nicht erfasst.
                  </p>
                </div>
              ) : (
                <>
                  <h3>Täglicher Verlauf</h3>
                  <p className="statistics-legend">
                    <span>● Seitenaufrufe</span>
                    <span>● Ungefähre Besucher</span>
                  </p>
                  <StatisticsChart series={series} />
                  <Collapsible.Root>
                    <Collapsible.Trigger className="admin-disclosure-trigger">
                      Tägliche Werte als Tabelle
                    </Collapsible.Trigger>
                    <Collapsible.Panel
                      keepMounted
                      className="admin-disclosure-panel"
                    >
                      <div className="admin-table-scroll">
                        <table className="admin-table statistics-daily-table">
                          <thead>
                            <tr>
                              <th>Datum</th>
                              <th>Seitenaufrufe</th>
                              <th>Besucher · ca.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {series.map((day) => (
                              <tr key={day.ts}>
                                <th scope="row">{date(day.ts)}</th>
                                <td data-label="Seitenaufrufe">
                                  {number(day.pageviews)}
                                </td>
                                <td data-label="Besucher · ca.">
                                  {number(day.visitors)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Collapsible.Panel>
                  </Collapsible.Root>
                  <div className="statistics-breakdowns">
                    {[
                      ["Verweisende Domains", data.referrers],
                      ["Seiten / Sprachen", data.pages],
                    ].map(([title, rows]) => (
                      <div key={title}>
                        <h3>{title}</h3>
                        <table className="admin-table statistics-breakdown-table">
                          <thead>
                            <tr>
                              <th>
                                {title === "Verweisende Domains"
                                  ? "Domain"
                                  : "Seite"}
                              </th>
                              <th>Aufrufe</th>
                              <th>Besucher · ca.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows?.map((row) => (
                              <tr key={row.key}>
                                <th scope="row">{row.key || "Direkt"}</th>
                                <td data-label="Aufrufe">
                                  {number(row.pageviews)}
                                </td>
                                <td data-label="Besucher · ca.">
                                  {number(row.visitors)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      <Collapsible.Root className="statistics-privacy">
        <Collapsible.Trigger className="admin-disclosure-trigger">
          Was wird erfasst?
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted className="admin-disclosure-panel">
          <p>
            Die Statistik speichert keine Suchparameter, Tokens, IP-Adressen,
            vollständigen Browserkennungen, Standorte oder Bildschirmdaten. Sie
            verwendet monatlich wechselnde pseudonyme Kennungen und löscht
            Datensätze nach 30 Tagen. DNT und GPC verhindern die Erfassung. Die
            Daten sind pseudonym, nicht anonym. Prüfe, ob du eine Einwilligung
            brauchst. Integrierte und externe Statistik können nicht
            gleichzeitig laufen.
          </p>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}
