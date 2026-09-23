// Admin tab "Texte & Modus": every runtime-editable config value
// (config/editable.js), grouped, searchable, each resettable to the deployed
// default. Changes go live on the next page load, without a redeploy.
import { useState, useEffect, useMemo, useCallback } from "react";

const SECTION_LABELS = {
  brief: "Brief",
  unterzeichnen: "Unterzeichnen",
  liste: "Liste",
  faq: "FAQ",
};
const LINE_STYLES = [
  ["", "normal"],
  ["banner", "banner"],
  ["light", "light"],
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function FieldEditor({ field, value, onChange }) {
  const id = `copy-${field.path}`;
  switch (field.type) {
    case "bool":
      return (
        <label className="check admin-check">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value ? "an" : "aus"}</span>
        </label>
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          min={0}
          value={value ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case "sections":
      return (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(SECTION_LABELS).map(([sid, label]) => (
            <label key={sid} className="check admin-check">
              <input
                type="checkbox"
                checked={(value || []).includes(sid)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...(value || []), sid]
                      : (value || []).filter((v) => v !== sid),
                  )
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      );
    case "list":
      return (
        <textarea
          id={id}
          rows={Math.max(3, (value || []).length + 1)}
          value={(value || []).join("\n")}
          onChange={(e) => onChange(e.target.value.split("\n"))}
        />
      );
    case "lines":
      return (
        <div style={{ display: "grid", gap: 6 }}>
          {(value || []).map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={line.text}
                aria-label={`Zeile ${i + 1}`}
                style={{ flex: 1 }}
                onChange={(e) =>
                  onChange(
                    value.map((l, j) =>
                      j === i ? { ...l, text: e.target.value } : l,
                    ),
                  )
                }
              />
              <select
                value={line.style || ""}
                aria-label={`Stil Zeile ${i + 1}`}
                onChange={(e) =>
                  onChange(
                    value.map((l, j) =>
                      j === i ? { ...l, style: e.target.value } : l,
                    ),
                  )
                }
              >
                {LINE_STYLES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Zeile ${i + 1} entfernen`}
                disabled={value.length <= 1}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...(value || []), { text: "", style: "" }])}
          >
            + Zeile
          </button>
        </div>
      );
    case "textarea":
    case "html":
      return (
        <textarea
          id={id}
          rows={Math.min(8, Math.max(2, Math.ceil(String(value ?? "").length / 70)))}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          id={id}
          type={field.type === "url" ? "url" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// Clean up what the editors produce before sending (list editors keep empty
// lines while typing).
function outgoing(field, value) {
  if (field.type === "list") return value.map((v) => v.trim()).filter(Boolean);
  return value;
}

export default function AdminCopy({ api }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [reset, setReset] = useState(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);

  const load = useCallback(async () => {
    const res = await api("/api/admin/copy");
    if (res.ok) {
      setData(await res.json());
      setDraft({});
      setReset(new Set());
    } else setStatus("Laden fehlgeschlagen");
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const fields = data?.fields || [];
  const byGroup = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = {};
    for (const f of fields) {
      const value = f.path in draft ? draft[f.path] : f.value;
      const hay = `${f.path} ${JSON.stringify(value)} ${JSON.stringify(f.default)}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      (out[f.group] ||= []).push(f);
    }
    return out;
  }, [fields, draft, query]);

  const dirty = Object.keys(draft).length + reset.size;

  function change(field, value) {
    setReset((r) => {
      const n = new Set(r);
      n.delete(field.path);
      return n;
    });
    setDraft((d) => {
      const n = { ...d };
      if (same(value, field.value)) delete n[field.path];
      else n[field.path] = value;
      return n;
    });
  }

  function restore(field) {
    setDraft((d) => {
      const n = { ...d };
      delete n[field.path];
      return n;
    });
    setReset((r) => new Set(r).add(field.path));
  }

  async function save(e) {
    e.preventDefault();
    const changes = {};
    for (const path of reset) changes[path] = null;
    for (const f of fields) {
      if (f.path in draft) changes[f.path] = outgoing(f, draft[f.path]);
    }
    setStatus("saving");
    const res = await api("/api/admin/copy", {
      method: "POST",
      body: JSON.stringify({ changes }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      await load();
      setStatus("ok");
      setTimeout(() => setStatus(null), 5000);
    } else setStatus(body.error || "Fehler beim Speichern");
  }

  if (!data) {
    return (
      <section className="section">
        <div className="section-inner">
          <p className="admin-muted">{status || "Lade Texte…"}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <form className="section-inner" onSubmit={save}>
        <div
          className="admin-card"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input
            type="search"
            placeholder="Texte durchsuchen…"
            aria-label="Texte durchsuchen"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button type="submit" disabled={!dirty || status === "saving"}>
            {status === "saving"
              ? "Speichern…"
              : dirty
                ? `${dirty} Änderung${dirty === 1 ? "" : "en"} speichern`
                : "Keine Änderungen"}
          </button>
          {dirty > 0 && (
            <button type="button" onClick={load}>
              Verwerfen
            </button>
          )}
          {status && status !== "saving" && (
            <span className="admin-muted" role="status">
              {status === "ok" ? "Gespeichert. Gilt ab dem nächsten Seitenaufruf." : status}
            </span>
          )}
        </div>
        <p className="admin-muted">
          Änderungen gelten ohne neues Deployment ab dem nächsten Seitenaufruf.
          Platzhalter wie <code>{"{name}"}</code> bleiben stehen und werden
          beim Anzeigen ersetzt. Felder mit „HTML“ werden als HTML eingesetzt.
        </p>

        {Object.entries(data.groups).map(([gid, title]) => {
          const list = byGroup[gid];
          if (!list?.length) return null;
          const changed = list.filter((f) => f.overridden).length;
          return (
            <details key={gid} className="admin-card" open={Boolean(query)}>
              <summary style={{ cursor: "pointer" }}>
                <strong>{title}</strong>{" "}
                <span className="admin-muted">
                  ({list.length} Felder{changed ? `, ${changed} geändert` : ""})
                </span>
              </summary>
              <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
                {list.map((f) => {
                  const pendingReset = reset.has(f.path);
                  const value =
                    f.path in draft
                      ? draft[f.path]
                      : pendingReset
                        ? f.default
                        : f.value;
                  return (
                    <div key={f.path} className="field">
                      <label htmlFor={`copy-${f.path}`}>
                        <code>{f.path}</code>
                        {f.type === "html" && " · HTML"}
                        {gid === "pages" && " · HTML erlaubt"}
                        {f.overridden && !pendingReset && (
                          <strong> · geändert</strong>
                        )}
                        {f.path in draft && <strong> · ungespeichert</strong>}
                        {pendingReset && <strong> · wird zurückgesetzt</strong>}
                      </label>
                      <FieldEditor
                        field={f}
                        value={value}
                        onChange={(v) => change(f, v)}
                      />
                      {(f.overridden || f.path in draft) && !pendingReset && (
                        <div className="admin-muted" style={{ fontSize: 13 }}>
                          Standard:{" "}
                          {typeof f.default === "string"
                            ? f.default || "(leer)"
                            : JSON.stringify(f.default)}{" "}
                          <button type="button" onClick={() => restore(f)}>
                            Standard wiederherstellen
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </form>
    </section>
  );
}
