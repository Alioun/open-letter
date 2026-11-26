import { regionLabels } from "./region.js";
import { resolvePrivacy } from "./privacy.js";
import { resolveInvite } from "./invite.js";
function sectionLetter(config, id) {
  const order = [
    config.features.zoomEvent && "zoom",
    config.email?.provider === "resend" && "resend",
    config.features.inviteLinks && "invite",
    config.features.stateResolution && "state",
    config.meta.analytics?.src && "analytics",
  ].filter(Boolean);
  return String.fromCharCode("d".charCodeAt(0) + order.indexOf(id));
}

// How exact the invite stats are, and what that lets an inviter infer.
function inviteStatsPrivacy(invite) {
  const risk =
    "lässt sich an einer Änderung erkennen, ob eine bestimmte Person unterschrieben hat – etwa wenn der Link zuletzt nur an diese Person ging.";
  if (invite.statsMode === "exact") {
    return `Der Statistik-Link zeigt die genaue Zahl. Daran ${risk}`;
  }
  if (invite.statsMode === "threshold") {
    const t = invite.statsThreshold;
    return `Solange die Anzahl unter ${t} liegt, zeigt der Statistik-Link keine genaue Zahl, danach die genaue. Liegt sie bereits bei ${t - 1} oder mehr, ${risk}`;
  }
  const bounds = [...invite.statsRanges].sort((a, b) => a - b);
  return `Der Statistik-Link zeigt keine genaue Zahl, sondern nur einen Bereich (Grenzen: ${bounds.join(", ")}). Nur wenn die Anzahl gerade eine dieser Grenzen erreicht, ${risk}`;
}

const countedFields = (label, functionLabel) =>
  functionLabel
    ? `in den Feldern „${label}“ und „${functionLabel}“`
    : `im Feld „${label}“`;
// The counts for every public name, without saying whose signatures.
const countsForPublicNames = (label, functionLabel) =>
  `veröffentlichen wir die Anzahl je Angabe ${countedFields(label, functionLabel)}, getrennt von den Namen.`;

// The counts per organisation and role. They cover every public name, or,
// where the form offers "only my name" (`detailsOnly`), only the signatures
// whose details are public: a count of 1 names its one signer.
export function groupedFieldPrivacy(label, functionLabel, detailsOnly) {
  return detailsOnly
    ? `Die Anzahl je Angabe ${countedFields(label, functionLabel)} veröffentlichen wir, getrennt von den Namen, nur für Unterschriften, bei denen der öffentlichen Anzeige dieser Angaben zugestimmt wurde.`
    : `Für diese Unterschriften ${countsForPublicNames(label, functionLabel)}`;
}

export const firstSignerDetailsPrivacy =
  "Bei Erstunterzeichner*innen, die der Veröffentlichung zugestimmt haben, zeigen wir auch Funktion und Organisation neben dem Namen.";

