import postgres from "postgres";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbUrl = process.env.DATABASE_URL || "";
const sslMode = new URL(dbUrl).searchParams.get("sslmode") || "";
const ssl = sslMode.startsWith("disable")
  ? false
  : { rejectUnauthorized: false };

const sql = postgres(dbUrl, { ssl });

const templates = [
  {
    slug: "verification",
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
  {
    slug: "deletion",
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
  {
    slug: "open-letter-update",
    name: "Open Letter Update",
    subject: "Update: Gehaltsdeckel jetzt — {{signerCount}} Mitzeichner*innen",
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
];

try {
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  await sql.unsafe(schema);
  for (const template of templates) {
    await sql`
      INSERT INTO email_templates (slug, name, subject, html_body)
      VALUES (${template.slug}, ${template.name}, ${template.subject}, ${template.htmlBody})
      ON CONFLICT (slug) DO NOTHING
    `;
  }
  console.log("Database schema applied successfully.");
} catch (err) {
  console.error("Failed to apply database schema:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
