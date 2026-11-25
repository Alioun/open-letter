import { useState } from "react";
import { useAdminRead, AdminReadStatus } from "./admin-read.jsx";
import { EmptyState } from "./ui.jsx";
import Pager from "./Pager.jsx";
import {
  actionLabel,
  changeLines,
  entrySubject,
  logTime,
} from "./admin-log-format.js";

export const ADMIN_LOG_PAGE_SIZE = 50;

export function isAdminLog(data) {
  return (
    Number.isInteger(data?.total) &&
    Array.isArray(data.actions) &&
    data.actions.every((entry) => typeof entry?.action === "string")
  );
}

export function LogEntries({ entries }) {
  return (
    <ol className="admin-log">
      {entries.map((entry) => {
        const subject = entrySubject(entry);
        const lines = changeLines(entry.detail);
        return (
          <li key={entry.id}>
            <time dateTime={entry.at}>{logTime(entry.at)}</time>
            <div>
              <strong>{actionLabel(entry.action)}</strong>
              {subject && <span className="admin-muted"> · {subject}</span>}
              {lines.length > 0 && (
                <ul>
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function AdminLog({ api, enabled }) {
  const [page, setPage] = useState(0);
  const log = useAdminRead(
    api,
    `/api/admin/actions?offset=${page * ADMIN_LOG_PAGE_SIZE}`,
    enabled,
    isAdminLog,
  );
  const entries = log.data?.actions ?? [];
  const pages = Math.max(
    1,
    Math.ceil((log.data?.total ?? 0) / ADMIN_LOG_PAGE_SIZE),
  );
  return (
    <div className="admin-card">
      <h2 className="admin-card-title" id="admin-log-heading">
        Protokoll
      </h2>
      <p className="admin-muted">
        Was in der Verwaltung geändert, gelöscht oder exportiert wurde, neueste
        Einträge zuerst. E-Mail-Adressen stehen nie im Protokoll.
        {log.data?.retentionDays &&
          ` Einträge werden nach ${log.data.retentionDays} Tagen gelöscht; alte und neue Werte einer Unterschrift schon vorher, sobald sie gelöscht wird.`}
      </p>
      <AdminReadStatus resource={log} label="Protokolleinträge" />
      {log.data &&
        (entries.length > 0 ? (
          <LogEntries entries={entries} />
        ) : (
          <EmptyState compact title="Noch keine Einträge." />
        ))}
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
