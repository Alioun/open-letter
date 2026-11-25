import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";

export async function readAdminJson(api, path, options = {}) {
  const response = await api(path, options);
  if (!response.ok) throw new Error("Die Daten konnten nicht geladen werden.");
  return response.json();
}

export function useAdminRead(api, path, enabled, validate) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef(null);
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const next = await readAdminJson(api, path, {
        signal: controller.signal,
      });
      if (!validate(next)) throw new Error("Ungültige Antwort");
      if (controller.signal.aborted) return null;
      setData(next);
      setError(false);
      return next;
    } catch {
      if (!controller.signal.aborted) setError(true);
      return null;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api, path, validate]);
  useEffect(() => {
    if (enabled) reload();
    return () => {
      request.current?.abort();
      setLoading(false);
    };
  }, [enabled, reload]);
  return { data, setData, error, loading, reload };
}

export function AdminReadStatus({ resource, label }) {
  return (
    <div className="admin-read-status">
      {resource.error && (
        <p role="alert">
          {label} konnten nicht geladen werden.{" "}
          {resource.data !== null
            ? "Angezeigt wird der zuletzt geladene Stand."
            : "Bitte erneut laden."}
        </p>
      )}
      {resource.loading && <span role="status">{label} werden geladen…</span>}
      <Button
        type="button"
        className="admin-button admin-button--small"
        disabled={resource.loading}
        onClick={resource.reload}
      >
        {resource.loading
          ? "Wird geladen…"
          : resource.error
            ? "Erneut laden"
            : "Aktualisieren"}
      </Button>
    </div>
  );
}
