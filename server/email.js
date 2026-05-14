import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendVerificationEmail({ to, name, token, baseUrl }) {
  const confirmUrl = `${baseUrl}/api/confirm/${token}`;

  await transporter.sendMail({
    from: `"Diätendeckel Initiative" <${process.env.SMTP_USER}>`,
    to,
    subject: "Bitte bestätige deine Unterschrift — Diätendeckel jetzt",
    html: `
      <p>Hallo ${name},</p>
      <p>Danke für deine Unterschrift unter den offenen Brief „Diätendeckel jetzt".</p>
      <p><a href="${confirmUrl}">Klicke hier, um deine E-Mail zu bestätigen</a></p>
      <p>Der Link ist 24 Stunden gültig.</p>
      <p>Mit solidarischen Grüßen,<br>Initiative Diätendeckel</p>
    `,
  });
}
