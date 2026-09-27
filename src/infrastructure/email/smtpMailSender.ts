import nodemailer from "nodemailer";

import type { MailSender, OutboundMailMessage } from "./types.js";

export type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  fromAddress: string;
  fromName?: string;
  ourCompany?: string;
};

const trim = (value: string | undefined): string => (value ?? "").trim();

export function readSmtpSettings(env: Record<string, string | undefined>): SmtpSettings | null {
  const user = trim(env.ZOHO_SMTP_USER);
  const password = trim(env.ZOHO_SMTP_PASSWORD);
  if (!user || !password) return null;

  const rawPort = trim(env.ZOHO_SMTP_PORT);
  const port = rawPort ? Number(rawPort) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;

  const fromName = trim(env.OUTREACH_FROM_NAME);
  const ourCompany = trim(env.OUTREACH_SENDER_COMPANY);

  return {
    host: trim(env.ZOHO_SMTP_HOST) || "smtp.zoho.com",
    port,
    user,
    password,
    fromAddress: user,
    ...(fromName ? { fromName } : {}),
    ...(ourCompany ? { ourCompany } : {}),
  };
}

export function createSmtpMailSender(settings: SmtpSettings): MailSender {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  });

  const from = settings.fromName
    ? `${settings.fromName.replace(/[<>"\r\n]/g, "").trim()} <${settings.fromAddress}>`
    : settings.fromAddress;

  return {
    async send(message: OutboundMailMessage): Promise<void> {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
    },
  };
}
