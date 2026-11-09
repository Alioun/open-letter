export function emailProfileBlockers(profile) {
  const issues = [];
  if (!profile?.from) issues.push("Die Kampagnen-Absenderadresse fehlt.");
  if (!profile?.hasCredential)
    issues.push(
      profile?.provider === "resend"
        ? "Der API-Schlüssel fehlt."
        : "Das Passwort / App-Passwort fehlt.",
    );
  if (profile?.provider !== "resend") {
    if (!profile?.host) issues.push("Der SMTP-Server fehlt.");
    if (!profile?.user)
      issues.push("Die Hauptadresse für die Anmeldung fehlt.");
  }
  return issues;
}
