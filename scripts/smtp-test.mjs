import fs from "node:fs";
import nodemailer from "nodemailer";

const envText = fs.readFileSync(".env", "utf8");
const env = {};

for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;

  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;

  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  env[key] = value;
}

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  secure: Number(env.SMTP_PORT) === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  requireTLS: true,
  tls: {
    rejectUnauthorized: false,
  },
});

try {
  await transporter.verify();
  await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: env.ORDER_EMAIL_TO || env.SMTP_USER,
    subject: "Stock Email System Test",
    text: "This is an automated SMTP verification test from your local setup.",
  });

  console.log("SMTP_TEST_SUCCESS");
} catch (error) {
  console.error("SMTP_TEST_FAILED", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