// What a policy written before these existed has to gain: removed fake
// signatures and the block on their address, the admin's Protokoll and
// consent notes, first signers added by hand, and the newsletter consent mail.
// German is what the default policy below uses. English is for a policy the
// team wrote in English: the default itself is German for every language.
// `years` and `days` are "{{signerRetentionYears}}" and "{{adminLogDays}}" in
// a stored policy, filled in when the page is served.
const DISCLOSURES = {
  de: {
    blockedAddress: (years) =>
      `Unterschriften, die offensichtlich nicht ernst gemeint oder unter falschem Namen abgegeben wurden, können wir entfernen. Damit dieselbe E-Mail-Adresse nicht erneut so eingetragen wird, ${DISCLOSURES.de.blockedAddressAfter} Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO (berechtigtes Interesse an einer unverfälschten Unterschriftenliste). Die Prüfsumme wird nach ${years} Jahren gelöscht. Wenn du meinst, dass deine Adresse zu Unrecht gesperrt ist, schreib uns.`,
    adminLog: (days) =>
      `Wenn unser Team eine Unterschrift in der Verwaltung ändert – etwa auf deinen Wunsch eine Angabe entfernt oder die Anzeige deines Namens ein- oder ausschaltet –, halten wir das in einem internen Protokoll mit dem alten und dem neuen Wert fest, damit wir Anfragen nachvollziehen können. Gibst du uns deine Zustimmung zur Veröffentlichung auf anderem Weg, etwa per E-Mail, vermerken wir das bei deiner Unterschrift. E-Mail-Adressen stehen nicht in diesem Protokoll. Die Einträge löschen wir nach ${days} Tagen, die alten und neuen Werte schon vorher, sobald die Unterschrift gelöscht wird. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO (berechtigtes Interesse an einer nachvollziehbaren Bearbeitung deiner Anfragen).`,
    handEntry:
      "Erstunterzeichner*innen, die nicht über das Formular unterschrieben haben, tragen wir mit ihrer Zustimmung von Hand ein, etwa nach einem Telefonat oder einer E-Mail. Dafür speichern wir nur den Namen, das Datum und einen Vermerk über die Zustimmung, Organisation und Funktion nur, wenn die Person sie angibt, aber keine E-Mail-Adresse; diese Einträge erhalten keine E-Mails. Rechtsgrundlage ist die Einwilligung der Person (Art. 6 Abs. 1 lit. a DS-GVO). Sie kann sie jederzeit mit einer Nachricht an uns widerrufen, dann löschen wir den Eintrag; sonst gilt dieselbe Speicherdauer wie für Unterschriften.",
    // What the block paragraph said of the checksum before, and says now.
    blockedAddressBefore:
      "speichern wir danach nur eine verschlüsselte Prüfsumme der Adresse, nicht die Adresse selbst.",
    blockedAddressAfter:
      "speichern wir danach nicht die Adresse selbst, sondern nur eine Prüfsumme, die aus der Adresse mit einem geheimen Schlüssel berechnet wird. Aus der Prüfsumme lässt sich die Adresse nicht ablesen. Wir können damit nur prüfen, ob eine eingetragene Adresse dieselbe ist.",
    // `before` is the sentence the default had until the consent mail came.
    newsletterConsent: {
      before:
        "ausschließlich versendet, wenn du beim Unterschreiben die entsprechende Checkbox aktiviert hast",
      after:
        "ausschließlich versendet, wenn du beim Unterschreiben die entsprechende Checkbox aktiviert oder dich später über den Bestätigungslink in einer E-Mail von uns angemeldet hast",
    },
  },
  en: {
    blockedAddress: (years) =>
      `We may remove signatures that are obviously not meant seriously or were made under a false name. So that the same email address is not entered like that again, we then keep not the address itself but only a fingerprint of the address, computed with a secret key. The address cannot be read from it. All we can do with it is check whether an address that is entered is the same one. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in a signature list that is not falsified). The fingerprint is deleted after ${years} years. If you think your address was blocked by mistake, write to us.`,
    adminLog: (days) =>
      `When our team changes a signature in the admin area – for example removes a detail at your request, or switches the display of your name on or off – we record this in an internal log with the old and the new value, so that we can trace requests. If you give us your consent to publication in another way, for example by email, we note that with your signature. The log holds no email addresses. We delete the entries after ${days} days, and the old and new values earlier, as soon as the signature is deleted. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in handling your requests in a traceable way).`,
    handEntry:
      "First signers who did not sign through the form are added by us by hand, with their consent, for example after a phone call or an email. For this we store only the name, the date and a note about the consent, the organisation and function only if the person gives them, and no email address; these entries receive no emails. The legal basis is the consent of the person (Art. 6(1)(a) GDPR). They can withdraw it at any time with a message to us, and we then delete the entry; otherwise the same storage period applies as for signatures.",
    // No English default was ever shipped, so there is no old sentence to
    // recognise.
    newsletterConsent: {
      after:
        "sent only if you ticked the box for them when signing, or subscribed later through the confirmation link in an email from us",
    },
  },
};

export const disclosureLanguages = Object.keys(DISCLOSURES);

export const blockedAddressPrivacy = (years, lang = "de") =>
  DISCLOSURES[lang].blockedAddress(years);

export const adminLogPrivacy = (days, lang = "de") =>
  DISCLOSURES[lang].adminLog(days);

