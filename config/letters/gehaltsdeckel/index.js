// Per-letter configuration for the "Gehaltsdeckel jetzt" campaign.
//
// This is the reference example campaign that ships with the template. To launch
// a new open letter, copy this directory to config/letters/<your-letter>/, adjust
// the values below + the rich content in ./content.jsx, drop assets into public/,
// set LETTER_CONFIG=<your-letter> in the environment, and deploy. See README.md.
//
// This module is plain data (no JSX) so it can be imported by BOTH the server
// and the client bundle. Rich page content (the letter body, the FAQ) lives in
// ./content.jsx, which is imported only by the frontend.

const colors = {
  rot: "#ff0000",
  rotText: "#cc0000",
  akzent: "#6f003c",
  weiss: "#ffffff",
  fond: "#f4f1ec",
  grau: "#5c5c5c",
  grauStark: "#4a4a4a",
  grauHell: "#e6e6e6",
  erfolg: "#0a7a3a",
  fehler: "#b00020",
};

export default {
  // ---- Identity / branding ---------------------------------------------------
  brand: {
    name: "Gehaltsdeckel jetzt",
    // Wordmark shown in the top bar (a leading dot is rendered separately).
    wordmark: "Gehaltsdeckel jetzt.",
    lang: "de",
    locale: "de-DE",
  },

  // ---- Colour & styling ------------------------------------------------------
  // Single source of truth for every colour and visual token used by the page,
  // the emails, and the generated OG/signal images. Injected as :root CSS
  // variables on the frontend (see src/main.jsx) and read directly by the email
  // renderer and image generators.
  theme: {
    colors,
    fonts: {
      // Family names must match the @fontsource imports in src/index.css.
      display: '"Work Sans", Arial, sans-serif',
      body: '"Inter", system-ui, sans-serif',
    },
    style: {
      // Flat offset box-shadow (no blur) — the "political-poster brutalism" look.
      shadowOffset: "10px 10px 0",
      // Sharp corners throughout.
      radius: "0",
      borderWidth: "2px",
    },
  },

  // ---- HTML <head> metadata --------------------------------------------------
  meta: {
    title: "Gehaltsdeckel jetzt: Ein Brief von Genoss*innen",
    description:
      "Ein Brief von Genoss*innen der Partei Die Linke an den Vorstand und Bundestagsfraktion: Gehälter deckeln. Jetzt mitzeichnen.",
    ogDescription: "Wir fordern: Gehälter deckeln. Jetzt mitzeichnen.",
    canonicalUrl: "https://gehaltsdeckel.jetzt/",
    ogImage: "https://gehaltsdeckel.jetzt/og.png",
    siteName: "Gehaltsdeckel jetzt",
    ogLocale: "de_DE",
    // Inline SVG favicon (data: URI).
    faviconSvg:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='6' y='6' width='20' height='20' rx='3' fill='%23ff0000' transform='rotate(8 16 16)'/%3E%3C/svg%3E",
    // schema.org JSON-LD "about" entity.
    schemaAbout: {
      name: "Diätendeckel",
      description:
        "Initiative für eine Gehaltsobergrenze für Abgeordnete der Partei Die Linke",
    },
    // Optional privacy-friendly analytics (Umami-style). Leave src empty to
    // disable (and to drop the host from the CSP).
    analytics: {
      src: "https://stats.gehaltsdeckel.jetzt/script.js",
      websiteId: "05e06fcd-fe90-4a03-a962-318c20e4107b",
    },
  },

  // ---- Hero ------------------------------------------------------------------
  hero: {
    // Each line renders as a styled span; style "banner" = filled wedge, "light".
    headlineLines: [
      { text: "Gehalt", style: "banner" },
      { text: "deckeln.", style: "banner" },
      { text: "Jetzt.", style: "light" },
    ],
    counterLabel: "Unterschriften",
    goalLabelPrefix: "Ziel:",
    goalMetaLabel: "verifizierte Mitzeichner*innen",
    ctaPrimary: "Jetzt mitzeichnen",
    ctaSecondary: "Brief lesen",
    // Seed default for the goal milestones. The live value is admin-editable
    // (stored in app_settings, exposed via /api/stats) — see the admin panel.
    milestones: [1000, 1300, 1600, 2000, 2300, 2500],
  },

  // ---- Navigation ------------------------------------------------------------
  nav: [
    { id: "brief", label: "Brief" },
    { id: "unterzeichnen", label: "Unterzeichnen" },
    { id: "liste", label: "Unterstützer*innen" },
    { id: "faq", label: "FAQ" },
  ],
  navCta: "Mitzeichnen",

  // ---- Signer list section ---------------------------------------------------
  list: {
    sectionNum: "03 / Schon dabei",
    // {count} is replaced with the live verified-signature total.
    headingHtml: "{count} Genoss*innen<br>haben unterzeichnet.",
  },

  // ---- Sign section ----------------------------------------------------------
  sign: {
    sectionNum: "02 / Mitzeichnen",
    headingHtml: 'Setz deinen<br />Namen <span class="rot">drunter.</span>',
    criteria: [
      "Du bist Mitglied oder Sympathisant*in der Partei Die Linke.",
      "Du stehst hinter diesem Brief.",
      "Du kannst wählen, ob dein Name öffentlich angezeigt wird.",
    ],
    privacyNote:
      "Deine E-Mail-Adresse wird ausschließlich zur Verifizierung deiner Unterschrift verwendet und nicht öffentlich gezeigt. Eine Unterschrift wird erst nach Bestätigung per E-Mail gezählt. Du kannst deine Zustimmung jederzeit zurückziehen.",
    formTitle: "Unterschreiben in 30 Sekunden",
    formSubtitle: "Felder ausfüllen, bestätigen per E-Mail. Fertig.",
    // The two optional, free-text columns that already exist on the `signers`
    // table (`kreisverband`, `occupation`). Set `enabled: false` (or the matching
    // feature flag below) to hide a field from the form, list, and admin.
    fields: {
      kreisverband: {
        label: "Kreisverband",
        optionalLabel: " optional",
        placeholder: "z. B. Berlin-Neukölln",
        autocomplete: true,
        // Stored values get a leading "KV " prefix stripped on submit.
        stripPrefix: "KV",
      },
      occupation: {
        label: "Beruf",
        optionalLabel: " optional",
        placeholder: "z. B. Sozialarbeiter*in",
        autocomplete: true,
      },
    },
  },

  // ---- Footer ----------------------------------------------------------------
  footer: {
    heading: "Gehaltsdeckel jetzt.",
    blurb:
      "Eine offene Initiative aus den Kreisverbänden. Kein offizielles Schreiben des Parteivorstandes oder der Bundestagsfraktion.",
    contactEmail: "kontakt@gehaltsdeckel.jetzt",
  },

  // ---- Legal (Impressum / Datenschutz responsible entity) --------------------
  legal: {
    entityName: "Klinke e.V.",
    contactName: "Marlen Borchardt",
    addressLines: ["Volckmarstr. 5", "04317 Leipzig"],
    addressInline: "Volckmarstr. 5, 04317 Leipzig",
    contactEmail: "kontakt@gehaltsdeckel.jetzt",
    disclaimer:
      "Diese Website ist kein offizielles Angebot der Partei Die Linke. Es handelt sich um eine private Initiative von Parteimitgliedern an der Basis.",
  },

  // ---- Email -----------------------------------------------------------------
  email: {
    // Verified sender. Overridable via EMAIL_FROM / RESEND_FROM.
    from: '"Gehaltsdeckel Initiative" <noreply@gehaltsdeckel.jetzt>',
    signoff: "Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel",
    // Transport: "resend" (Resend HTTP API) or "smtp" (any SMTP server).
    // Overridable per-deployment via EMAIL_PROVIDER.
    provider: "resend",
    // Read only when provider === "smtp". Non-secret connection details only —
    // credentials come from env (SMTP_USER / SMTP_PASS). Host/port/secure are
    // env-overridable via SMTP_HOST / SMTP_PORT / SMTP_SECURE.
    smtp: {
      host: "",
      port: 587, // 465 = implicit TLS (set secure: true); 587 = STARTTLS
      secure: false,
    },
    // Delays (ms) the mailing workers insert to respect provider rate limits.
    // Overridable via EMAIL_MESSAGE_DELAY_MS / EMAIL_BATCH_DELAY_MS.
    pacing: {
      messageDelayMs: 550, // between one-by-one sends (zoom link mailing); ~2/s
      batchDelayMs: 1000, // between 100-email batch chunks (campaigns, reminders)
    },
    // Default transactional templates seeded into the DB (db/setup.js) and used
    // as fallbacks (server/email.js). Admin can override them at runtime.
    templates: {
      verification: {
        name: "Bestatigung der Unterschrift",
        subject: "Bitte bestätige deine Unterschrift — Gehaltsdeckel jetzt",
        htmlBody: `
      <p>Hallo {{name}},</p>
      <p>Danke für deine Unterschrift unter den offenen Brief „Gehaltsdeckel jetzt".</p>
      <p><a href="{{confirmUrl}}">Klicke hier, um deine E-Mail zu bestätigen</a></p>
      <p>Der Link ist 24 Stunden gültig.</p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
      },
      already_signed: {
        name: "Bereits unterschrieben",
        subject: "Du hast bereits unterschrieben — Gehaltsdeckel jetzt",
        htmlBody: `
      <p>Hallo {{name}},</p>
      <p>deine Unterschrift unter den offenen Brief „Gehaltsdeckel jetzt" ist bereits bestätigt und wird gezählt.</p>
      <p>Du musst nichts weiter tun – danke für deine Solidarität!</p>
      <p>Möchtest du deine Angaben ändern (Name, Kreisverband, Beruf, Sichtbarkeit) oder dich abmelden? Hier kannst du deine Daten bearbeiten: <a href="{{unsubscribeUrl}}">{{unsubscribeUrl}}</a></p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
      },
      deletion: {
        name: "Loschung der Unterschrift",
        subject: "Deine Unterschrift löschen — Gehaltsdeckel jetzt",
        htmlBody: `
      <p>Hallo,</p>
      <p>du hast die Löschung deiner Unterschrift und aller gespeicherten Daten angefordert.</p>
      <p><a href="{{deleteUrl}}">Klicke hier, um deine Daten unwiderruflich zu löschen</a></p>
      <p>Der Link ist 24 Stunden gültig. Wenn du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.</p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
      },
      zoom_confirmation: {
        name: "Treffen-Anmeldung Bestatigung",
        subject:
          "Du bist dabei — Auswertungstreffen{{eventWhen}} — Gehaltsdeckel jetzt",
        htmlBody: `
      <p>Hallo {{firstName}},</p>
      <p>danke für deine Anmeldung zum Auswertungstreffen der Unterzeichner*innen<strong>{{eventWhen}}</strong>.</p>
      <p>Wir schauen gemeinsam zurück auf die Aktion und den Parteitag, ziehen ein Fazit und besprechen mögliche nächste Schritte.</p>
      {{linkInfo}}
      <p>Bis dann und mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
      },
      zoom_link: {
        name: "Treffen-Infos (1 Tag vorher)",
        subject: "Infos zum Auswertungstreffen am {{eventLabel}}",
        htmlBody: `
      <p>Hallo {{firstName}},</p>
      <p>morgen ist es so weit — unser Auswertungstreffen am <strong>{{eventLabel}}</strong>. Hier sind alle Infos:</p>
      {{linkInfo}}
      <p>Den passenden Kalendereintrag findest du im Anhang (.ics) oder über den Button oben.</p>
      <p>Bis morgen und mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
      },
      zoom_reminder: {
        name: "Treffen-Erinnerung (2 Std. vorher)",
        subject: "Gleich geht's los — Auswertungstreffen in 2 Stunden",
        htmlBody: `
      <p>Hallo {{firstName}},</p>
      <p>kleine Erinnerung: In rund 2 Stunden startet unser Auswertungstreffen am <strong>{{eventLabel}}</strong>.</p>
      {{linkInfo}}
      <p>Wir freuen uns auf dich!<br>Initiative Gehaltsdeckel</p>
    `,
      },
      zoom_newsletter_invite: {
        name: "Newsletter → Treffen-Einladung",
        subject:
          "Bist du dabei? Auswertungstreffen{{eventWhen}} — Gehaltsdeckel jetzt",
        htmlBody: `
      <div class="email-shell">
        <p class="anrede">Hallo {{firstName}},</p>
        <p>die Aktion war erfolgreich — auf dem Bundesparteitag wurde der Gehaltsdeckel beschlossen. Zeit, gemeinsam auszuwerten: Wir laden dich herzlich zum Auswertungstreffen<strong>{{eventWhen}}</strong> ein.</p>
        <p>In dem Treffen schauen wir zurück auf die Aktion und den Parteitag, ziehen ein Fazit und besprechen mögliche nächste Schritte.</p>
        <p><strong>Melde dich jetzt mit einem Klick an:</strong></p>
        <p>
          <a href="{{zoomJaUrl}}" style="display:inline-block;background:#ff0000;color:#ffffff;font-family:'Work Sans',Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border:2px solid #6f003c;">Ja, ich bin dabei</a>
        </p>
        <p>
          <a href="{{zoomJaDelegiertUrl}}" style="display:inline-block;background:#6f003c;color:#ffffff;font-family:'Work Sans',Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border:2px solid #6f003c;">Ja, ich bin dabei und bin Delegierte*r</a>
        </p>
        <p>Deine Angaben (Name, Kreisverband) werden automatisch aus deiner Unterschrift übernommen — du musst nichts weiter ausfüllen.</p>
        <p class="gruss">Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
        <footer>Du erhältst diese E-Mail, weil du Updates abonniert hast. <a href="{{unsubscribeUrl}}">E-Mails abbestellen</a>.</footer>
      </div>
    `,
      },
      "open-letter-update": {
        name: "Open Letter Update",
        subject:
          "Update: Gehaltsdeckel jetzt — {{signerCount}} Mitzeichner*innen",
        htmlBody: `
      <div class="email-shell">
        <h1>Ein Brief von Genoss*innen</h1>
        <p class="anrede">Liebe Genoss*innen,</p>
        <p>in diesem Brief melden wir uns als aktive Mitglieder der Linken - mit und ohne Funktion - zu Wort. Wir wollen uns konstruktiv in die Debatte um den Gehaltsdeckel für Mandatsträger*innen einbringen, die in den vergangenen Wochen von Abgeordneten teils unschön über die Medien geführt wurde. Denn es ist uns wichtig, dass unsere Perspektive gehört wird.</p>
        <p>Der Parteivorstand hat dem nächsten Bundesparteitag in Potsdam einen Antrag zur Begrenzung der Diäten von Mandatsträger*innen vorgelegt. Für uns ist dieser Antrag absolut richtig und längst überfällig. Denn natürlich ist in einer Partei wie der Linken die Rolle von Mandatsträger*innen und ihr Verhältnis zur Partei eine zentrale politische Frage. Wir wollen über den Diätendeckel demokratisch diskutieren, und zwar auf dem Parteitag. Genau dort gehört diese Auseinandersetzung hin.</p>
        <p>Das Comeback 2025 wurde nicht von Mandatsträger*innen allein ermöglicht. Es wurde von tausenden Mitgliedern getragen, die ihre Feierabende, ihre Wochenenden und ihre Energie mit Wahlkampf verbracht haben.</p>
        <blockquote class="pullquote">„Die Linke wurde von uns allen gerettet."</blockquote>
        <p>Wir erwarten, dass Mandate in der Linken anders verstanden werden als in anderen Parteien: als politische Verantwortung gegenüber der Partei und den Menschen, die sie tragen. Und nicht als persönliche Karrieremöglichkeit. Ein wirksamer Gehaltsdeckel ist es für uns nur, wenn wir uns an den Durchschnittslöhnen in diesem Land orientieren.</p>
        <p>Wir alle teilen eine Vision. Das Comeback 2025 war nur der erste Schritt. Wir wollen die Linke weiter aufbauen, Menschen organisieren und so eine nachhaltige sozialistische Politik schaffen.</p>
        <p class="gruss">Mit solidarischen Grüßen</p>
        <p class="signers-line">{{signerCount}} Mitglieder und Sympathisant*innen der Partei Die Linke</p>
        <footer>Du erhältst diese E-Mail, weil du Updates abonniert hast. <a href="{{unsubscribeUrl}}">E-Mails abbestellen oder Unterschrift löschen</a>.</footer>
      </div>
    `,
      },
    },
  },

  // ---- Optional / domain-specific feature flags ------------------------------
  features: {
    // The two optional signer fields (also see sign.fields above).
    kreisverbandField: true,
    occupationField: true,
    // The Germany SVG map of signers by Bundesland + the background process that
    // resolves a Kreisverband name -> Bundesland (Nominatim). Both imply
    // kreisverbandField. Disable for non-German / non-regional letters.
    germanyMap: true,
    stateResolution: true,
    // The Zoom-event signup module (nav link, störer, registration form,
    // reminder mails). Read the `zoom` block below when enabled.
    zoomEvent: true,
    // "Accomplished" / wind-down mode. When true, the hero shows the `success`
    // announcement (instead of the counter + primary sign CTA), the sign form is
    // removed, and the signer list + FAQ are rendered collapsed. The letter body
    // stays open. Reversible: set false to restore the live campaign page.
    successMode: true,
    // Which main content sections render folded into a single shared accordion
    // block (one bordered list, like the FAQ's own items) instead of full
    // height. Valid ids: "brief", "unterzeichnen", "liste", "faq". Consecutive
    // collapsed sections merge; a non-collapsed one between them splits the
    // group. When omitted, successMode defaults this to ["liste", "faq"].
    collapsedSections: ["liste", "faq"],
  },

  // ---- Success / accomplished announcement (only read when features.successMode)
  // Shown at the top of the page once the campaign goal is reached. All copy is
  // config-driven so any letter can reuse this without touching src/App.jsx.
  success: {
    kicker: "Geschafft.",
    headline: "Der Gehaltsdeckel ist beschlossen.",
    body: "Danke an alle, die mitgezeichnet haben: Auf dem Bundesparteitag in Potsdam wurde der Antrag zur Begrenzung der Diäten von Mandatsträger*innen beschlossen. Jetzt werten wir die Aktion gemeinsam aus.",
    // TODO: echte URL zum beschlossenen Antrag / Beschluss eintragen.
    antragUrl: "TODO-ANTRAG-URL",
    antragLabel: "Zum beschlossenen Antrag",
    ctaZoom: "Zum Auswertungstreffen anmelden",
    // Kept in the accomplished hero as a proof-of-impact stat. The live verified
    // signature total is prepended. Set to "" to hide the stat entirely.
    countLabel: "Genoss*innen haben unterzeichnet",
  },

  // ---- Treffen / event (only read when features.zoomEvent) -------------------
  // A "Treffen" (meeting) that can be online (video/Zoom link) or in person
  // (physical location) — see `mode` below. eventAt/link/label are admin-editable
  // at runtime (app_settings); for online meetings the join link is set in the
  // admin. `section`/`form` hold the on-page copy (kept out of src/App.jsx so
  // every letter is fully config-driven). Internally this still uses the
  // "zoom_*" table/endpoints — only the user-facing wording is "Treffen".
  zoom: {
    eventLabel: "Termin folgt",
    eventAt: null,
    durationMin: 90,
    // "online" = video call with a join link; "inperson" = physical location.
    mode: "online",
    // Shown to attendees when mode === "inperson" (on the page, in emails and
    // the calendar file). mapsUrl is an optional link to a map.
    location: { name: "", address: "", mapsUrl: "" },
    // Label for the Treffen link in the nav and CTA (config-driven, per letter).
    navLabel: "Auswertungstreffen",
    section: {
      sectionNum: "02 / Auswertungstreffen",
      headingHtml: 'Wir werten<br /><span class="rot">gemeinsam aus.</span>',
      whenText: "Termin wird noch bekanntgegeben",
      bullets: [
        "Wir schauen gemeinsam zurück auf die Aktion und den Parteitag.",
        "Wir besprechen, was gut lief und was wir daraus mitnehmen.",
        "Wir verabreden mögliche nächste gemeinsame Schritte.",
      ],
      privacy:
        "Alle Infos zum Treffen schicken wir dir vor dem Termin per E-Mail. Deine Angaben nutzen wir ausschließlich für die Organisation des Treffens.",
    },
    // Copy for the signup form itself (src/ZoomForm.jsx). All config-driven so a
    // new letter can relabel the button and messages without touching code.
    form: {
      badge: "Anmeldung",
      title: "Anmelden in 30 Sekunden",
      subtitle: "Alle Infos zum Treffen bekommst du per E-Mail.",
      submitLabel: "Zum Auswertungstreffen anmelden",
      submittingLabel: "Wird gesendet…",
      legal:
        "Wir nutzen deine Angaben nur zur Organisation des Treffens und schicken dir alle Infos rechtzeitig per E-Mail.",
      // Delegierte*r checkbox: only relevant while a Parteitag is upcoming.
      // Turned off for the Auswertungstreffen (the Parteitag has happened).
      showDelegierter: false,
      delegierterLabel: "Ich bin Delegierte*r.",
      // Success/confirmation panel after submitting.
      doneBadge: "Angemeldet",
      doneTitle: "Du bist dabei.",
      doneText:
        "Wir haben dir eine Bestätigung per E-Mail geschickt. Alle Infos zum Treffen bekommst du rechtzeitig vor dem Termin.",
    },
  },
};
