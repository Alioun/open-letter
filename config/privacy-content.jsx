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

export function groupedFieldPrivacy(label, functionLabel) {
  const fields = functionLabel
    ? `in den Feldern „${label}“ und „${functionLabel}“`
    : `im Feld „${label}“`;
  return `Für diese Unterschriften veröffentlichen wir die Anzahl je Angabe ${fields}, getrennt von den Namen.`;
}

export const firstSignerDetailsPrivacy =
  "Bei Erstunterzeichner*innen, die der Veröffentlichung zugestimmt haben, zeigen wir auch Funktion und Organisation neben dem Namen.";

// Removed fake signatures and the block on their address. `years` is
// "{{signerRetentionYears}}" in the stored policy.
export function blockedAddressPrivacy(years) {
  return `Unterschriften, die offensichtlich nicht ernst gemeint oder unter falschem Namen abgegeben wurden, können wir entfernen. Damit dieselbe E-Mail-Adresse nicht erneut so eingetragen wird, speichern wir danach nur eine verschlüsselte Prüfsumme der Adresse, nicht die Adresse selbst. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO (berechtigtes Interesse an einer unverfälschten Unterschriftenliste). Die Prüfsumme wird nach ${years} Jahren gelöscht. Wenn du meinst, dass deine Adresse zu Unrecht gesperrt ist, schreib uns.`;
}

// The admin's Protokoll and consent notes. `days` is "{{adminLogDays}}" in the
// stored policy, filled in when the page is served.
export function adminLogPrivacy(days) {
  return `Wenn unser Team eine Unterschrift in der Verwaltung ändert – etwa auf deinen Wunsch eine Angabe entfernt oder die Anzeige deines Namens ein- oder ausschaltet –, halten wir das in einem internen Protokoll mit dem alten und dem neuen Wert fest, damit wir Anfragen nachvollziehen können. Gibst du uns deine Zustimmung zur Veröffentlichung auf anderem Weg, etwa per E-Mail, vermerken wir das bei deiner Unterschrift. E-Mail-Adressen stehen nicht in diesem Protokoll. Die Einträge löschen wir nach ${days} Tagen, die alten und neuen Werte schon vorher, sobald die Unterschrift gelöscht wird. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DS-GVO (berechtigtes Interesse an einer nachvollziehbaren Bearbeitung deiner Anfragen).`;
}

// First signers the team adds by hand, without the form.
export const handEntryPrivacy =
  "Erstunterzeichner*innen, die nicht über das Formular unterschrieben haben, tragen wir mit ihrer Zustimmung von Hand ein, etwa nach einem Telefonat oder einer E-Mail. Dafür speichern wir nur den Namen, das Datum und einen Vermerk über die Zustimmung, Organisation und Funktion nur, wenn die Person sie angibt, aber keine E-Mail-Adresse; diese Einträge erhalten keine E-Mails. Rechtsgrundlage ist die Einwilligung der Person (Art. 6 Abs. 1 lit. a DS-GVO). Sie kann sie jederzeit mit einer Nachricht an uns widerrufen, dann löschen wir den Eintrag; sonst gilt dieselbe Speicherdauer wie für Unterschriften.";

export const newsletterConsentPrivacy = {
  before:
    "ausschließlich versendet, wenn du beim Unterschreiben die entsprechende Checkbox aktiviert hast",
  after:
    "ausschließlich versendet, wenn du beim Unterschreiben die entsprechende Checkbox aktiviert oder dich später über den Bestätigungslink in einer E-Mail von uns angemeldet hast",
};

export function signerDetailsPrivacy(config) {
  if (config.features.publicSignerDetails)
    return "Wenn du der öffentlichen Anzeige von Funktion und Organisation zugestimmt hast, zeigen wir diese Angaben neben deinem Namen.";
  return config.features.publicFirstSignerDetails
    ? firstSignerDetailsPrivacy
    : "";
}

export function DefaultPrivacyBody({ config: cfg }) {
  const region = () => regionLabels(cfg);
  const occupationLabel = cfg.sign.fields.occupation.label;
  const functionLabel = cfg.sign.fields.signerFunction?.label;
  const detailsNotice = signerDetailsPrivacy(cfg);
  const optionalSignerFields = [
    cfg.features.kreisverbandField && region().name,
    cfg.features.occupationField && occupationLabel,
    functionLabel,
  ].filter(Boolean);
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
        {optionalSignerFields.length > 0 &&
          ` sowie optional ${optionalSignerFields.join(" und ")}`}{" "}
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
      <p>{handEntryPrivacy}</p>
      <p>
        Wenn du zustimmst, dass dein Name öffentlich angezeigt wird, erscheinen
        dein Name
        {cfg.features.kreisverbandField && `, dein ${region().name}`}
        {cfg.features.stateResolution &&
          " und das daraus ermittelte Bundesland"}{" "}
        sowie das Datum der Unterzeichnung in der Liste auf dieser Website.
        {cfg.features.occupationField &&
          ` ${groupedFieldPrivacy(occupationLabel, functionLabel)}`}{" "}
        {detailsNotice && `${detailsNotice} `}
        Ohne diese Zustimmung wird deine Unterschrift nur mitgezählt. Du kannst
        das über den Link in unseren E-Mails jederzeit ändern.
      </p>
      <p>
        <strong>c) Newsletter / Kampagnen-Updates</strong>
        <br />
        Kampagnen-E-Mails werden{" "}
        <strong>{newsletterConsentPrivacy.after}</strong>. Du kannst diese
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
