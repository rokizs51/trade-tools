# Buyer Outreach Email (Zoho Mail) — Design

Date: 2026-09-27
Status: approved by user in chat

## Goal

Complete the buyer-finder loop: after research and human review, send a templated
cold-outreach email to each approved company with one click. Emails are sent by the
server through the shared team Zoho Mail mailbox via SMTP.

```
input → 4 research agents find companies → list → human review (approve) → ✉ send → logged
```

## Decisions made (with user)

| Topic | Decision |
|---|---|
| Send mode | True one-click send from the server (not a mailto/draft handoff) |
| Editing | Global template editor **plus** a pre-send preview panel where subject/body can be tweaked per email |
| Recipient | Chosen from the company's stored `EMAIL` contacts (dropdown); never free-text |
| Tracking | Log every send (success and failure) in-app; "Contacted" badge per company |
| Sender | One shared team mailbox; small team all sends through it |
| Transport | SMTP + nodemailer (`smtp.zoho.com`, app-specific password). **Rejected:** Zoho REST API + OAuth — token lifecycle complexity only pays off for reply tracking, which is out of scope |
| Placeholders | Fixed whitelist rendered from stored data; unknown `{tokens}` left as-is and flagged |

## Existing context this builds on

- `buyer_matches.review_status` already supports `NEW / APPROVED / REJECTED` with a PATCH endpoint; the "Saved Buyers" UI view exists.
- `buyer_contacts` stores `EMAIL / PHONE / CONTACT_PAGE` values with source provenance.
- No email/mailer code exists anywhere yet.
- **No workspace scoping**: the workspace authorization migrations
  (`20260920122158`/`20260920122500`) were fully reverted by `20260920124247` —
  no table has a `workspace_id` column today. New tables are app-singleton, like
  the current buyer tables.
- Buyer matches API (`toApiResult`) already hydrates contacts; it will additionally
  expose each contact's `id` so the send request can reference a contact by id.
- Only new dependency: `nodemailer` (AGENTS.md allows dependencies when necessary;
  raw SMTP is not worth it).

## Architecture

```
Saved Buyers row (APPROVED match, EMAIL contacts from buyer_contacts)
   │ click ✉ Send
   ▼
Send panel: recipient dropdown + subject/body pre-rendered from template → human tweaks
   │ POST /api/buyer-outreach/send {buyerMatchId, contactId, subject, body}
   ▼
Outreach API: contact must belong to that company · match must be APPROVED
   │          · daily send cap enforced
   ▼
MailSender interface ── SmtpMailSender (nodemailer → smtp.zoho.com:465, app password)
   ▼
buyer_outreach_sends row (SENT or FAILED, exact copy sent) ── UI badge updates
```

### Components

- **`MailSender` interface** — one method `send({to, subject, text}): Promise<void>`.
  Tests inject `FakeMailSender` (records calls, injectable failures), mirroring the
  existing transport-injection style of `OpenRouterModelClient`.
- **`SmtpMailSender`** (infrastructure, new file next to the AI client) — nodemailer
  transport created lazily from env. `mailConfigured` = required env vars present;
  the server never sends without them.
- **`emailTemplate` domain module** (`src/domain/outreach/`) — pure render function over
  the whitelist: `{company} {country} {city} {commodity} {buyer_type} {contact_name}
  {our_company}`. Fallbacks: missing `city` → country name; missing contact label → `"Team"`.
  Plain-text bodies (newlines preserved). Unknown `{tokens}` are preserved verbatim
  so the preview can warn. The module is isomorphic: the browser imports it (via
  `dist/`) to pre-render the send panel, and the server imports the same code for the
  template view's sample preview — one implementation, per AGENTS.md no-duplication rule.
- **Outreach API + repository** — mounted in `serve.mjs` beside the existing buyer
  routes, same auth middleware as `/api/buyer-*`.
- **UI** — send panel on Saved Buyers + a new "Email" subview for the template
  editor (extends `ToolSubview` routing in `workspaceRoute.ts`).

## Data model (2 new tables)

Both are app-singleton (no `workspace_id`, since the workspace migration was reverted).

### `email_templates`
One global row seeded with the built-in default template (upsert on save; a template
gallery is YAGNI, per-email tweaks cover variation). Seeded by the migration.

| column | notes |
|---|---|
| `id` | single row, `'default'` |
| `subject`, `body` | plain text, length-capped |
| `updated_at` | |

### `buyer_outreach_sends`

| column | notes |
|---|---|
| `id` | text primary key |
| `buyer_match_id` | plain text reference to the originating match — deliberately NOT a FK (a cascade FK would erase audit history on run deletion; a restrict FK would block deleting a run that has emailed) |
| `company_id` | plain text reference to the company — NOT a FK; the send log is the audit trail and must survive deletion of the originating search run |
| `recipient_email` | resolved server-side from `buyer_contacts`, never from client text |
| `subject`, `body` | exact text sent |
| `status` | `SENT` \| `FAILED` |
| `error_message` | nullable, excerpt on failure |
| `sent_at` | timestamptz |

"Contacted" = latest `SENT` per **company** (across all runs/matches).

## API surface

All under existing `/api/` auth middleware. Outreach is a **separate handler**
(`createOutreachApiHandler` in a new `scripts/outreachApi.mjs`) mounted in `serve.mjs`
immediately after `handleBuyerApiRequest`, gated on `pathname.startsWith("/api/buyer-outreach")`.
This keeps it independently testable (matching the existing per-feature handler style,
where each module has its own `sendJson`/`sendError`/`readJsonBody` helpers). The
handler is constructed with `{ outreachRepository, buyerRepository, mailSender, config }`.

