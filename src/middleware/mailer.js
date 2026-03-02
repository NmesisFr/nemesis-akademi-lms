const nodemailer = require("nodemailer");

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false") === "true";
  if (!host || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendCertificateRequestEmail({ to, appName, user, course }) {
  const transporter = getTransport();
  if (!transporter) return { skipped: true };

  const fromName = process.env.SMTP_FROM_NAME || appName || "Akademi LMS";
  const from = `"${fromName}" <${process.env.SMTP_USER}>`;

  const subject = `[Belge Talebi] ${course.title} - ${user.full_name}`;
  const text =
`Belge talebi alındı.

Öğrenci: ${user.full_name} (${user.email})
Kurs: ${course.title}
Kategori: ${course.category}
Seviye: ${course.level}
Tarih: ${new Date().toISOString()}

Not: Sistem tarafından otomatik gönderildi.`;

  await transporter.sendMail({ from, to, subject, text });
  return { sent: true };
}

module.exports = { sendCertificateRequestEmail };
