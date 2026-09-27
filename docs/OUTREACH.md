# Buyer Outreach Email

Send a templated outreach email to an approved buyer from **Buyer finder → Saved Buyers**.

## Setup
1. In Zoho Mail, enable 2FA on the shared team account, then generate an **App-Specific Password** (My Account → Sign-in and Security → App-Specific Passwords).
2. Set these in `.env` (and in `docker-compose` env):
   - `ZOHO_SMTP_USER` — the shared mailbox address (also the "from" address).
   - `ZOHO_SMTP_PASSWORD` — the app-specific password.
   - `ZOHO_SMTP_HOST` — `smtp.zoho.com` (or `smtp.zoho.eu`, `smtp.zoho.in` by data center).
   - `ZOHO_SMTP_PORT` — `465` (implicit TLS) or `587` (STARTTLS).
   - `OUTREACH_FROM_NAME` — display name on outbound mail (optional).
   - `OUTREACH_SENDER_COMPANY` — fills the `{our_company}` placeholder.
   - `OUTREACH_MAX_SENDS_PER_DAY` — app-side rolling-24h cap (default 50). Zoho applies its own mailbox limit below this.
3. Restart the app. `GET /api/buyer-outreach/template` reports `mailConfigured: true`.
4. Apply the schema once: `npm run db:migrate`.

## Placeholders
`{company} {country} {city} {commodity} {buyer_type} {contact_name} {our_company}`.
`{city}` falls back to `{country}`; `{contact_name}` falls back to "Team". Unknown `{tokens}` are left exactly as typed and flagged in the editor preview.

## Notes
- Emails are plain text. The send log stores the exact subject/body sent.
- Every send (success or failure) is logged and counts toward the daily cap, because retries against a broken mailbox still consume Zoho quota.
- Sending is manual, one company at a time. There is no bulk send and no auto-retry (SMTP has no idempotency key, so a double-send risk means a human re-clicks).
- To use Zoho's REST API later (reply tracking, message ids), swap the `MailSender` implementation only — the send log and UI are transport-agnostic.