export const handEntryPrivacy = (lang = "de") => DISCLOSURES[lang].handEntry;

export const newsletterConsentPrivacy = (lang = "de") =>
  DISCLOSURES[lang].newsletterConsent;

// Sentences of an earlier default in this language, each with what replaces
// it in a stored policy, as HTML. A sentence the team changed matches nothing
// and stays.
export function outdatedPrivacyWording(lang) {
  const { blockedAddressBefore, blockedAddressAfter, newsletterConsent } =
    DISCLOSURES[lang];
  const { before, after } = newsletterConsent;
  return [
    before && [`<strong>${before}</strong>`, `<strong>${after}</strong>`],
    blockedAddressBefore && [blockedAddressBefore, blockedAddressAfter],
  ].filter(Boolean);
}

// Where the form offers "only my name" or "my name with my details", the
// region is one of the details and appears with them, not with the name.
const regionIsDetail = (config) =>
  Boolean(
    config.features.publicSignerDetails && config.features.kreisverbandField,
  );

export function signerDetailsPrivacy(config) {
  if (config.features.publicSignerDetails) {
    const details =
      "Wenn du der öffentlichen Anzeige von Funktion und Organisation zugestimmt hast, zeigen wir diese Angaben neben deinem Namen.";
    if (!regionIsDetail(config)) return details;
    const region = `dein ${regionLabels(config).name}`;
    return config.features.stateResolution
      ? `${details} Nur dann erscheinen auch ${region} und das daraus ermittelte Bundesland in der Liste.`
      : `${details} Nur dann erscheint auch ${region} in der Liste.`;
  }
  return config.features.publicFirstSignerDetails
    ? firstSignerDetailsPrivacy
    : "";
}

// The optional fields of the sign form, by label.
const optionalSignerFields = (config) =>
  [
    config.features.kreisverbandField && regionLabels(config).name,
    config.features.occupationField && config.sign.fields.occupation.label,
    config.sign.fields.signerFunction?.label,
  ].filter(Boolean);

// Where the default policy below names the optional fields it stores, and
// what appears with a public name: [what stands before, what stands after].
// The statement's clause goes between them.
export const FIELD_CLAUSES = {
  stored: ["Beim Mitzeichnen werden Name und E-Mail-Adresse", " gespeichert."],
  shown: ["erscheinen dein Name", " sowie das Datum der Unterzeichnung"],
};
// The sentence of the default policy that follows its statements about
// counts and details.
export const AFTER_FIELD_STATEMENTS =
  "Ohne diese Zustimmung wird deine Unterschrift nur mitgezählt.";

const ENGLISH_DETAILS =
  "If you agreed to your role and organisation being shown publicly, we show them next to your name.";

