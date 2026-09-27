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
- New tables follow the workspace composite-FK pattern from
  `20260920122500_enforce_buyer_workspace_relationships.sql`.
- Only new dependency: `nodemailer` (AGENTS.md allows dependencies when necessary;
  raw SMTP is not worth it).

## Architecture

```
Saved Buyers row (APPROVED match, EMAIL contacts from buyer_contacts)
   │ click ✉ Send
   ▼
Send panel: recipient dropdown + subject/body pre-rendered from template → human tweaks
   │ POST /api/outreach/send {buyerMatchId, contactId, subject, body}
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
  routes, workspace-scoped, same auth middleware as `/api/buyer-*`.
- **UI** — send panel on Saved Buyers + a new "Email" subview for the template
  editor (extends `ToolSubview` routing in `workspaceRoute.ts`).

## Data model (2 new tables)

### `email_templates`
One row per workspace (upsert on save; single default template — a template gallery
is YAGNI, per-email tweaks cover variation).

| column | notes |
|---|---|
| `workspace_id` | FK to workspaces, composite-unique with `id` |
| `subject`, `body` | plain text, length-capped |
| `updated_at` | |

### `buyer_outreach_sends`

| column | notes |
|---|---|
| `id`, `workspace_id` | composite FK pattern as `buyer_sources` |
| `buyer_match_id` | composite FK → `buyer_matches(id, workspace_id)`, on delete cascade |
| `company_id` | FK → company, so contact history survives run deletion |
| `recipient_email` | resolved server-side from `buyer_contacts`, never from client text |
| `subject`, `body` | exact text sent |
| `status` | `SENT` \| `FAILED` |
| `error_message` | nullable, excerpt on failure |
| `sent_at` | timestamptz |

"Contacted" = latest `SENT` per **company** (across all runs/matches in the workspace).

## API surface

All under existing `/api/` auth + workspace middleware.

| Route | Behavior |
|---|---|
| `GET /api/outreach/template` | Workspace template (built-in defaults if never saved) + `mailConfigured: boolean` |
| `PUT /api/outreach/template` | Save `{subject, body}`; subject ≤ 500, body ≤ 20 000 chars; non-empty |
| `GET /api/buyer-matches` (extend) | Each match gains `outreach: {sentCount, lastSentAt}` and `emailContacts: [{id, value, label}]`; one grouped query, no N+1 |
| `POST /api/outreach/send` | `{buyerMatchId, contactId, subject, body}` → validate → render nothing (client sends final text) → SMTP send → log row → return send row |

Validation rules on send:

- `contactId` must be an `EMAIL` contact of the match's company in this workspace → else 409.
- Match `review_status` must be `APPROVED` → else 409.
- `mailConfigured` → else 409.
- Daily cap `OUTREACH_MAX_SENDS_PER_DAY` (default 50): counts **all send rows created
  today (SENT and FAILED)**; exceeded → 429. Counting failures too is deliberate —
  repeated retries against a broken mailbox still burn Zoho quota.
- Subject/body length caps re-enforced server-side.

## UI

### Saved Buyers (extend)

- New **Contacted** column: badge `✉ {date} (n)` when SENT rows exist per company, dash otherwise.
- **Send** button on APPROVED rows with ≥1 EMAIL contact; disabled with a reason otherwise:
  "Not approved" / "No email found" / "Mail not configured".
- Send panel (inline): recipient dropdown (first contact preselected), editable Subject +
  Body textarea pre-rendered from template with that company's values, warning line when the
  template contains unknown placeholders, **[Cancel] [Send]**. On result: toast + badge update.
  Retry (manual, one attempt per click) on failure.

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
  daily cap; all sends logged with author workspace.
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
