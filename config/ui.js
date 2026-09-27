// Interface texts that used to be hard-coded in the components. A letter can
// override any key in its `ui` block, and every key is editable at runtime in
// the admin panel ("Texte & Modus", config/editable.js). {placeholders} are
// filled with fillText(). UI_DEFAULTS is the German table; UI_TRANSLATIONS
// holds the other languages with the same keys (uiDefaults(lang) picks one).
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
  // Wording the server sends to public users: meeting dates, mail parts, the
  // meeting info block, calendar files. Strings with <p> are trusted HTML.
  server: {
    // Meeting date, e.g. "9. Juni, 20:00 Uhr".
    dateLabel: "{day}, {time} Uhr",
    // {label} is the date label; empty while no date is set.
    when: " am {label}",
    meetingFallback: "Treffen",
    noDateYet: "Termin noch nicht festgelegt.",
    // How long before the meeting the join link arrives.
    oneHour: "eine Stunde",
    hours: "{n} Stunden",
    oneDay: "einen Tag",
    days: "{n} Tage",
    // Words for 1 to 7 days, comma-separated; larger numbers stay digits.
    numberWords: "eins,zwei,drei,vier,fünf,sechs,sieben",
    shortly: "kurz",
    meetInPerson: "<p>Wir treffen uns <strong>vor Ort</strong>: {where}.</p>",
    placeLater:
      "<p>Den genauen Ort schicken wir dir rechtzeitig vor dem Termin per E-Mail.</p>",
    mapLink: "Auf der Karte ansehen",
    linkPending:
      "<p>Den <strong>Einwahllink bekommst du {timing} vor dem Termin</strong> per E-Mail.</p>",
    // {link} is the finished <a> element.
    linkNow: "<p>Hier geht's direkt zum Treffen: {link}</p>",
    linkLater:
      "<p>Den Einwahllink schicken wir dir rechtzeitig vor dem Termin per E-Mail.</p>",
    calendarButton: "Zum Kalender hinzufügen",
    unsubscribeFooter:
      '<footer>Du möchtest keine E-Mails mehr erhalten? <a href="{url}">Hier abmelden</a>.</footer>',
    // Calendar file (.ics).
    icsSummary: "Treffen - {brand}",
    icsPlace: "Treffen der {brand}.\nOrt: {where}",
    icsPlaceLater: "Treffen der {brand}.\nDen genauen Ort bekommst du per E-Mail.",
    icsInPerson: "Vor Ort",
    icsOnlineLocation: "Online",
    icsOnline: "Online-Treffen der {brand}.\nEinwahl: {link}",
    icsOnlineLater: "Online-Treffen der {brand}.\nDen Einwahllink bekommst du per E-Mail.",
  },
};