// What a policy has to say about the optional fields of the form, as it
// stands in `config`: which are stored, and what of them is public. In order,
// one entry per statement:
//   id        which statement it is
//   asked     the statement in German, whatever `lang`: it is the same as
//             long as the form asks for the same
//   mark      wording a policy that makes the statement contains
//   text      a sentence that makes it on its own, for a paragraph of its own
//   clause    German only: the words the default policy below has for it,
//             between the two parts of FIELD_CLAUSES[id]
//   sentence  German only: the sentence the default policy below has for it,
//             before AFTER_FIELD_STATEMENTS
// German is the wording of the default policy, English is for a policy the
// team wrote in English.
export function fieldDisclosures(config, lang = "de") {
  const { features } = config;
  const fields = optionalSignerFields(config);
  const region = regionLabels(config).name;
  const state = features.stateResolution;
  const label = config.sign.fields.occupation.label;
  const functionLabel = config.sign.fields.signerFunction?.label;
  const regionWithName = features.kreisverbandField && !regionIsDetail(config);
  const countsAll = features.occupationField && !features.publicSignerDetails;
  const countsDetails =
    features.occupationField && features.publicSignerDetails;

  const stored = `optional ${fields.join(" und ")}`;
  const shown = `dein ${region}${state ? " und das daraus ermittelte Bundesland" : ""}`;
  const counts = countsForPublicNames(label, functionLabel);
  const details = signerDetailsPrivacy(config);
  const countsOfDetails = groupedFieldPrivacy(label, functionLabel, true);
  const german = [
    fields.length && {
      id: "stored",
      mark: stored,
      text: `Zu deiner Unterschrift speichern wir außerdem ${stored}.`,
      clause: ` sowie ${stored}`,
    },
    regionWithName && {
      id: "shown",
      mark: shown,
      text: `Wenn dein Name öffentlich angezeigt wird, ${state ? "erscheinen" : "erscheint"} in der Liste auch ${shown}.`,
      clause: `, ${shown}`,
    },
    countsAll && {
      id: "counts",
      mark: counts,
      text: `Für Unterschriften, deren Name öffentlich angezeigt wird, ${counts}`,
      sentence: groupedFieldPrivacy(label, functionLabel),
    },
    details && {
      id: "details",
      mark: details,
      text: details,
      sentence: details,
    },
    countsDetails && {
      id: "countsOfDetails",
      mark: countsOfDetails,
      text: countsOfDetails,
      sentence: countsOfDetails,
    },
  ]
    .filter(Boolean)
    .map((statement) => ({ ...statement, asked: statement.text }));
  if (lang !== "en") return german;

  const counted = functionLabel
    ? `the fields “${label}” and “${functionLabel}”`
    : `the field “${label}”`;
  const shownEnglish = `your ${region}${state ? " and the federal state derived from it" : ""}`;
  const english = {
    stored: `With your signature we also store these optional details: ${fields.join(" and ")}.`,
    shown: `When your name is shown publicly, the list also shows ${shownEnglish}.`,
    counts: `For signatures whose name is shown publicly, we publish how many gave each entry in ${counted}, separately from the names.`,
    details: features.publicSignerDetails
      ? regionIsDetail(config)
        ? `${ENGLISH_DETAILS} Only then does the list also show ${shownEnglish}.`
        : ENGLISH_DETAILS
      : "For first signers who agreed to publication, we also show role and organisation next to the name.",
    countsOfDetails: `We publish how many signatures gave each entry in ${counted}, separately from the names, only for signatures whose details are shown publicly.`,
  };
  return german.map(({ id, asked }) => ({
    id,
    asked,
    mark: english[id],
    text: english[id],
  }));
}

// The labels a field of the form has and had: today's, and the ones the
// letter lists as its earlier ones (`previousDefaults`).
const fieldLabels = (config, field) =>
  [
    config.sign.fields[field]?.label,
    ...(config.previousDefaults?.[`sign.fields.${field}.label`] || []),
  ].filter(Boolean);

// The clauses an earlier default can have had at FIELD_CLAUSES[id], with null
// for none: every choice of the optional fields, named as the letter names
// them or named them, and the occupation as "Beruf" too, which the first
// release called it whatever its label. Anything else between the two parts
// is not the default's wording.
export function earlierFieldClauses(id, config) {
  const regions = [...new Set([regionLabels(config).name, "Kreisverband"])];
  if (id === "shown")
    return [
      null,
      ...regions.flatMap((region) => [
        `, dein ${region}`,
        `, dein ${region} und das daraus ermittelte Bundesland`,
      ]),
    ];
  const orNone = (labels) => [null, ...new Set(labels)];
  const occupations = [...fieldLabels(config, "occupation"), "Beruf"];
  return orNone(regions).flatMap((region) =>
    orNone(occupations).flatMap((occupation) =>
      orNone(fieldLabels(config, "signerFunction")).map((role) => {
        const fields = [region, occupation, role].filter(Boolean);
        return fields.length ? ` sowie optional ${fields.join(" und ")}` : null;
      }),
    ),
  );
}

// The statements about the counts per organisation and role, by id.
export const COUNT_STATEMENTS = ["counts", "countsOfDetails"];

