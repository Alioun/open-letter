import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: false,
  // No auth needed — relay is permitted by IP ACL inside Docker
  tls: { rejectUnauthorized: false },
});

export async function sendVerificationEmail({ to, name, token, baseUrl }) {
  const confirmUrl = `${baseUrl}/api/confirm/${token}`;

  await transporter.sendMail({
    from: '"Gehaltsdeckel Initiative" <noreply@gehaltsdeckel.jetzt>',
    to,
    subject: "Bitte bestätige deine Unterschrift — Gehaltsdeckel jetzt",
    html: `
      <p>Hallo ${name},</p>
      <p>Danke für deine Unterschrift unter den offenen Brief „Gehaltsdeckel jetzt".</p>
      <p><a href="${confirmUrl}">Klicke hier, um deine E-Mail zu bestätigen</a></p>
      <p>Der Link ist 24 Stunden gültig.</p>
      <p>Mit solidarischen Grüßen<br>Initiative Gehaltsdeckel</p>
    `,
    text: `Hallo ${name},\n\nDanke für deine Unterschrift.\n\nBitte bestätige deine E-Mail-Adresse:\n${confirmUrl}\n\nDer Link ist 24 Stunden gültig.\n\nMit solidarischen Grüßen\nInitiative Gehaltsdeckel`,
  });
}