The domain module lives at `src/domain/outreach/` (compiled to `dist/domain/outreach/`),
mirroring `src/domain/buyers/`.

| Route | Behavior |
|---|---|
| `GET /api/buyer-outreach/template` | Global template (built-in defaults if never saved) + `mailConfigured: boolean` + `sender: { fromAddress, ourCompany }` + `placeholders: string[]` |
| `PUT /api/buyer-outreach/template` | Save `{subject, body}`; subject ≤ 500, body ≤ 20 000 chars; non-empty |
| `GET /api/buyer-outreach/summaries` | Per-company outreach summary map `{ [companyId]: { sentCount, lastSentAt } }` for the Contacted badges (one grouped query) |
| `POST /api/buyer-outreach/send` | `{buyerMatchId, contactId, subject, body}` → validate → SMTP send → log row → return send row |

Note: `toApiResult` in `buyerApi.mjs` is extended to expose `contact.id` on each contact
so the client can send `contactId`. That is the only change needed to the existing buyer
results endpoint for the send flow.

Validation rules on send:

- `contactId` must be an `EMAIL` contact of the match's company → else 409.
- Match `review_status` must be `APPROVED` → else 409.
- `mailConfigured` → else 409.
- Daily cap `OUTREACH_MAX_SENDS_PER_DAY` (default 50): counts **all send rows created
  today (SENT and FAILED)**; exceeded → 429. Counting failures too is deliberate —
  repeated retries against a broken mailbox still burn Zoho quota.
- Subject/body length caps re-enforced server-side.

## UI

### Saved Buyers (extend — it renders `buyer-saved-card` elements)

- **Contacted badge** on each saved-buyer card: `✉ {date} (n)` when SENT rows exist for
  that company, dash otherwise. Badge data comes from `GET /api/buyer-outreach/summaries`.
- **Send email** button on each card; disabled with a reason tooltip when the company has
  no EMAIL contact or when mail is not configured.
- Send panel (inline within the card): recipient dropdown (first EMAIL contact
  preselected), editable Subject + Body textarea pre-rendered from the template with that
  company's values, a warning line when the template contains unknown placeholders or omits
  `{our_company}`, and **[Cancel] [Send]**. On success the panel closes, a status line
  confirms, and the card's Contacted badge updates. On failure the panel stays open with
  the error + a Retry button (manual, one attempt per click).

### Email subview (new, 4th tab of the buyer tool)

- Template editor: Subject input + Body textarea; placeholder reference chips that insert at
  cursor; Save button; live sample preview with obvious fake values.
- Status line: "Sending as {ZOHO_SMTP_USER}" or "Mail not configured" guidance.

## Configuration (env)

| Var | Default | Purpose |
|---|---|---|
| `ZOHO_SMTP_HOST` | `smtp.zoho.com` | SMTP host (use `smtp.zoho.eu` etc. per data center) |
| `ZOHO_SMTP_PORT` | `465` | |
| `ZOHO_SMTP_USER` | — | shared team mailbox address |
| `ZOHO_SMTP_PASSWORD` | — | Zoho **app-specific password** (requires 2FA on the account) |
| `OUTREACH_FROM_NAME` | unset | display name on "from" |
| `OUTREACH_SENDER_COMPANY` | — | fills `{our_company}` |
| `OUTREACH_MAX_SENDS_PER_DAY` | `50` | app-side cap |

Setup docs go in a new `docs/OUTREACH.md`: create app password in Zoho (requires 2FA),
set env vars, restart.

## Error handling

- SMTP auth/host/timeout failures → log `FAILED` row with error excerpt; UI shows
  "Send failed: {message}" + Retry. **No auto-retry** (SMTP has no idempotency key;
  double-send risk means user-confirmed retry only). 30 s timeout per attempt.
- Rendering safety: template text and scraped values reach the DOM only via
  `textContent` / `.value` — no innerHTML on untrusted strings.
- Abuse guardrails: recipients resolvable only via stored contact ids; body length caps;
  daily cap; every send logged with its full rendered content.
- Soft compliance hint: preview warns if `{our_company}` is absent from the body.

## Testing

- Unit: `emailTemplate` renderer (whitelist substitution, unknown tokens preserved,
  city/contact fallbacks).
- Unit/service with `FakeMailSender`: validation rejections (foreign contactId,
  non-approved match, mail unconfigured), FAILED logging, daily cap.
- API tests in `test/buyerApi.test.mjs` style: template GET/PUT, send happy path and
  each rejection, matches endpoint gains `outreach` + `emailContacts`.
- Repository/migration tests per `postgresBuyerRepository.test.mjs` pattern.
- Manual acceptance: configure app password → send one email to your own address →
  verify it appears in Zoho Sent folder, in `buyer_outreach_sends`, and the Contacted
  badge updates.

## Out of scope / future work

- HTML bodies, attachments, per-user sender identity, reply tracking (swap
  `MailSender` for the Zoho REST/OAuth transport if ever needed — send-log schema
  survives the change), CC/BCC, bulk blast mode, bounce handling, unsubscribe links,
  CRM export.

## Definition of Done (feature-specific)

1. Build/tests/lint pass; new calculation-free logic covered by the tests above.
2. A sent email is visible in Zoho Sent and in-app with exact stored copy.
3. No API response ever exposes SMTP credentials.
4. `AGENTS.md` rules respected: only nodemailer added, business logic separate from UI,
   no unrelated refactors.