// Sentences an earlier German default had in place of the COUNT_STATEMENTS,
// as far as no default says them of this form: what the first release said of
// occupations, and that the counts cover every public name. The latter holds
// only while the form asks for an occupation and signers do not choose their
// details. The fields are named as the letter names them or named them, and
// "Beruf", as the first release called the occupation whatever its label.
export function earlierCountSentences(config) {
  const { features, sign } = config;
  const today =
    features.occupationField && !features.publicSignerDetails
      ? groupedFieldPrivacy(
          sign.fields.occupation.label,
          sign.fields.signerFunction?.label,
        )
      : null;
  const roles = [undefined, ...fieldLabels(config, "signerFunction")];
  return [
    ...new Set([
      "Berufsangaben dieser Unterschriften werden nur als Anzahl je Beruf veröffentlicht, nicht zusammen mit dem Namen.",
      ...[...fieldLabels(config, "occupation"), "Beruf"].flatMap((label) =>
        roles.map((role) => groupedFieldPrivacy(label, role)),
      ),
    ]),
  ].filter((sentence) => sentence !== today);
}

export function DefaultPrivacyBody({ config: cfg }) {
  const region = () => regionLabels(cfg);
  const occupationLabel = cfg.sign.fields.occupation.label;
  const functionLabel = cfg.sign.fields.signerFunction?.label;
  const detailsNotice = signerDetailsPrivacy(cfg);
  const optionalFields = optionalSignerFields(cfg);
  const privacy = Object.fromEntries(
    Object.keys(resolvePrivacy(cfg)).map((k) => [k, `{{${k}}}`]),
  );
  return (
    <>
      <h4>I. Informationen gemäß Art. 13 DS-GVO</h4>

      <h5>1. Verantwortliche</h5>
      <p>
        Verantwortlich für diese Website ist:
        <br />
        <strong>{"{{controllerName}}"}</strong>
        <br />
        {"{{controllerContact}}"}
        <br />
        {"{{controllerAddress}}"}
        <br />
        <a href="mailto:{{controllerEmail}}">{"{{controllerEmail}}"}</a>
      </p>
      <p>
        Ein Datenschutzbeauftragter ist nicht zu benennen, da es sich um eine
        private Initiative handelt.
      </p>

      <h5>2. Welche Daten werden verarbeitet?</h5>
      <p>
        <strong>a) Server-Protokolldateien</strong>
        <br />
        Bei jedem Zugriff werden vorübergehend Daten gespeichert: IP-Adresse,
        Datum und Uhrzeit, aufgerufene Seite, Browser und Betriebssystem sowie
        Referrer-URL. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO
        (berechtigtes Interesse am sicheren Betrieb). Die Protokolldateien
        werden spätestens nach 7 Tagen gelöscht.
      </p>
      <p>
        <strong>b) Unterschriften</strong>
        <br />
        Beim Mitzeichnen werden Name und E-Mail-Adresse
        {optionalFields.length > 0 &&
          ` sowie optional ${optionalFields.join(" und ")}`}{" "}
        gespeichert. Rechtsgrundlage ist deine ausdrückliche Einwilligung (Art.
        6 Abs. 1 lit. a DS-GVO). Die Daten werden{" "}
        <strong>ausschließlich für diese Petition verwendet</strong> und – mit
        Ausnahme der in dieser Erklärung genannten Dienstleister (siehe unten) –
        nicht an unbeteiligte Dritte weitergegeben oder für andere Zwecke
        genutzt. Sie werden für die Dauer der Initiative gespeichert und bei
        Beendigung der Kampagne vollständig gelöscht, spätestens jedoch{" "}
        {privacy.signerRetentionYears} Jahre nach Unterzeichnung (§ 195 BGB)
        oder auf frühere Anfrage. Nicht bestätigte Eintragungen – bei denen der
        Bestätigungslink nicht angeklickt wurde – werden automatisch gelöscht,
        sobald der {privacy.confirmationLinkHours} Stunden gültige
        Bestätigungslink abgelaufen ist.
      </p>
      <p>{blockedAddressPrivacy(privacy.signerRetentionYears)}</p>
      <p>{adminLogPrivacy(privacy.adminLogDays)}</p>
      <p>{handEntryPrivacy()}</p>
      <p>
        Wenn du zustimmst, dass dein Name öffentlich angezeigt wird, erscheinen
        dein Name
        {cfg.features.kreisverbandField &&
          !regionIsDetail(cfg) &&
          `, dein ${region().name}`}
        {cfg.features.stateResolution &&
          !regionIsDetail(cfg) &&
          " und das daraus ermittelte Bundesland"}{" "}
        sowie das Datum der Unterzeichnung in der Liste auf dieser Website.
        {cfg.features.occupationField &&
          !cfg.features.publicSignerDetails &&
          ` ${groupedFieldPrivacy(occupationLabel, functionLabel)}`}{" "}
        {detailsNotice && `${detailsNotice} `}
        {cfg.features.occupationField &&
          cfg.features.publicSignerDetails &&
          `${groupedFieldPrivacy(occupationLabel, functionLabel, true)} `}
        Ohne diese Zustimmung wird deine Unterschrift nur mitgezählt. Du kannst
        das über den Link in unseren E-Mails jederzeit ändern.
      </p>
      <p>
        <strong>c) Newsletter / Kampagnen-Updates</strong>
        <br />
        Kampagnen-E-Mails werden{" "}
        <strong>{newsletterConsentPrivacy().after}</strong>. Du kannst diese
        Einwilligung jederzeit widerrufen – über den Abmeldelink in jeder E-Mail
        oder durch eine Nachricht an{" "}
        <a href="mailto:{{controllerEmail}}">{"{{controllerEmail}}"}</a>. Deine
        Unterschrift bleibt davon unberührt. Über den Link in unseren E-Mails zu
        deiner Unterschrift und in Kampagnen-E-Mails kannst du außerdem deine
        Angaben ändern oder deine Unterschrift löschen; dafür gilt er{" "}
        {privacy.settingsLinkDays} Tage ab der letzten E-Mail, die ihn enthielt.
        Abmelden kannst du dich damit unbegrenzt.
      </p>
      <p>
        Damit bei einer unterbrochenen Sendung niemand eine E-Mail doppelt oder
        gar nicht bekommt, speichern wir zu jeder Kampagnen-E-Mail
        {cfg.features.zoomEvent && " und jeder E-Mail zum Treffen"}, an welche
        E-Mail-Adresse sie wann verschickt wurde. Diese Einträge löschen wir{" "}
        {privacy.deliveryLogDays} Tage nach dem Versand, und sofort, wenn du
        deine Daten löschen lässt.
      </p>
      {cfg.features.zoomEvent && (
        <p>
          <strong>
            {sectionLetter(cfg, "zoom")}) Anmeldung zum{" "}
            {cfg.zoom?.navLabel || "Treffen"}
          </strong>
          <br />
          Wenn du dich zum {cfg.zoom?.navLabel || "Treffen"} anmeldest,
          speichern wir deinen Namen, deine E-Mail-Adresse, optional deinen
          Kreisverband und gegebenenfalls die Angabe, ob du Delegierte*r bist.
          Die Anmeldung wird erst wirksam, wenn du sie über den Link in einer
          unserer E-Mails bestätigst; nicht bestätigte Anmeldungen löschen wir
          nach {privacy.confirmationLinkHours} Stunden. Wir nutzen die Daten
          ausschließlich, um dir Informationen, Zugangsdaten und eine Erinnerung
          zum Treffen zu schicken . Rechtsgrundlage ist deine Einwilligung (Art.
          6 Abs. 1 lit. a DS-GVO), die du jederzeit über den Abmeldelink in
          jeder dieser E-Mails widerrufen kannst. Die Anmeldungen werden{" "}
          {privacy.treffenRetentionDays} Tage nach dem Treffen gelöscht. Mit dem
          Link in den E-Mails zum Treffen kannst du, solange deine Anmeldung
          besteht, deine Angaben ändern, dich abmelden oder alle zu deiner
          E-Mail-Adresse gespeicherten Daten löschen. An Anbieter von
          Videokonferenzen geben wir deine Daten nicht weiter.
        </p>
      )}
      <p>{"{{emailProcessing}}"}</p>
      {cfg.features.inviteLinks && (
        <p>
          <strong>
            {sectionLetter(cfg, "invite")}) Persönlicher Einladungslink
          </strong>
          <br />
          Nach der Bestätigung deiner Unterschrift erhältst du einen
          persönlichen Einladungslink, den du teilen kannst, und per E-Mail
          einen privaten Statistik-Link. Dafür speichern wir zu deiner
          Unterschrift einen zufälligen Code, einen Prüfwert des Statistik-Links
          (nicht den Link selbst) und die Anzahl der Unterschriften, die über
          deinen Link bestätigt wurden. Wer über deinen Link unterschrieben hat,
          speichern wir nicht: Der Code der Einladung wird bei einer
          Unterschrift nur bis zu ihrer Bestätigung aufbewahrt und dann
          gelöscht; nur die Anzahl steigt.{" "}
          {inviteStatsPrivacy(resolveInvite(cfg))} Dein Vorname erscheint auf
          deinem Einladungslink nur, wenn du das beim Unterschreiben
          ausdrücklich ausgewählt hast – wer den Link öffnet, erfährt dann, dass
          du den Brief unterschrieben hast. Rechtsgrundlage dafür ist deine
          ausdrückliche Einwilligung (Art. 6 Abs. 1 lit. a, Art. 9 Abs. 2 lit. a
          DS-GVO), die du jederzeit über deine E-Mail-Einstellungen oder per
          E-Mail an{" "}
          <a href="mailto:{{controllerEmail}}">{"{{controllerEmail}}"}</a>{" "}
          widerrufen kannst. Die Angaben werden mit deiner Unterschrift
          gelöscht. Die Seiten der Einladungslinks werden nicht in der
          Reichweitenmessung erfasst. Die Teilen-Buttons sind einfache Links;
          erst wenn du einen anklickst, öffnet sich der jeweilige Messenger.
        </p>
      )}
      {cfg.features.stateResolution && (
        <p>
          <strong>
            {sectionLetter(cfg, "state")}) Ermittlung des Bundeslandes
          </strong>
          <br />
          Sofern du einen Kreisverband angibst, wird dieser zur Zuordnung des
          Bundeslandes einmalig an den Dienst Nominatim der OpenStreetMap
          Foundation (Server in der EU / im Vereinigten Königreich) übermittelt.
          Dein Name und deine E-Mail-Adresse werden dabei nicht übertragen.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO (berechtigtes
          Interesse an einer regionalen Auswertung).
        </p>
      )}
      <p>{"{{analyticsProcessing}}"}</p>
      <h5>3. Deine Rechte</h5>
      <p>
        Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16),
        Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) sowie
        Datenübertragbarkeit (Art. 20 DS-GVO). Für Anfragen wende dich an{" "}
        <a href="mailto:{{controllerEmail}}">{"{{controllerEmail}}"}</a>.
      </p>
      <p>
        Du hast außerdem das Recht, aus Gründen deiner besonderen Situation
        jederzeit Widerspruch gegen die Verarbeitung einzulegen (Art. 21 Abs. 1
        DS-GVO).
      </p>

      <h5>4. Beschwerderecht</h5>
      <p>
        Wenn du der Ansicht bist, dass die Verarbeitung deiner Daten gegen
        Datenschutzrecht verstößt, kannst du dich bei einer
        Datenschutz-Aufsichtsbehörde beschweren. Für private Verantwortliche ist
        die Landesdatenschutzbehörde des Bundeslandes zuständig, in dem die
        verantwortliche Stelle ihren Sitz hat. Eine Übersicht aller deutschen
        Aufsichtsbehörden findest du hier:{" "}
        <a
          href="https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Liste der Datenschutz-Aufsichtsbehörden
        </a>
        .
      </p>

      <hr />

      <h5>Daten löschen</h5>
      <p>
        Du kannst alle Daten, die wir zu deiner E-Mail-Adresse gespeichert haben
        – deine Unterschrift
        {cfg.features.zoomEvent && " und deine Anmeldung zum Treffen"} –
        jederzeit löschen lassen. Gib dazu deine E-Mail-Adresse ein – wir
        schicken dir einen Löschlink, der {privacy.confirmationLinkHours}{" "}
        Stunden gültig ist.
      </p>
    </>
  );
}
