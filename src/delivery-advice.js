// What the E-Mail card tells the team about failed and stuck mail, in plain
// words: what happened, who is affected, and what to do next. No markup, so
// the wording can be tested.

const when = (iso) =>
  new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  });

// [one, several, what it means for the people who did not get it]
const KINDS = {
  verification: [
    "Bestätigungsmail zu einer neuen Unterschrift",
    "Bestätigungsmails zu neuen Unterschriften",
    "Diese Menschen haben ihren Bestätigungslink nicht bekommen. Ihre Unterschrift zählt erst, wenn sie bestätigt ist.",
  ],
  "already-signed": [
    "Hinweis „Du hast schon unterschrieben“",
    "Hinweise „Du hast schon unterschrieben“",
    null,
  ],
  deletion: [
    "Link zum Löschen einer Unterschrift",
    "Links zum Löschen einer Unterschrift",
    "Diese Menschen warten auf den Link, mit dem sie ihre Unterschrift löschen.",
  ],
  invite: ["Einladungslink", "Einladungslinks", null],
  "newsletter-optin": [
    "Newsletter-Einwilligung",
    "Newsletter-Einwilligungen",
    null,
  ],
  "treffen-verification": [
    "Bestätigung einer Anmeldung zum Treffen",
    "Bestätigungen von Anmeldungen zum Treffen",
    "Diese Anmeldungen zum Treffen sind noch nicht bestätigt.",
  ],
  "treffen-already-registered": [
    "Hinweis zu einer bestehenden Anmeldung zum Treffen",
    "Hinweise zu bestehenden Anmeldungen zum Treffen",
    null,
  ],
  other: ["sonstige E-Mail", "sonstige E-Mails", null],
};

const kindOf = (kind) => KINDS[kind] || KINDS.other;

// The failed-mail box: one line per kind, the consequences, and how many can
// still be sent again.
export function failedMailSummary(detail, total) {
  const rows = detail?.byKind?.length
    ? detail.byKind
    : [{ kind: "other", count: total }];
  const lines = rows.map(({ kind, count }) => {
    const [one, several] = kindOf(kind);
    return `${count.toLocaleString("de-DE")} ${count === 1 ? one : several}`;
  });
  const effects = rows.map(({ kind }) => kindOf(kind)[2]).filter(Boolean);
  const span =
    detail?.firstAt && detail?.lastAt
      ? detail.firstAt.slice(0, 16) === detail.lastAt.slice(0, 16)
        ? `Aufgegeben am ${when(detail.lastAt)}.`
        : `Aufgegeben zwischen ${when(detail.firstAt)} und ${when(detail.lastAt)}.`
      : null;
  const retryable = detail?.retryable ?? null;
  const hours = detail?.retryableHours ?? 24;
  const retry =
    retryable === null
      ? `Nachrichten der letzten ${hours} Stunden lassen sich noch einmal senden.`
      : retryable === 0
        ? `Alle sind älter als ${hours} Stunden und lassen sich nicht mehr senden.`
        : retryable === total
          ? "Alle lassen sich noch einmal senden."
          : `${retryable.toLocaleString("de-DE")} davon lassen sich noch einmal senden; die übrigen sind älter als ${hours} Stunden.`;
  return { lines, effects, span, retry, retryable };
}

const CONNECTION_CODES = ["ESOCKET", "ETIMEDOUT", "ECONNECTION"];

// Where the server tries to deliver: "smtp.example.org, Port 465" or Resend.
function destination(profile) {
  if (!profile) return "den E-Mail-Server";
  if (profile.provider === "resend") return "Resend (api.resend.com)";
  return profile.host
    ? `${profile.host}, Port ${profile.port || "?"}`
    : "den E-Mail-Server";
}

// Advice for a send that failed because the server could not reach the
// mail service, or the service turned the mail away for now. Null for other
// failures, which keep their own advice.
export function temporaryFailureAdvice(failure, profile) {
  if (failure?.category !== "temporary-delivery") return null;
  const since = failure.at ? `Seit ${when(failure.at)} ` : "";
  const resend = profile?.provider === "resend";
  const test =
    "Sende unter „Profil ändern“ mit „Verbindung prüfen und Test senden“ eine Testnachricht. Kommt sie an, ist die Störung vorbei: Sende dann unten die nicht angekommenen E-Mails noch einmal.";
  const waiting =
    "Bis dahin werden Unterschriften weiter angenommen. Neue Bestätigungsmails warten in der Warteschlange und gehen raus, sobald der Versand wieder klappt.";
  if (!failure.protocol || CONNECTION_CODES.includes(failure.code))
    return {
      heading: "Der Server erreicht den E-Mail-Versand nicht",
      text: `${since}kommt keine Verbindung zu ${destination(profile)} zustande. Das liegt fast immer an der Verbindung dorthin, nicht an Konto oder Passwort.`,
      meanwhile: waiting,
      steps: [
        test,
        resend
          ? "Schlägt auch der Test fehl: Prüfe auf status.resend.com, ob Resend gestört ist. Ist dort alles in Ordnung, muss die Technik prüfen, ob der Server ins Internet kommt."
          : `Schlägt auch der Test fehl: Frag beim Hoster des Servers nach, ob ausgehende Verbindungen zu ${profile?.host || "dem E-Mail-Server"} auf Port ${profile?.port || "465 oder 587"} erlaubt sind. Viele Hoster sperren die Mail-Ports 25, 465 und 587, bis man sie freischalten lässt. Prüfe außerdem Servername und Port unter „Profil ändern“.`,
      ],
    };
  return {
    heading: "Der E-Mail-Anbieter nimmt gerade keine Nachrichten an",
    text: `${since}lehnt ${destination(profile)} Nachrichten vorübergehend ab (Antwort ${failure.protocol}). Das liegt beim Anbieter; der Versand versucht es von selbst weiter.`,
    meanwhile: waiting,
    steps: [
      "Prüfe beim Anbieter, ob eine Störung gemeldet ist oder das Konto gesperrt oder begrenzt wurde.",
      test,
    ],
  };
}
