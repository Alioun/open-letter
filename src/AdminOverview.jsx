import { useState } from "react";
import { Button } from "@base-ui/react/button";
import { useAdminRead } from "./admin-read.jsx";

const number = (value) =>
  Number.isFinite(value) ? value.toLocaleString("de-DE") : "–";
const dateTime = (value) =>
  new Date(value).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const isActivity = (data) =>
  ["signedSince", "pending", "pendingExpiringSoon"].every((key) =>
    Number.isInteger(data?.[key]),
  );
const isBackup = (data) => data && "lastSuccessAt" in data;

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

function Tile({ label, value, detail, tone, action, onAction }) {
  return (
    <div className={`overview-tile${tone ? ` is-${tone}` : ""}`}>
      <span className="overview-tile-label">{label}</span>
      <strong className="overview-tile-value">{value}</strong>
      {detail && <span className="overview-tile-detail">{detail}</span>}
      {action && (
        <Button
          type="button"
          className="admin-button admin-button--quiet admin-button--small"
          onClick={onAction}
        >
          {action}
        </Button>
      )}
    </div>
  );
}

function mailTile(status) {
  if (!status) return { value: "–", detail: "Wird geladen…" };
  if (status.unavailable)
    return {
      value: "Unbekannt",
      detail: "Status nicht erreichbar",
      tone: "danger",
    };
  if (status.ready && status.failure)
    return {
      value: "Gestört",
      detail: "Der letzte Versand ist gescheitert",
      tone: "warning",
    };
  if (status.ready)
    return { value: "Aktiv", detail: status.active?.from, tone: "success" };
  return {
    value: status.active ? "Pausiert" : "Nicht eingerichtet",
    detail: "Es werden keine E-Mails versendet",
    tone: "warning",
  };
}

// Sign-ups whose link ran out without a confirmation mail ever going out.
function unmailedTile(lost) {
  if (!lost) return { value: "–" };
  if (!lost.count)
    return {
      value: "0",
      detail: `Keine in den letzten ${lost.days} Tagen`,
    };
  const last = new Date(`${lost.lastDay}T12:00:00Z`).toLocaleDateString(
    "de-DE",
    { dateStyle: "medium" },
  );
  return {
    value: number(lost.count),
    detail:
      lost.count === 1
        ? `Anmeldung in den letzten ${lost.days} Tagen, am ${last}. Die Bestätigungsmail ging nie raus, die Unterschrift ist verloren.`
        : `Anmeldungen in den letzten ${lost.days} Tagen, zuletzt am ${last}. Die Bestätigungsmails gingen nie raus, die Unterschriften sind verloren.`,
    tone: "warning",
  };
}

function backupTile(read) {
  const backup = read.data;
  if (!backup)
    return {
      value: "–",
      detail: read.error ? "Nicht abrufbar" : "Wird geladen…",
    };
  const failedLast =
    backup.lastErrorAt &&
    (!backup.lastSuccessAt || backup.lastErrorAt > backup.lastSuccessAt);
  if (failedLast)
    return {
      value: "Fehlgeschlagen",
      detail: `${dateTime(backup.lastErrorAt)} · Technik informieren`,
      tone: "danger",
    };
  if (!backup.lastSuccessAt)
    return {
      value: "Noch keine",
      detail: "Die erste Sicherung läuft stündlich",
    };
  return {
    value: dateTime(backup.lastSuccessAt),
    detail:
      backup.lastSuccessBytes != null
        ? `${(backup.lastSuccessBytes / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`
        : null,
  };
}

export default function AdminOverview({
  api,
  stats,
  emailStatus,
  deliveryIssues,
  campaignRead,
  navigate,
  openEmailSettings,
}) {
  const [since] = useState(startOfToday);
  const activity = useAdminRead(
    api,
    `/api/admin/overview?since=${encodeURIComponent(since)}`,
    true,
    isActivity,
  );
  const backup = useAdminRead(api, "/api/admin/backup", true, isBackup);
  const now = Date.now();
  const next = (campaignRead.data || [])
    .filter((campaign) => campaign.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const mail = mailTile(emailStatus);
  const backupState = backupTile(backup);
  const pending = activity.data?.pending;
  const expiring = activity.data?.pendingExpiringSoon;
  const unmailed = unmailedTile(activity.data?.expiredUnmailed);
  return (
    <div className="admin-card overview">
      <div className="admin-card-header">
        <h2 className="admin-card-title">Auf einen Blick</h2>
        <Button
          type="button"
          className="admin-button admin-button--small"
          disabled={activity.loading || backup.loading || campaignRead.loading}
          onClick={() => {
            activity.reload();
            backup.reload();
            campaignRead.reload();
          }}
        >
          Aktualisieren
        </Button>
      </div>
      <div className="overview-tiles">
        <Tile
          label="Unterschriften"
          value={number(stats?.signerCount)}
          detail={
            activity.data
              ? `${number(activity.data.signedSince)} heute`
              : activity.error
                ? "Heutige Zahl nicht abrufbar"
                : null
          }
          action="Unterschriften verwalten"
          onAction={() => navigate("signatures")}
        />
        <Tile
          label="Warten auf Bestätigung"
          value={number(pending)}
          detail={
            expiring
              ? `${number(expiring)} ${expiring === 1 ? "Link läuft" : "Links laufen"} in den nächsten 6 Stunden ab`
              : activity.data
                ? "Kein Link läuft in den nächsten 6 Stunden ab"
                : null
          }
        />
        <Tile
          label="Ohne Bestätigungsmail verfallen"
          value={unmailed.value}
          detail={unmailed.detail}
          tone={unmailed.tone}
          action={unmailed.tone ? "E-Mail-Versand prüfen" : null}
          onAction={openEmailSettings}
        />
        <Tile
          label="Newsletter-Empfänger"
          value={number(stats?.subscriberCount)}
          action="Nachricht senden"
          onAction={() => navigate("campaigns")}
        />
        <Tile
          label="E-Mail-Versand"
          value={mail.value}
          detail={mail.detail}
          tone={mail.tone}
          action="E-Mail-Einstellungen"
          onAction={openEmailSettings}
        />
        <Tile
          label="Offene Zustellprobleme"
          value={emailStatus ? number(deliveryIssues.length) : "–"}
          detail={
            deliveryIssues.length
              ? deliveryIssues.map((issue) => issue.title).join(" · ")
              : emailStatus
                ? "Keine"
                : null
          }
          tone={deliveryIssues.length ? "warning" : undefined}
          action={deliveryIssues.length ? "Ansehen" : null}
          onAction={openEmailSettings}
        />
        <Tile
          label="Nächste Kampagne"
          value={
            next
              ? Date.parse(next.scheduled_at) <= now
                ? "Wird gleich gesendet"
                : dateTime(next.scheduled_at)
              : campaignRead.data
                ? "Keine geplant"
                : "–"
          }
          detail={next?.subject}
          action="Zum Versand"
          onAction={() => navigate("campaigns")}
        />
        <Tile
          label="Letzte Sicherung"
          value={backupState.value}
          detail={backupState.detail}
          tone={backupState.tone}
        />
      </div>
    </div>
  );
}
