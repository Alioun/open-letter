import { useEffect, useMemo, useState } from "react";

function getToken() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1] || "";
}

export default function UnsubscribeApp() {
  const token = useMemo(getToken, []);
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/unsubscribe/${token}`);
        if (!res.ok) {
          setState({ loading: false, data: null, error: "Dieser Link ist nicht mehr gültig." });
          return;
        }
        setState({ loading: false, data: await res.json(), error: "" });
      } catch {
        setState({ loading: false, data: null, error: "Die Verbindung ist fehlgeschlagen." });
      }
    }
    load();
  }, [token]);

  async function submit(action) {
    setBusy(action);
    setResult("");
    try {
      const res = await fetch(`/api/unsubscribe/${token}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        setState({ loading: false, data: null, error: "Dieser Link wurde bereits verwendet." });
        return;
      }
      setResult(
        action === "opt-out"
          ? "Du erhältst keine weiteren E-Mails. Deine Unterschrift bleibt bestehen."
          : "Deine Unterschrift und die damit verbundenen Daten wurden gelöscht.",
      );
      setState((current) => ({ ...current, data: null }));
    } catch {
      setResult("Die Aktion konnte nicht abgeschlossen werden.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="unsubscribe-shell">
      <section className="section">
        <div className="section-inner unsubscribe-inner">
          <article className="brief-paper unsubscribe-card">
            <h1>E-Mail-Einstellungen</h1>

            {state.loading && <p>Link wird geprüft ...</p>}

            {state.error && (
              <>
                <p className="lead">{state.error}</p>
                <p>Bitte nutze den neuesten Link aus einer unserer E-Mails.</p>
              </>
            )}

            {result && (
              <>
                <p className="lead">{result}</p>
                <p>Danke für deine Rückmeldung.</p>
              </>
            )}

            {state.data && (
              <>
                <p className="anrede">{state.data.emailMasked}</p>
                <p>
                  Du kannst nur die E-Mails abbestellen oder deine Unterschrift
                  vollständig löschen. Die erste Option lässt deine öffentliche
                  Unterstützung bestehen.
                </p>

                <div className="unsubscribe-actions">
                  <button
                    type="button"
                    className="cta"
                    disabled={Boolean(busy)}
                    onClick={() => submit("opt-out")}
                  >
                    {busy === "opt-out" ? "Wird abbestellt ..." : "Nur E-Mails abbestellen"}
                  </button>
                  <button
                    type="button"
                    className="admin-danger"
                    disabled={Boolean(busy)}
                    onClick={() => submit("delete")}
                  >
                    {busy === "delete" ? "Wird gelöscht ..." : "Unterschrift vollständig löschen"}
                  </button>
                </div>
              </>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
