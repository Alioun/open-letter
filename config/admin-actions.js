// What the admin log ("Protokoll") can hold: every action key the server may
// record, with the German line the log shows for it. `{count}` is the entry's
// count. Read by the server, which refuses an unknown key, and by the admin
// page; never by the public page.
export const ADMIN_ACTIONS = {
  "signer.remove-block": "Unterschrift entfernt und Adresse gesperrt",
  "signer.erase": "Unterschrift gelöscht (ohne Sperre)",
  "signer.edit": "Unterschrift bearbeitet",
  "signer.unblock": "Sperre einer Adresse aufgehoben",
  "signer.resend-confirmation": "Bestätigungs-E-Mail erneut gesendet",
  "signer.newsletter-request": "Newsletter-Einwilligung angefragt",
  "signer.newsletter-confirmed":
    "Newsletter-Einwilligung von der Person bestätigt",
  "signer.first-signer": "Erstunterzeichner*in-Markierung geändert",
  "signer.position": "Position in der Reihenfolge geändert",
  "signer.add-by-hand": "Erstunterzeichner*in von Hand eingetragen",
  "signer.link-duplicate":
    "Eintrag von Hand mit der eigenen Unterschrift verknüpft",
  "first-signers.order": "Reihenfolge der Erstunterzeichner*innen gespeichert",
  "first-signers.import": "Erstunterzeichner*innen aus einer CSV-Datei übernommen",
  "export.signers": "Öffentliche Unterschriften exportiert",
  "export.meeting-registrations": "Anmeldungen zum Treffen exportiert",
  "merge.kreisverband": "Schreibweisen der Region zusammengeführt",
  "merge.occupation": "Schreibweisen zusammengeführt",
  "merge.state": "Bundesland zugeordnet",
  "merge.undo": "Zusammenführung zurückgenommen",
  "campaign.create": "Nachricht eingeplant",
  "campaign.cancel": "Geplante Nachricht abgesagt",
  "campaign.retry": "Angehaltene Nachricht erneut gestartet",
  "campaign.stop": "Laufenden Versand gestoppt",
  "template.create": "Vorlage angelegt",
  "template.update": "Vorlage geändert",
  "template.delete": "Vorlage gelöscht",
  "website.publish": "Website veröffentlicht",
  // By a start of the server, not by the team: see server/publications.js.
  "website.upgrade": "Texte der Website beim Start des Servers angepasst",
  "meeting.clear": "Alle Anmeldungen zum Treffen gelöscht",
  "meeting.remove": "Eine Anmeldung zum Treffen entfernt",
  "meeting.settings": "Einstellungen zum Treffen gespeichert",
  "settings.milestones": "Zielmarken gespeichert",
  "settings.statistics": "Statistik-Einstellungen gespeichert",
  "settings.email": "E-Mail-Einstellungen geändert",
  "email.reconcile": "Unklare Zustellungen abgeschlossen",
  "email.requeue-failed": "Fehlgeschlagene E-Mails erneut eingereiht",
  "session.logout-everywhere": "Alle Sitzungen beendet",
};

// The fields a "signer.edit" entry can list, in the order the log shows them.
export const SIGNER_EDIT_FIELDS = {
  name: "Name",
  occupation: "Organisation",
  signerFunction: "Funktion",
  kreisverband: "Region",
  lang: "Sprache",
  showPublicly: "Name öffentlich",
  showSignerDetails: "Angaben öffentlich",
  newsletter: "Newsletter",
  firstSigner: "Erstunterzeichner*in",
  position: "Position",
};
