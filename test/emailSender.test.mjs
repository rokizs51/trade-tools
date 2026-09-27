import assert from "node:assert/strict";
import test from "node:test";

import { readSmtpSettings } from "../dist/infrastructure/email/smtpMailSender.js";

test("readSmtpSettings returns null without user or password", () => {
  assert.equal(readSmtpSettings({}), null);
  assert.equal(readSmtpSettings({ ZOHO_SMTP_USER: "team@example.com" }), null);
});

test("readSmtpSettings reads full config with defaults", () => {
  const settings = readSmtpSettings({
    ZOHO_SMTP_USER: "team@example.com",
    ZOHO_SMTP_PASSWORD: "app-pass",
    OUTREACH_FROM_NAME: "Trade Tools",
    OUTREACH_SENDER_COMPANY: "Trade Tools Co",
  });
  assert.equal(settings.host, "smtp.zoho.com");
  assert.equal(settings.port, 465);
  assert.equal(settings.fromAddress, "team@example.com");
  assert.equal(settings.fromName, "Trade Tools");
  assert.equal(settings.ourCompany, "Trade Tools Co");
});

test("readSmtpSettings honours host/port overrides and rejects bad port", () => {
  assert.equal(readSmtpSettings({ ZOHO_SMTP_USER: "u", ZOHO_SMTP_PASSWORD: "p", ZOHO_SMTP_HOST: "smtp.zoho.eu", ZOHO_SMTP_PORT: "587" }).host, "smtp.zoho.eu");
  assert.equal(readSmtpSettings({ ZOHO_SMTP_USER: "u", ZOHO_SMTP_PASSWORD: "p", ZOHO_SMTP_PORT: "0" }), null);
  assert.equal(readSmtpSettings({ ZOHO_SMTP_USER: "u", ZOHO_SMTP_PASSWORD: "p", ZOHO_SMTP_PORT: "abc" }), null);
});
