// Example open letter — a minimal, generic campaign that demonstrates the
// template with the German/Die-Linke-specific features turned OFF (no
// Kreisverband/Beruf fields, no Germany map, no Zoom). Use it as a starting
// point for a new letter: `LETTER_CONFIG=example bun run dev`.

const colors = {
  rot: "#1d4ed8",
  rotText: "#1e40af",
  akzent: "#0f172a",
  weiss: "#ffffff",
  fond: "#f1f5f9",
  grau: "#5c5c5c",
  grauStark: "#4a4a4a",
  grauHell: "#e2e8f0",
  erfolg: "#0a7a3a",
  fehler: "#b00020",
};

export default {
  brand: {
    name: "Open Letter",
    wordmark: "Open Letter.",
    lang: "en",
    locale: "en-GB",
  },

  theme: {
    colors,
    fonts: {
      display: '"Work Sans", Arial, sans-serif',
      body: '"Inter", system-ui, sans-serif',
    },
    style: {
      shadowOffset: "10px 10px 0",
      radius: "0",
      borderWidth: "2px",
    },
  },

  meta: {
    title: "Open Letter — sign now",
    description: "An open letter. Add your name.",
    ogDescription: "An open letter. Add your name.",
    canonicalUrl: "http://localhost:3000/",
    ogImage: "http://localhost:3000/og.png",
    siteName: "Open Letter",
    ogLocale: "en_GB",
    faviconSvg:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='6' y='6' width='20' height='20' rx='3' fill='%231d4ed8' transform='rotate(8 16 16)'/%3E%3C/svg%3E",
    schemaAbout: {
      name: "Open Letter",
      description: "A public open letter campaign.",
    },
    analytics: { src: "", websiteId: "" },
  },

  hero: {
    headlineLines: [
      { text: "Sign the", style: "banner" },
      { text: "letter.", style: "banner" },
      { text: "Now.", style: "light" },
    ],
    counterLabel: "Signatures",
    goalLabelPrefix: "Goal:",
    goalMetaLabel: "verified signatories",
    ctaPrimary: "Sign now",
    ctaSecondary: "Read the letter",
    milestones: [100, 250, 500, 1000, 2500, 5000],
  },

  nav: [
    { id: "brief", label: "Letter" },
    { id: "unterzeichnen", label: "Sign" },
    { id: "liste", label: "Signatories" },
    { id: "faq", label: "FAQ" },
  ],
  navCta: "Sign",

  list: {
    sectionNum: "03 / Already signed",
    headingHtml: "{count} people<br>have signed.",
  },

  sign: {
    sectionNum: "02 / Sign",
    headingHtml: 'Add your<br />name <span class="rot">here.</span>',
    criteria: [
      "You support this letter.",
      "You can choose whether your name is shown publicly.",
    ],
    privacyNote:
      "Your email address is used only to verify your signature and is never shown publicly. A signature is counted only after email confirmation. You can withdraw your consent at any time.",
    formTitle: "Sign in 30 seconds",
    formSubtitle: "Fill in the fields, confirm by email. Done.",
    // German-specific optional fields are disabled (see features below).
    fields: {
      kreisverband: {
        label: "Region",
        optionalLabel: " optional",
        placeholder: "",
        autocomplete: true,
      },
      occupation: {
        label: "Occupation",
        optionalLabel: " optional",
        placeholder: "",
        autocomplete: true,
      },
    },
  },

  footer: {
    heading: "Open Letter.",
    blurb: "A public open letter campaign.",
    contactEmail: "contact@example.org",
  },

  legal: {
    entityName: "Example Org",
    contactName: "Jane Doe",
    addressLines: ["1 Example Street", "12345 Example City"],
    addressInline: "1 Example Street, 12345 Example City",
    contactEmail: "contact@example.org",
    disclaimer: "This is a private initiative.",
  },

  email: {
    from: "Open Letter <noreply@example.org>",
    signoff: "Kind regards<br>The Open Letter team",
    // Transport: "resend" (Resend HTTP API) or "smtp" (any SMTP server).
    // Overridable per-deployment via EMAIL_PROVIDER. Secrets (Resend API key,
    // SMTP password) always come from env — never put them here.
    provider: "resend",
    // Read only when provider === "smtp". Uncomment and set the non-secret
    // connection details; SMTP_USER / SMTP_PASS come from env.
    // smtp: {
    //   host: "smtp.example.com",
    //   port: 587, // 465 = implicit TLS (secure: true); 587 = STARTTLS
    //   secure: false,
    // },
    // Delays (ms) the mailing workers insert to respect provider rate limits.
    // Overridable via EMAIL_MESSAGE_DELAY_MS / EMAIL_BATCH_DELAY_MS.
    pacing: {
      messageDelayMs: 550, // between one-by-one sends (zoom link mailing)
      batchDelayMs: 1000, // between 100-email batch chunks
    },
    templates: {
      verification: {
        name: "Confirm your signature",
        subject: "Please confirm your signature — Open Letter",
        htmlBody: `
      <p>Hello {{name}},</p>
      <p>Thanks for signing the open letter.</p>
      <p><a href="{{confirmUrl}}">Click here to confirm your email</a></p>
      <p>The link is valid for 24 hours.</p>
      <p>Kind regards<br>The Open Letter team</p>
    `,
      },
      already_signed: {
        name: "Already signed",
        subject: "You have already signed — Open Letter",
        htmlBody: `
      <p>Hello {{name}},</p>
      <p>your signature is already confirmed and counted. Thank you!</p>
      <p>To edit your details or unsubscribe: <a href="{{unsubscribeUrl}}">{{unsubscribeUrl}}</a></p>
      <p>Kind regards<br>The Open Letter team</p>
    `,
      },
      deletion: {
        name: "Delete your signature",
        subject: "Delete your signature — Open Letter",
        htmlBody: `
      <p>Hello,</p>
      <p>you requested deletion of your signature and all stored data.</p>
      <p><a href="{{deleteUrl}}">Click here to permanently delete your data</a></p>
      <p>The link is valid for 24 hours. If you did not request this, ignore this email.</p>
      <p>Kind regards<br>The Open Letter team</p>
    `,
      },
      "open-letter-update": {
        name: "Open Letter Update",
        subject: "Update: Open Letter — {{signerCount}} signatories",
        htmlBody: `
      <div class="email-shell">
        <h1>An open letter</h1>
        <p>Hello {{firstName}},</p>
        <p>thank you for supporting this open letter.</p>
        <p class="gruss">Kind regards</p>
        <p class="signers-line">{{signerCount}} signatories</p>
        <footer>You receive this email because you subscribed to updates. <a href="{{unsubscribeUrl}}">Unsubscribe</a>.</footer>
      </div>
    `,
      },
    },
  },

  features: {
    kreisverbandField: false,
    occupationField: false,
    germanyMap: false,
    stateResolution: false,
    zoomEvent: false,
    // "Accomplished" / wind-down mode. When true, the hero shows the `success`
    // announcement instead of the counter + sign CTA, the sign form is removed,
    // and the signer list + FAQ render collapsed. Enable once the goal is met.
    successMode: false,
    // Which main content sections render folded into a single shared accordion
    // block (one bordered list) instead of full height. Valid ids: "brief",
    // "unterzeichnen", "liste", "faq". Empty = nothing collapsed.
    collapsedSections: [],
  },

  // Success / accomplished announcement (only read when features.successMode).
  success: {
    kicker: "Done.",
    headline: "We reached our goal.",
    body: "Thank you to everyone who signed. The campaign was a success.",
    // Optional: link to the result/decision. Leave empty to hide the link.
    antragUrl: "",
    antragLabel: "Read the outcome",
    // Only used when features.zoomEvent is also on; otherwise the button is hidden.
    ctaZoom: "Join the follow-up call",
    // Kept in the accomplished hero as a proof-of-impact stat (live verified
    // total is prepended). Set to "" to hide it.
    countLabel: "people signed",
  },

  zoom: {
    eventLabel: "",
    eventAt: "2026-01-01T20:00:00+01:00",
    durationMin: 90,
    // "online" = video call with a join link; "inperson" = physical location.
    mode: "online",
    // Shown to attendees when mode === "inperson".
    location: { name: "", address: "", mapsUrl: "" },
    // Label for the meeting link in the nav and CTA (config-driven, per letter).
    navLabel: "Meeting",
    // On-page copy for the #zoom section (config-driven so App.jsx stays generic).
    section: {
      sectionNum: "02 / Meeting",
      headingHtml: 'Join our<br /><span class="rot">meeting.</span>',
      whenText: "Date to be announced",
      bullets: [
        "We look back at the campaign together.",
        "We discuss possible next steps.",
      ],
      privacy:
        "We'll email you the join link before the call. Your details are used only to organise the meeting.",
    },
    // Copy for the signup form (src/ZoomForm.jsx), fully config-driven.
    form: {
      badge: "Sign up",
      title: "Sign up in 30 seconds",
      subtitle: "We'll email you the link.",
      submitLabel: "Join the call",
      submittingLabel: "Sending…",
      legal:
        "We use your details only to organise the meeting and will email you the join link in time.",
      showDelegierter: false,
      delegierterLabel: "I'm a delegate.",
      doneBadge: "Registered",
      doneTitle: "You're in.",
      doneText:
        "We've emailed you a confirmation. You'll get the join link before the call.",
    },
  },
};