// The same table in English. Every key of UI_DEFAULTS, with the same
// {placeholders} (test/ui-parity.test.js checks both).
const UI_EN = {
  chrome: {
    skipLink: "Skip to content",
    toTop: "Back to top",
    mainNav: "Main navigation",
    mobileNav: "Mobile navigation",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    close: "Close",
    footerContact: "Contact",
    footerLegal: "Legal",
    impressum: "Legal notice",
    datenschutz: "Privacy",
  },
  hero: {
    ariaCampaign: "Title and signature counter",
    ariaSuccess: "Announcement",
    counterAria: "{total} of {goal} signatures",
    progressAria: "Progress towards the signature goal",
    reached: "{pct}% reached",
    updated: "Updated {time}",
    successCtaFallback: "Sign up",
    successAntragFallback: "Learn more",
  },
  stoerer: {
    showFrom: 2000,
    aria: "Sign up for the meeting now",
    head: "We're {count}!",
    body: "Now we meet and plan the next steps.",
    cta: "Join us!",
  },
  sections: {
    brief: "The open letter",
    sign: "Signature form",
    list: "List of supporters",
    faq: "FAQ",
    zoom: "Meeting sign-up",
  },
  list: {
    last24h: "in the last 24 hours",
    statTotal: "Verified total",
    statToday: "Today",
    statWeek: "This week",
    filterAria: "Filter",
    filterAll: "All",
    filterNewest: "Newest",
    filterMap: "Map",
    filterOccupations: "Occupations",
    searchLabel: "Search by name or {region}",
    searchPlaceholder: "Search by name or {region}…",
    loadingMap: "Loading map…",
    emptyRegions: "No {regions} yet.",
    emptyOccupations: "No occupations given yet.",
    loading: "Loading signatures…",
    loadError: "Couldn't load the data.",
    shown: "{shown} of {total} shown",
    loadMore: "Load more",
    mapChipAria: "{name}: {count} signatures, show details",
    mapPopupAria: "{name}: {count} signatures",
  },
  time: {
    prefix: "",
    justNow: "just now",
    minutes: "{n} min ago",
    hours: "{n} h ago",
    day: "{n} day ago",
    days: "{n} days ago",
    weeks: "{n} wk ago",
    months: "{n} mo ago",
  },
  signForm: {
    badge: "Sign",
    nameLabel: "Name",
    nameHint: "shown publicly",
    namePlaceholder: "e.g. Anna Berger",
    emailLabel: "Email",
    emailHint: "only for verification, never public",
    emailPlaceholder: "anna@example.org",
    publicLabel: "My name{fields} may be shown publicly on this page.",
    publicFieldsExtra: " (and {fields}, if given)",
    optional: "(optional)",
    newsletterLabel:
      "Keep me posted about the campaign (occasional emails, unsubscribe any time).",
    submitting: "Sending…",
    legal:
      "When you click “Sign”, we email you a confirmation link. Your signature only counts after that.",
    errName: "Please enter your full name.",
    errEmail: "Please enter a valid email address.",
  },
  emailModal: {
    title: "Please confirm your email",
    sent: "Thank you, {name}. We've sent a confirmation link to:",
    explain:
      "Your signature is counted and listed publicly only after you click the link in that email.",
    spamHint: "No email? Check your spam folder.",
    delayHint: "Emails can sometimes take a few minutes to arrive.",
    resendSent: "Email sent ✓ again in {seconds}s",
    resendWait: "Resend in {seconds}s",
    resend: "Send the link again",
    ok: "Got it",
  },
  successModal: {
    title: "Signature counted",
    heading: "You're in.",
    body: "Your signature is now part of the open letter. Share it with your local branch - we want to reach {goal} before the next party congress.",
    showMe: "Show me in the list",
  },
  deletedModal: {
    title: "Data deleted",
    heading: "Done.",
    body: "Your signature and all data connected to it have been deleted for good.",
  },
  errors: {
    generic: "Something went wrong.",
    network: "Connection failed. Please try again.",
    resendFailed: "Sending failed. Please try again later.",
    tokenExpired:
      "This confirmation link has already been used or has expired. Your signature may already be confirmed: just enter the same email address again. If it is confirmed, we'll email you that all is well; if not, you'll get a new confirmation link.",
    deleteTokenExpired:
      "The deletion link has expired. Please request a new one from the privacy page.",
    tooMany: "Too many requests. Please try again later.",
    nameTooShort: "Your name must be at least 2 characters long.",
    invalidEmail: "Please enter a valid email address.",
  },
  zoomForm: {
    nameLabel: "Name",
    emailLabel: "Email",
    emailHint: "for the confirmation and all updates",
    kvLabel: "Local branch",
    kvHint: "optional",
    locationLabel: "Where:",
    mapLink: "Map",
  },
  settings: {
    title: "Email settings",
    checking: "Checking link …",
    offline: "You're offline. Please check your connection and reload the page.",
    invalidLink: "This link is no longer valid.",
    connectionFailed: "The connection failed.",
    useNewestLink: "Please use the latest link from one of our emails.",
    retry: "Try again",
    thanks: "Thanks for letting us know.",
    oldLink:
      "We haven't sent you an email with this link in over {days} days. You can still unsubscribe. To change your details or delete your signature, use the link from a more recent email or the deletion form in the privacy policy.",
    detailsHeading: "Your details",
    detailsIntro: "You can update your details here at any time.",
    saved: "Your details have been updated.",
    nameLabel: "Name",
    optional: "optional",
    occupationLabel: "Occupation",
    showPublicly: "Show my name publicly",
    inviteShowName: "Show my first name on my invite link",
    newsletter: "Get newsletter updates",
    delegierter: "I'm a delegate to the party conference.",
    saving: "Saving …",
    save: "Save details",
    errNameLong: "Please shorten the name to 100 characters or fewer.",
    errKvLong: "Please shorten the {region} to 80 characters or fewer.",
    errOccupationLong: "Please shorten the occupation to 80 characters or fewer.",
    errFields: "Please correct the highlighted fields.",
    offlineShort: "You're offline. Please check your connection.",
    saveFailed: "Saving failed.",
    actionFailed: "That didn't work. Please try again later.",
    actionFailedConnection: "That didn't work. Please check your connection.",
    doneNewsletter:
      "You won't get any more newsletter updates. Your signature stays.",
    doneZoom: "You won't get any more Zoom emails. Your registration was removed.",
    doneAll: "You're unsubscribed from everything.",
    doneDelete: "Your signature and all related data have been deleted.",
    done: "Done.",
    chooseUnsubscribe: "Choose what to unsubscribe from:",
    unsubscribingAll: "Unsubscribing …",
    unsubscribeAll: "Unsubscribe from everything",
    unsubscribingNewsletter: "Unsubscribing …",
    unsubscribeNewsletter: "No more newsletter updates",
    unsubscribingZoom: "Unsubscribing …",
    unsubscribeZoom: "No more Zoom emails",
    alreadyUnsubscribed:
      "You're already unsubscribed from all emails. Your signature is still visible.",
    deleteIntro:
      "You can also permanently delete your signature and all related data:",
    deleting: "Deleting …",
    delete: "Delete signature completely",
  },
  server: {
    dateLabel: "{day}, {time}",
    when: " on {label}",
    meetingFallback: "Meeting",
    noDateYet: "No date has been set yet.",
    oneHour: "one hour",
    hours: "{n} hours",
    oneDay: "one day",
    days: "{n} days",
    numberWords: "one,two,three,four,five,six,seven",
    shortly: "shortly",
    meetInPerson: "<p>We meet <strong>in person</strong>: {where}.</p>",
    placeLater:
      "<p>We'll email you the exact place in good time before the meeting.</p>",
    mapLink: "View on the map",
    linkPending:
      "<p>You'll get the <strong>join link {timing} before the meeting</strong> by email.</p>",
    linkNow: "<p>Join the meeting here: {link}</p>",
    linkLater:
      "<p>We'll email you the join link in good time before the meeting.</p>",
    calendarButton: "Add to calendar",
    unsubscribeFooter:
      '<footer>Don\'t want these emails any more? <a href="{url}">Unsubscribe here</a>.</footer>',
    icsSummary: "Meeting - {brand}",
    icsPlace: "{brand} meeting.\nPlace: {where}",
    icsPlaceLater: "{brand} meeting.\nWe'll email you the exact place.",
    icsInPerson: "In person",
    icsOnlineLocation: "Online",
    icsOnline: "{brand} online meeting.\nJoin: {link}",
    icsOnlineLater: "{brand} online meeting.\nWe'll email you the join link.",
  },
};

// Per-language tables besides the German UI_DEFAULTS.
export const UI_TRANSLATIONS = { en: UI_EN };

// The text table for a language; German for "de" and anything unknown.
export function uiDefaults(lang) {
  return UI_TRANSLATIONS[lang] || UI_DEFAULTS;
}

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
