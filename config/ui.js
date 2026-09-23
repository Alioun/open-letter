// Interface texts that used to be hard-coded in the components. A letter can
// override any key in its `ui` block, and every key is editable at runtime in
// the admin panel ("Texte & Modus", config/editable.js). {placeholders} are
// filled with fillText().
export const UI_DEFAULTS = {
  // Topbar, navigation, footer.
  chrome: {
    skipLink: "Zum Inhalt springen",
    toTop: "Zum Seitenanfang",
    mainNav: "Hauptnavigation",
    mobileNav: "Mobilnavigation",
    menuOpen: "Menü öffnen",
    menuClose: "Menü schließen",
    close: "Schließen",
    footerContact: "Kontakt",
    footerLegal: "Rechtliches",
    impressum: "Impressum",
    datenschutz: "Datenschutz",
  },
  // Hero counter and the milestone "Störer".
  hero: {
    ariaCampaign: "Titelbild und Unterschriftenzähler",
    ariaSuccess: "Ankündigung",
    counterAria: "{total} von {goal} Unterschriften",
    progressAria: "Fortschritt zum Unterschriftenziel",
    reached: "{pct}% erreicht",
    updated: "Aktualisiert {time}",
    successCtaFallback: "Anmelden",
    successAntragFallback: "Mehr erfahren",
  },
  // Shown next to the counter once `showFrom` signatures are reached (Treffen
  // module only). 0 hides it.
  stoerer: {
    showFrom: 2000,
    aria: "Jetzt zum Treffen anmelden",
    head: "Wir sind {count}!",
    body: "Jetzt treffen wir uns und planen die nächsten Schritte.",
    cta: "Sei dabei!",
  },
  // Section aria labels.
  sections: {
    brief: "Der offene Brief",
    sign: "Unterschriftenformular",
    list: "Liste der Unterstützer*innen",
    faq: "FAQ",
    zoom: "Anmeldung zum Treffen",
  },
  // Signer list.
  list: {
    last24h: "in den letzten 24 Stunden",
    statTotal: "Gesamt verifiziert",
    statToday: "Heute",
    statWeek: "Diese Woche",
    filterAria: "Filter",
    filterAll: "Alle",
    filterNewest: "Neueste",
    filterMap: "Karte",
    filterOccupations: "Berufe",
    searchLabel: "Suche nach Name oder {region}",
    searchPlaceholder: "Suchen nach Name oder {region}…",
    loadingMap: "Lade Karte…",
    emptyRegions: "Noch keine {regions}.",
    emptyOccupations: "Noch keine Berufe angegeben.",
    loading: "Lade Unterschriften…",
    loadError: "Daten konnten nicht geladen werden.",
    shown: "{shown} von {total} angezeigt",
    loadMore: "Weitere laden",
    mapChipAria: "{name}: {count} Unterschriften, Details anzeigen",
    mapPopupAria: "{name}: {count} Unterschriften",
  },
  // "vor …" on each signer row.
  time: {
    prefix: "vor",
    justNow: "gerade eben",
    minutes: "{n} Min",
    hours: "{n} Std",
    day: "{n} Tag",
    days: "{n} Tagen",
    weeks: "{n} Wo",
    months: "{n} Mon",
  },
  // Sign form.
  signForm: {
    badge: "Mitzeichnen",
    nameLabel: "Name",
    nameHint: "wird öffentlich gezeigt",
    namePlaceholder: "z. B. Anna Berger",
    emailLabel: "E-Mail",
    emailHint: "nur zur Verifizierung, nicht öffentlich",
    emailPlaceholder: "anna@example.org",
    // {fields}: " (und ggf. Kreisverband/Beruf)" when those fields are on.
    publicLabel: "Mein Name{fields} darf öffentlich auf dieser Seite angezeigt werden.",
    publicFieldsExtra: " (und ggf. {fields})",
    optional: "(optional)",
    newsletterLabel:
      "Haltet mich zur Initiative auf dem Laufenden (gelegentliche E-Mails, jederzeit abbestellbar).",
    submitting: "Wird gesendet…",
    legal:
      "Mit Klick auf „Mitzeichnen\" schicken wir dir einen Bestätigungslink an deine E-Mail. Erst danach zählt deine Unterschrift.",
    errName: "Bitte gib deinen vollständigen Namen an.",
    errEmail: "Bitte gib eine gültige E-Mail-Adresse an.",
  },
  // "Bitte E-Mail bestätigen" after submitting.
  emailModal: {
    title: "Bitte E-Mail bestätigen",
    sent: "Danke, {name}. Wir haben dir einen Bestätigungslink geschickt an:",
    explain:
      "Erst nach dem Klick auf den Link in dieser E-Mail wird deine Unterschrift gezählt und öffentlich gelistet.",
    spamHint: "Keine E-Mail erhalten? Schau in den Spam-Ordner.",
    delayHint: "E-Mails können manchmal ein paar Minuten auf sich warten lassen.",
    resendSent: "E-Mail gesendet ✓ nochmal in {seconds}s",
    resendWait: "Erneut senden in {seconds}s",
    resend: "Link erneut anfordern",
    ok: "Verstanden",
  },
  // After confirming.
  successModal: {
    title: "Unterschrift gezählt",
    heading: "Solidarisch dabei.",
    body: "Deine Unterschrift ist jetzt Teil des offenen Briefes. Teile ihn mit deinem Kreisverband - wir wollen vor dem nächsten Parteitag bei {goal} stehen.",
    showMe: "Mich in der Liste zeigen",
  },
  deletedModal: {
    title: "Daten gelöscht",
    heading: "Erledigt.",
    body: "Deine Unterschrift und alle damit verbundenen Daten wurden unwiderruflich gelöscht.",
  },
  // Error texts users see. The server's public errors are here too.
  errors: {
    generic: "Ein Fehler ist aufgetreten.",
    network: "Verbindung fehlgeschlagen. Bitte versuche es erneut.",
    resendFailed: "Senden fehlgeschlagen. Bitte versuche es später erneut.",
    tokenExpired:
      "Dieser Bestätigungslink wurde schon verwendet oder ist abgelaufen. Vielleicht ist deine Unterschrift also schon bestätigt: Trag einfach noch einmal dieselbe E-Mail-Adresse ein. Ist sie schon bestätigt, bekommst du eine E-Mail, dass alles passt – sonst noch einmal einen Bestätigungslink.",
    deleteTokenExpired:
      "Der Löschlink ist abgelaufen. Bitte fordere über die Datenschutzseite einen neuen an.",
    tooMany: "Zu viele Anfragen. Bitte versuche es später erneut.",
    nameTooShort: "Name muss mindestens 2 Zeichen lang sein.",
    invalidEmail: "Bitte gib eine gültige E-Mail-Adresse an.",
  },
  // Treffen form labels without their own config key.
  zoomForm: {
    nameLabel: "Name",
    emailLabel: "E-Mail",
    emailHint: "für die Bestätigung und alle Infos",
    kvLabel: "Kreisverband",
    kvHint: "optional",
    locationLabel: "Ort:",
    mapLink: "Karte",
  },
  // /abmelden/<token>: the email settings page.
  settings: {
    title: "E-Mail-Einstellungen",
    checking: "Link wird geprüft …",
    offline: "Du bist offline. Bitte prüfe deine Verbindung und lade die Seite neu.",
    invalidLink: "Dieser Link ist nicht mehr gültig.",
    connectionFailed: "Die Verbindung ist fehlgeschlagen.",
    useNewestLink: "Bitte nutze den neuesten Link aus einer unserer E-Mails.",
    retry: "Erneut versuchen",
    thanks: "Danke für deine Rückmeldung.",
    oldLink:
      "Wir haben dir seit mehr als {days} Tagen keine E-Mail mit diesem Link geschickt. Abmelden kannst du dich weiterhin. Um deine Angaben zu ändern oder deine Unterschrift zu löschen, nutze den Link aus einer neueren E-Mail oder das Löschformular in der Datenschutzerklärung.",
    detailsHeading: "Deine Angaben",
    detailsIntro: "Hier kannst du deine Daten jederzeit anpassen.",
    saved: "Deine Angaben wurden aktualisiert.",
    nameLabel: "Name",
    optional: "optional",
    occupationLabel: "Beruf",
    showPublicly: "Meinen Namen öffentlich anzeigen",
    inviteShowName: "Meinen Vornamen auf meinem Einladungslink zeigen",
    newsletter: "Newsletter-Updates erhalten",
    delegierter: "Ich bin Delegierte*r zum Parteitag.",
    saving: "Wird gespeichert …",
    save: "Angaben speichern",
    errNameLong: "Bitte kürze den Namen auf maximal 100 Zeichen.",
    errKvLong: "Bitte kürze den {region} auf maximal 80 Zeichen.",
    errOccupationLong: "Bitte kürze den Beruf auf maximal 80 Zeichen.",
    errFields: "Bitte korrigiere die markierten Felder.",
    offlineShort: "Du bist offline. Bitte prüfe deine Verbindung.",
    saveFailed: "Speichern fehlgeschlagen.",
    actionFailed:
      "Die Aktion konnte nicht abgeschlossen werden. Bitte versuche es später erneut.",
    actionFailedConnection:
      "Die Aktion konnte nicht abgeschlossen werden. Bitte prüfe deine Verbindung.",
    doneNewsletter:
      "Du erhältst keine Newsletter-Updates mehr. Deine Unterschrift bleibt bestehen.",
    doneZoom: "Du erhältst keine Zoom-Mails mehr. Deine Anmeldung wurde entfernt.",
    doneAll: "Du bist von allem abgemeldet.",
    doneDelete: "Deine Unterschrift und die damit verbundenen Daten wurden gelöscht.",
    done: "Erledigt.",
    chooseUnsubscribe: "Wähle, wovon du dich abmelden möchtest:",
    unsubscribingAll: "Wird abgemeldet …",
    unsubscribeAll: "Von allem abmelden",
    unsubscribingNewsletter: "Wird abbestellt …",
    unsubscribeNewsletter: "Keine Newsletter-Updates mehr",
    unsubscribingZoom: "Wird abgemeldet …",
    unsubscribeZoom: "Keine Zoom-Mails mehr",
    alreadyUnsubscribed:
      "Du bist bereits von allen E-Mails abgemeldet. Deine Unterschrift ist weiterhin sichtbar.",
    deleteIntro:
      "Du kannst auch deine Unterschrift und alle damit verbundenen Daten unwiderruflich löschen:",
    deleting: "Wird gelöscht …",
    delete: "Unterschrift vollständig löschen",
  },
};

// Fill {key} placeholders; unknown keys are left as they are.
export function fillText(text, values = {}) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) =>
    k in values ? String(values[k] ?? "") : m,
  );
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

// Deep merge for plain config objects: `over` wins, arrays are replaced.
export function deepMerge(base, over) {
  if (!isPlainObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}
