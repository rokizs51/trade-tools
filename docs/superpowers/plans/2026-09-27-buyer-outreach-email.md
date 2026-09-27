# Buyer Outreach Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reviewer send a configurable, templated outreach email from an approved buyer directly in the app, via the team's Zoho Mail account (SMTP).

**Architecture:** A zod-free pure template renderer lives in the shared domain layer so both the browser and server use one implementation. Server-side: a Postgres repository stores a single global email template and a send log; a standalone `/api/buyer-outreach/*` handler validates the request against stored data, enforces a rolling 24h cap, and hands the final text to a nodemailer SMTP `MailSender` (behind an injectable interface). Browser-side: an Email template editor subview and an inline send panel on the Saved Buyers cards.

**Tech Stack:** TypeScript (ES2022, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Node built-in `http` server, Postgres via `scripts/postgresClient.mjs`, `zod@4`, `nodemailer` (new), vanilla DOM UI.

## Global Constraints

- No new feature outside the spec; do not modify unrelated files; no unrelated refactors (AGENTS.md).
- Business/render logic stays separate from UI; do not duplicate calculation/formula logic.
- Only new runtime dependency: `nodemailer`. New devDependency: `@types/nodemailer`. Nothing else.
- Browser modules must **never** import anything that transitively imports `zod`: the browser importmap has no `zod` entry. Import outreach rendering only from `./domain/outreach/emailTemplate.js` (zod-free), never from the `index.js` barrel.
- TypeScript uses `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`: build optional fields with conditional spreads (`...(v ? { k: v } : {})`), and guard `rows[0]`/index access.
- All untrusted strings (company names, scraped data, edited email text) reach the DOM via `textContent` / `.value` / `createElement(...,text)` only — never `innerHTML`.
- Server responses must never include SMTP credentials; `fromAddress` and `ourCompany` are the only sender fields exposed.
- Two tables are app-singleton (no `workspace_id` — that migration was reverted). In `buyer_outreach_sends`, BOTH `buyer_match_id` and `company_id` are plain text references, **not** foreign keys: a cascade FK would erase the send audit trail when its search run is deleted, and a RESTRICT FK would block deleting a run that has ever emailed. The send log is the durable audit record and must survive run deletion.
- Build gate: `npm run build` (tsc) must pass. Test gate: `npm test` must pass. There is no separate lint script.
- Verification before claiming any task done: run the command and read its actual output.

## File Structure

New files
- `src/domain/outreach/emailTemplate.ts` — pure renderer, placeholder whitelist, default template, shared types (zod-free).
- `src/domain/outreach/schemas.ts` — zod schemas for template + send request (server/tests only).
- `src/domain/outreach/index.ts` — barrel for server/test imports (NOT imported by browser).
- `src/infrastructure/email/types.ts` — `MailSender` interface + `OutboundMailMessage`.
- `src/infrastructure/email/smtpMailSender.ts` — env reader + nodemailer sender.
- `src/infrastructure/email/index.ts` — barrel.
- `scripts/postgresOutreachRepository.mjs` — template + send-log persistence.
- `scripts/outreachApi.mjs` — `/api/buyer-outreach/*` handler.
- `supabase/migrations/20260927000000_add_buyer_outreach.sql` — 2 tables + seed row.
- `src/outreachApi.ts` — thin browser fetch client.
- `src/outreachUi.ts` — Email template editor subview.
- `docs/OUTREACH.md` — setup + operator notes.
- `test/outreachTemplate.test.mjs`, `test/outreachRepository.test.mjs`, `test/outreachApi.test.mjs`, `test/emailSender.test.mjs`.

Modified
- `scripts/persistence.mjs` — expose `outreachRepository`.
- `scripts/serve.mjs` — build mailSender + mount outreach handler.
- `scripts/buyerApi.mjs` — expose `contact.id` in `toApiResult`.
- `src/workspaceRoute.ts` — add `outreach` subview for the buyer tool.
- `src/app.ts` — instantiate `OutreachUi`, add 4th nav button, route it.
- `src/buyerFinderUi.ts` — send panel + Contacted badge on Saved Buyers.
- `index.html` — nav button + outreach section markup.
- `src/styles.css` — minor chip/panel styles.
- `package.json` — dependencies + test-script entries.

---

## Task 1: Pure email template renderer (domain)

**Files:**
- Create: `src/domain/outreach/emailTemplate.ts`
- Test: `test/outreachTemplate.test.mjs`
- Modify: `package.json` (append test to `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces (imported later by `outreachUi.ts`, `buyerFinderUi.ts`, `outreachApi.mjs`, `schemas.ts`):
  - `type EmailTemplate = { subject: string; body: string }`
  - `type TemplateValues = { company: string; country: string; commodity: string; buyerType: string; city?: string; contactName?: string; ourCompany?: string }`
  - `type OutreachSummary = { sentCount: number; lastSentAt: string | null }`
  - `const PLACEHOLDER_KEYS: readonly string[]` = `["company","country","city","commodity","buyer_type","contact_name","our_company"]`
  - `const DEFAULT_EMAIL_TEMPLATE: EmailTemplate`
  - `function renderEmailTemplate(template: EmailTemplate, values: TemplateValues): EmailTemplate`
  - `function listUnknownPlaceholders(template: EmailTemplate): string[]`

- [ ] **Step 1: Write the failing test**

Create `test/outreachTemplate.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EMAIL_TEMPLATE,
  PLACEHOLDER_KEYS,
  listUnknownPlaceholders,
  renderEmailTemplate,
} from "../dist/domain/outreach/emailTemplate.js";

const values = {
  company: "Acme Foods",
  country: "Thailand",
  city: "Bangkok",
  commodity: "coconut",
  buyerType: "Importer",
  contactName: "Purchasing",
  ourCompany: "Trade Tools",
};

test("renders every known placeholder", () => {
  const rendered = renderEmailTemplate(
    { subject: "{commodity} for {company}", body: "Hi {contact_name} at {city}, {country}. We are {our_company}, a {buyer_type} partner." },
    values,
  );
  assert.equal(rendered.subject, "coconut for Acme Foods");
  assert.ok(rendered.body.includes("Hi Purchasing at Bangkok, Thailand."));
  assert.ok(rendered.body.includes("Trade Tools"));
});

test("falls back city->country and contact_name->Team", () => {
  const rendered = renderEmailTemplate(
    { subject: "s", body: "{city} | {contact_name}" },
    { company: "c", country: "Thailand", commodity: "x", buyerType: "y" },
  );
  assert.equal(rendered.body, "Thailand | Team");
});

test("leaves unknown placeholders intact and reports them", () => {
  const template = { subject: "Hello {name}", body: "Ref {order_id} for {company}" };
  const rendered = renderEmailTemplate(template, values);
  assert.equal(rendered.subject, "Hello {name}");
  assert.equal(rendered.body, "Ref {order_id} for Acme Foods");
  assert.deepEqual(listUnknownPlaceholders(template), ["name", "order_id"]);
});

test("whitespace inside braces still resolves", () => {
  assert.equal(renderEmailTemplate({ subject: "{ company }", body: "" }, values).subject, "Acme Foods");
});

test("default template has no unknown placeholders", () => {
  assert.deepEqual(listUnknownPlaceholders(DEFAULT_EMAIL_TEMPLATE), []);
  assert.deepEqual(
    [...PLACEHOLDER_KEYS],
    ["company", "country", "city", "commodity", "buyer_type", "contact_name", "our_company"],
  );
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run build && node test/outreachTemplate.test.mjs`
Expected: build FAILS — `Cannot find module './domain/outreach/emailTemplate'` is not yet it; the compile fails because `src/domain/outreach/emailTemplate.ts` does not exist, OR (if you skip build) `node` throws `Cannot find module '../dist/domain/outreach/emailTemplate.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/outreach/emailTemplate.ts` (must have **no imports** so it is browser-safe):

```ts
export type EmailTemplate = {
  subject: string;
  body: string;
};

export type TemplateValues = {
  company: string;
  country: string;
  commodity: string;
  buyerType: string;
  city?: string;
  contactName?: string;
  ourCompany?: string;
};

export type OutreachSummary = {
  sentCount: number;
  lastSentAt: string | null;
};

export const PLACEHOLDER_KEYS = [
  "company",
  "country",
  "city",
  "commodity",
  "buyer_type",
  "contact_name",
  "our_company",
] as const satisfies readonly string[];

export const DEFAULT_EMAIL_TEMPLATE: EmailTemplate = {
  subject: "{commodity} supply for {company} in {country}",
  body:
    "Hello {contact_name},\n\n" +
    "We are {our_company}, an exporter of {commodity}. Our research shows {company} " +
    "operates as a {buyer_type} in {city}, {country}.\n\n" +
    "Could we discuss a supply arrangement? I am glad to share specifications, MOQs, " +
    "and pricing at your convenience.\n\n" +
    "Best regards,\n{our_company}",
};

const PLACEHOLDER_SOURCE = "\\{\\s*([a-z_][a-z0-9_]*)\\s*\\}";

function placeholderRegex(): RegExp {
  return new RegExp(PLACEHOLDER_SOURCE, "g");
}

function isKnown(key: string): boolean {
  return (PLACEHOLDER_KEYS as readonly string[]).includes(key);
}

function resolve(key: string, values: TemplateValues): string | undefined {
  switch (key) {
    case "company":
      return values.company;
    case "country":
      return values.country;
    case "city":
      return values.city?.trim() ? values.city : values.country;
    case "commodity":
      return values.commodity;
    case "buyer_type":
      return values.buyerType;
    case "contact_name":
      return values.contactName?.trim() ? values.contactName : "Team";
    case "our_company":
      return values.ourCompany ?? "";
    default:
      return undefined;
  }
}

export function renderEmailTemplate(template: EmailTemplate, values: TemplateValues): EmailTemplate {
  const render = (input: string): string =>
    input.replace(placeholderRegex(), (match: string, key: string) => {
      const resolved = resolve(key, values);
      return resolved ?? match;
    });
  return { subject: render(template.subject), body: render(template.body) };
}

export function listUnknownPlaceholders(template: EmailTemplate): string[] {
  const found = new Set<string>();
  for (const text of [template.subject, template.body]) {
    for (const match of text.matchAll(placeholderRegex())) {
      const key = match[1];
      if (key && !isKnown(key)) found.add(key);
    }
  }
  return [...found];
}
```

- [ ] **Step 4: Register the test and run to pass**

In `package.json`, change the end of the `test` script from `... && node test/postgresConfiguration.test.mjs"` to `... && node test/postgresConfiguration.test.mjs && node test/outreachTemplate.test.mjs"`.

Run: `npm run build && node test/outreachTemplate.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/outreach/emailTemplate.ts test/outreachTemplate.test.mjs package.json
git commit -m "feat: add pure email template renderer for buyer outreach"
```

---

## Task 2: Outreach zod schemas + barrel

**Files:**
- Create: `src/domain/outreach/schemas.ts`
- Create: `src/domain/outreach/index.ts`
- Test: `test/outreachTemplate.test.mjs` (append schema assertions)

**Interfaces:**
- Consumes: `EmailTemplate` (Task 1) for inference.
- Produces (server + tests only):
  - `const EmailTemplateSchema` → parses to `{ subject: string; body: string }` (subject 1..500, body 1..20000, `.strict()`)
  - `const OutreachSendSchema` → parses to `{ buyerMatchId, contactId, subject, body }` (ids 1..200 trimmed, subject 1..500, body 1..20000, `.strict()`)
  - `type EmailTemplateInput`, `type OutreachSendInput`
  - barrel `src/domain/outreach/index.ts` re-exporting `./emailTemplate.js` and `./schemas.js`.

- [ ] **Step 1: Write the failing test**

Append to `test/outreachTemplate.test.mjs`:

```js
import { EmailTemplateSchema, OutreachSendSchema } from "../dist/domain/outreach/schemas.js";

test("EmailTemplateSchema enforces bounds and strict shape", () => {
  assert.equal(EmailTemplateSchema.safeParse({ subject: "Hello {company}", body: "Body" }).success, true);
  assert.equal(EmailTemplateSchema.safeParse({ subject: "", body: "x" }).success, false);
  assert.equal(EmailTemplateSchema.safeParse({ subject: "x".repeat(501), body: "x" }).success, false);
  assert.equal(EmailTemplateSchema.safeParse({ subject: "x", body: "y".repeat(20001) }).success, false);
  assert.equal(EmailTemplateSchema.safeParse({ subject: "x", body: "y", extra: 1 }).success, false);
});

test("OutreachSendSchema requires trimmed ids and text", () => {
  assert.equal(
    OutreachSendSchema.safeParse({ buyerMatchId: "m1", contactId: "c1", subject: " s ", body: " b " }).success,
    true,
  );
  const parsed = OutreachSendSchema.parse({ buyerMatchId: " m1 ", contactId: "c1", subject: "s", body: "b" });
  assert.equal(parsed.buyerMatchId, "m1");
  assert.equal(OutreachSendSchema.safeParse({ buyerMatchId: "", contactId: "c1", subject: "s", body: "b" }).success, false);
  assert.equal(OutreachSendSchema.safeParse({ buyerMatchId: "m1", subject: "s", body: "b" }).success, false);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run build && node test/outreachTemplate.test.mjs`
Expected: FAIL — `Cannot find module '../dist/domain/outreach/schemas.js'` (source not present yet).

- [ ] **Step 3: Write the implementation**

Create `src/domain/outreach/schemas.ts`:

```ts
import { z } from "zod";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const EmailTemplateSchema = z
  .object({
    subject: trimmed(1, 500),
    body: trimmed(1, 20_000),
  })
  .strict();

export type EmailTemplateInput = z.infer<typeof EmailTemplateSchema>;

export const OutreachSendSchema = z
  .object({
    buyerMatchId: trimmed(1, 200),
    contactId: trimmed(1, 200),
    subject: trimmed(1, 500),
    body: trimmed(1, 20_000),
  })
  .strict();

export type OutreachSendInput = z.infer<typeof OutreachSendSchema>;
```

Create `src/domain/outreach/index.ts`:

```ts
export * from "./emailTemplate.js";
export * from "./schemas.js";
```

- [ ] **Step 4: Run to pass**

Run: `npm run build && node test/outreachTemplate.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/outreach/schemas.ts src/domain/outreach/index.ts test/outreachTemplate.test.mjs
git commit -m "feat: add outreach zod schemas and domain barrel"
```

---

## Task 3: SMTP MailSender (infrastructure)

**Files:**
- Create: `src/infrastructure/email/types.ts`
- Create: `src/infrastructure/email/smtpMailSender.ts`
- Create: `src/infrastructure/email/index.ts`
- Test: `test/emailSender.test.mjs`
- Modify: `package.json` (deps + test entry)

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by `serve.mjs`, `outreachApi` tests):
  - `type OutboundMailMessage = { to: string; subject: string; text: string }`
  - `interface MailSender { send(message: OutboundMailMessage): Promise<void> }`
  - `type SmtpSettings = { host: string; port: number; user: string; password: string; fromAddress: string; fromName?: string; ourCompany?: string }`
  - `function readSmtpSettings(env: Record<string, string | undefined>): SmtpSettings | null`
  - `function createSmtpMailSender(settings: SmtpSettings): MailSender`

- [ ] **Step 1: Install dependencies**

Run: `npm install nodemailer && npm install -D @types/nodemailer`
Expected: `nodemailer` in `dependencies`, `@types/nodemailer` in `devDependencies`. If a current `@types/nodemailer` is rejected as a version conflict, pin `@types/nodemailer@^6.4`.

- [ ] **Step 2: Write the failing test**

Create `test/emailSender.test.mjs`:

```js
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
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm run build && node test/emailSender.test.mjs`
Expected: FAIL — `Cannot find module '../dist/infrastructure/email/smtpMailSender.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/infrastructure/email/types.ts`:

```ts
export type OutboundMailMessage = {
  to: string;
  subject: string;
  text: string;
};

export interface MailSender {
  send(message: OutboundMailMessage): Promise<void>;
}
```

Create `src/infrastructure/email/smtpMailSender.ts`:

```ts
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
```

Create `src/infrastructure/email/index.ts`:

```ts
export * from "./types.js";
export * from "./smtpMailSender.js";
```

- [ ] **Step 5: Run to pass**

Register: change end of `package.json` `test` script to `... && node test/outreachTemplate.test.mjs && node test/emailSender.test.mjs"`.
Run: `npm run build && node test/emailSender.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/email test/emailSender.test.mjs package.json package-lock.json
git commit -m "feat: add SMTP mail sender with Zoho env config"
```

---

## Task 4: Database migration + outreach repository

**Files:**
- Create: `supabase/migrations/20260927000000_add_buyer_outreach.sql`
- Create: `scripts/postgresOutreachRepository.mjs`
- Modify: `scripts/persistence.mjs`
- Test: `test/outreachRepository.test.mjs`
- Modify: `package.json` (test entry)

**Interfaces:**
- Consumes: `createPostgresClient` `sql` tag (as in `postgresBuyerRepository.mjs`).
- Produces (`outreachRepository`, consumed by `outreachApi.mjs`):
  - `getTemplate(): Promise<{ subject: string; body: string } | null>`
  - `saveTemplate(template: {subject,body}, options: {now}): Promise<{subject,body}>`
  - `recordSend(send): Promise<{ id: string; status: string }>`
  - `countRecentSends(sinceIso: string): Promise<number>`
  - `listSummaries(): Promise<Record<string, { sentCount: number; lastSentAt: string | null }>>`

- [ ] **Step 1: Write the failing test**

Create `test/outreachRepository.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresOutreachRepository } from "../scripts/postgresOutreachRepository.mjs";

function createSqlStub(handler) {
  const queries = [];
  function sql(first, ...values) {
    if (!first?.raw) return { type: "value-list", values: first };
    const statement = first.join("?").replace(/\s+/g, " ").trim();
    queries.push({ statement, values });
    return Promise.resolve(handler(statement, values) ?? []);
  }
  return { sql, queries };
}

test("getTemplate returns null when no row exists", async () => {
  const { sql } = createSqlStub(() => []);
  assert.equal(await createPostgresOutreachRepository(sql).getTemplate(), null);
});

test("getTemplate maps the default row", async () => {
  const { sql } = createSqlStub(() => [{ subject: "S", body: "B" }]);
  assert.deepEqual(await createPostgresOutreachRepository(sql).getTemplate(), { subject: "S", body: "B" });
});

test("saveTemplate upserts the single default row", async () => {
  const { sql, queries } = createSqlStub(() => [{ subject: "S", body: "B" }]);
  const saved = await createPostgresOutreachRepository(sql).saveTemplate({ subject: "S", body: "B" }, { now: "2026-09-27T00:00:00.000Z" });
  assert.deepEqual(saved, { subject: "S", body: "B" });
  assert.match(queries[0].statement, /insert into public\.email_templates .* on conflict \(id\) do update/s);
  assert.equal(queries[0].values[0], "S");
});

test("recordSend inserts and returns id+status", async () => {
  const { sql } = createSqlStub(() => [{ id: "send-1", status: "SENT" }]);
  const result = await createPostgresOutreachRepository(sql).recordSend({
    id: "send-1", buyerMatchId: "m1", companyId: "c1", recipientEmail: "a@b.co",
    subject: "s", body: "b", status: "SENT", errorMessage: null, sentAt: "2026-09-27T00:00:00.000Z",
  });
  assert.deepEqual(result, { id: "send-1", status: "SENT" });
});

test("countRecentSends returns the integer count", async () => {
  const { sql } = createSqlStub(() => [{ count: 3 }]);
  assert.equal(await createPostgresOutreachRepository(sql).countRecentSends("2026-09-26T00:00:00.000Z"), 3);
});

test("listSummaries groups by company with SENT-only metrics", async () => {
  const { sql } = createSqlStub(() => [
    { company_id: "c1", sent_count: 2, last_sent_at: new Date("2026-09-27T01:00:00.000Z") },
    { company_id: "c2", sent_count: 0, last_sent_at: null },
  ]);
  assert.deepEqual(await createPostgresOutreachRepository(sql).listSummaries(), {
    c1: { sentCount: 2, lastSentAt: "2026-09-27T01:00:00.000Z" },
    c2: { sentCount: 0, lastSentAt: null },
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node test/outreachRepository.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/postgresOutreachRepository.mjs'`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260927000000_add_buyer_outreach.sql`:

```sql
create table if not exists public.email_templates (
  id text primary key,
  subject text not null,
  body text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.buyer_outreach_sends (
  id text primary key,
  buyer_match_id text not null,
  company_id text not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  status text not null check (status in ('SENT', 'FAILED')),
  error_message text,
  sent_at timestamptz not null,
  created_at timestamptz not null
);

create index if not exists buyer_outreach_sends_company_idx
  on public.buyer_outreach_sends (company_id, sent_at desc);
create index if not exists buyer_outreach_sends_created_idx
  on public.buyer_outreach_sends (created_at desc);

insert into public.email_templates (id, subject, body, created_at, updated_at)
values (
  'default',
  '{commodity} supply for {company} in {country}',
  'Hello {contact_name},' || E'\n\n' || 'We are {our_company}, an exporter of {commodity}. Our research shows {company} operates as a {buyer_type} in {city}, {country}.' || E'\n\n' || 'Could we discuss a supply arrangement? I am glad to share specifications, MOQs, and pricing at your convenience.' || E'\n\n' || 'Best regards,' || E'\n' || '{our_company}',
  now(),
  now()
)
on conflict (id) do nothing;
```

- [ ] **Step 4: Write the repository**

Create `scripts/postgresOutreachRepository.mjs`:

```js
export function createPostgresOutreachRepository(sql) {
  return {
    async getTemplate() {
      const rows = await sql`
        select subject, body from public.email_templates where id = 'default' limit 1
      `;
      const row = rows[0];
      return row ? { subject: row.subject, body: row.body } : null;
    },

    async saveTemplate(template, options) {
      const now = options.now;
      const rows = await sql`
        insert into public.email_templates (id, subject, body, created_at, updated_at)
        values ('default', ${template.subject}, ${template.body}, ${now}, ${now})
        on conflict (id) do update set
          subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at
        returning subject, body
      `;
      const row = rows[0];
      return { subject: row.subject, body: row.body };
    },

    async recordSend(send) {
      const rows = await sql`
        insert into public.buyer_outreach_sends (
          id, buyer_match_id, company_id, recipient_email, subject, body,
          status, error_message, sent_at, created_at
        ) values (
          ${send.id}, ${send.buyerMatchId}, ${send.companyId}, ${send.recipientEmail},
          ${send.subject}, ${send.body}, ${send.status}, ${send.errorMessage ?? null},
          ${send.sentAt}, ${send.sentAt}
        )
        returning id, status
      `;
      const row = rows[0];
      return { id: row.id, status: row.status };
    },

    async countRecentSends(sinceIso) {
      const rows = await sql`
        select count(*)::int as count from public.buyer_outreach_sends
        where created_at >= ${sinceIso}
      `;
      return rows[0].count;
    },

    async listSummaries() {
      const rows = await sql`
        select company_id,
          count(*) filter (where status = 'SENT')::int as sent_count,
          max(sent_at) filter (where status = 'SENT') as last_sent_at
        from public.buyer_outreach_sends
        group by company_id
      `;
      return Object.fromEntries(rows.map((row) => [
        row.company_id,
        {
          sentCount: row.sent_count,
          lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
        },
      ]));
    },
  };
}
```

- [ ] **Step 5: Wire persistence**

In `scripts/persistence.mjs`, add the import alongside the others:

```js
import { createPostgresOutreachRepository } from "./postgresOutreachRepository.mjs";
```

and add the repository to the returned object:

```js
    buyerRepository: createPostgresBuyerRepository(sql),
    outreachRepository: createPostgresOutreachRepository(sql),
```

- [ ] **Step 6: Run to pass + full build**

Register: change end of `package.json` `test` script to `... && node test/emailSender.test.mjs && node test/outreachRepository.test.mjs"`.
Run: `npm run build && node test/outreachRepository.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260927000000_add_buyer_outreach.sql scripts/postgresOutreachRepository.mjs scripts/persistence.mjs test/outreachRepository.test.mjs package.json
git commit -m "feat: add outreach migration, repository, and persistence wiring"
```

> **Deploy note (not a gate for later tasks):** apply the schema against the hosted DB with `npm run db:migrate` before using the feature end-to-end. This writes to the shared Supabase database, so confirm with the user before running.

---

## Task 5: Outreach API handler + contact.id + server wiring

**Files:**
- Create: `scripts/outreachApi.mjs`
- Modify: `scripts/buyerApi.mjs` (`toApiResult` contacts gain `id`)
- Modify: `scripts/serve.mjs` (construct mailSender + config; mount handler)
- Modify: `test/buyerApi.test.mjs` (assert `contact.id`)
- Test: `test/outreachApi.test.mjs`
- Modify: `package.json` (test entry)

**Interfaces:**
- Consumes: `outreachRepository` (Task 4), `buyerRepository.getBuyerMatch` (returns hydrated match with `reviewStatus`, `company.id`, `contacts[].{id,type,value,label,isPublicBusinessContact}`), `MailSender` (Task 3), `OutreachSendSchema`/`EmailTemplateSchema` (Task 2), `DEFAULT_EMAIL_TEMPLATE`/`PLACEHOLDER_KEYS` (Task 1).
- Produces: `createOutreachApiHandler({ outreachRepository, buyerRepository, mailSender, config, now?, createId? })` returning `async (request, response, url) => boolean`. `config = { defaultTemplate, ourCompany, fromAddress, maxSendsPerDay, mailConfigured }`.

- [ ] **Step 1: Expose contact id in the buyer results**

In `scripts/buyerApi.mjs`, `toApiResult`, change the `contacts` map to include the id:

```js
    contacts: match.contacts.map((contact) => ({
      id: contact.id,
      type: contact.type,
      value: contact.value,
      label: contact.label,
      isPublicBusinessContact: contact.isPublicBusinessContact,
      sourceUrl: contact.sourceUrl,
    })),
```

In `test/buyerApi.test.mjs`, inside the "returns ranked results with public contact provenance" test, after the `contacts[0].sourceUrl` assertion add:

```js
    assert.equal(typeof body.results[0].contacts[0].id, "string");
```

- [ ] **Step 2: Write the failing outreach API test**

Create `test/outreachApi.test.mjs`:

```js
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createOutreachApiHandler } from "../scripts/outreachApi.mjs";
import { DEFAULT_EMAIL_TEMPLATE } from "../dist/domain/outreach/emailTemplate.js";

function makeMatch(overrides = {}) {
  return {
    id: "m1",
    reviewStatus: "APPROVED",
    company: { id: "c1", name: "Acme", countryName: "Thailand" },
    commodity: "coconut",
    buyerType: "IMPORTER",
    contacts: [
      { id: "ct1", type: "EMAIL", value: "buy@acme.test", label: "Purchasing", isPublicBusinessContact: true },
      { id: "ct2", type: "PHONE", value: "+66", isPublicBusinessContact: true },
    ],
    ...overrides,
  };
}

function harness({ match = makeMatch(), mailSender, recentSends = 0, maxSendsPerDay = 50, mailConfigured = true } = {}) {
  const sends = [];
  let template = null;
  const outreachRepository = {
    async getTemplate() { return template; },
    async saveTemplate(t) { template = { ...t }; return { ...t }; },
    async recordSend(s) { sends.push(s); return { id: s.id, status: s.status }; },
    async countRecentSends() { return recentSends; },
    async listSummaries() { return { c1: { sentCount: 1, lastSentAt: "2026-09-27T01:00:00.000Z" } }; },
  };
  const buyerRepository = { async getBuyerMatch(id) { return id === match.id ? match : undefined; } };
  const handler = createOutreachApiHandler({
    outreachRepository,
    buyerRepository,
    mailSender: mailConfigured ? mailSender : null,
    config: { defaultTemplate: DEFAULT_EMAIL_TEMPLATE, ourCompany: "Trade Tools", fromAddress: "team@acme.test", maxSendsPerDay, mailConfigured },
    now: () => "2026-09-27T02:00:00.000Z",
    createId: () => "send-1",
  });
  return { handler, sends, outreachRepository };
}

async function withServer(run, options) {
  const { handler } = harness(options);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!(await handler(request, response, url))) { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))); }
}

async function json(base, path, init) {
  const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json" }, ...init });
  return { status: response.status, body: await response.json() };
}

test("GET template returns stored template when unset, plus sender metadata", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/template");
    assert.equal(status, 200);
    assert.equal(body.template.subject, DEFAULT_EMAIL_TEMPLATE.subject);
    assert.equal(body.mailConfigured, true);
    assert.equal(body.sender.ourCompany, "Trade Tools");
    assert.ok(body.placeholders.includes("contact_name"));
  }, {});
});

test("PUT template round-trips", async () => {
  await withServer(async (base) => {
    const saved = await json(base, "/api/buyer-outreach/template", { method: "PUT", body: JSON.stringify({ subject: "New {company}", body: "Hi" }) });
    assert.equal(saved.status, 200);
    const got = await json(base, "/api/buyer-outreach/template");
    assert.equal(got.body.template.subject, "New {company}");
  }, {});
});

test("PUT template rejects oversized subject", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/template", { method: "PUT", body: JSON.stringify({ subject: "x".repeat(600), body: "Hi" }) });
    assert.equal(status, 400);
    assert.equal(body.error.code, "INVALID_REQUEST");
  }, {});
});

test("GET summaries returns the per-company map", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/summaries");
    assert.equal(status, 200);
    assert.equal(body.summaries.c1.sentCount, 1);
  }, {});
});

test("POST send succeeds and records a SENT row", async () => {
  const messages = [];
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "Body" }) });
    assert.equal(status, 201);
    assert.equal(body.send.status, "SENT");
  }, { mailSender: { async send(m) { messages.push(m); } } });
  assert.deepEqual(messages[0], { to: "buy@acme.test", subject: "Hi", text: "Body" });
});

test("POST send rejects a non-approved match", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 409);
    assert.equal(body.error.code, "MATCH_NOT_APPROVED");
  }, { match: makeMatch({ reviewStatus: "NEW" }), mailSender: { async send() {} } });
});

test("POST send rejects a contact not belonging to the match", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "nope", subject: "Hi", body: "B" }) });
    assert.equal(status, 409);
    assert.equal(body.error.code, "RECIPIENT_MISMATCH");
  }, { mailSender: { async send() {} } });
});

test("POST send rejects a phone contact id", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct2", subject: "Hi", body: "B" }) });
    assert.equal(status, 409);
    assert.equal(body.error.code, "RECIPIENT_MISMATCH");
  }, { mailSender: { async send() {} } });
});

test("POST send enforces the rolling 24h cap", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 429);
    assert.equal(body.error.code, "DAILY_CAP_REACHED");
  }, { mailSender: { async send() {} }, recentSends: 50, maxSendsPerDay: 50 });
});

test("POST send records FAILED and returns 502 when SMTP throws", async () => {
  const { handler, sends } = harness({ mailSender: { async send() { throw new Error("auth rejected"); } } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    await handler(request, response, url);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { status, body } = await json(`http://127.0.0.1:${server.address().port}`, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
  server.close();
  assert.equal(status, 502);
  assert.equal(body.send.status, "FAILED");
  assert.match(body.error.message, /auth rejected/);
  assert.equal(sends[0].status, "FAILED");
  assert.match(sends[0].errorMessage, /auth rejected/);
});

test("POST send returns 503 when mail is not configured", async () => {
  await withServer(async (base) => {
    const { status, body } = await json(base, "/api/buyer-outreach/send", { method: "POST", body: JSON.stringify({ buyerMatchId: "m1", contactId: "ct1", subject: "Hi", body: "B" }) });
    assert.equal(status, 503);
    assert.equal(body.error.code, "MAIL_NOT_CONFIGURED");
  }, { mailConfigured: false });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `node test/outreachApi.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/outreachApi.mjs'`.

- [ ] **Step 4: Write the handler**

Create `scripts/outreachApi.mjs`:

```js
import { z } from "zod";

import {
  EmailTemplateSchema,
  OutreachSendSchema,
  PLACEHOLDER_KEYS,
} from "../dist/domain/outreach/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;

class InvalidJsonError extends Error {
  constructor() { super("Request body must contain valid JSON."); this.name = "InvalidJsonError"; this.code = "INVALID_JSON"; }
}
class RequestBodyTooLargeError extends Error {
  constructor(max) { super(`Request body cannot exceed ${max} bytes.`); this.name = "RequestBodyTooLargeError"; this.code = "REQUEST_BODY_TOO_LARGE"; }
}

export function createOutreachApiHandler({ outreachRepository, buyerRepository, mailSender, config, now = () => new Date().toISOString(), createId }) {
  const mailConfigured = Boolean(mailSender) && config.mailConfigured !== false;

  return async function handleOutreachApiRequest(request, response, url) {
    if (!url.pathname.startsWith("/api/buyer-outreach")) return false;
    try {
      if (request.method === "GET" && url.pathname === "/api/buyer-outreach/template") {
        const stored = await outreachRepository.getTemplate();
        sendJson(response, 200, {
          template: stored ?? { subject: config.defaultTemplate.subject, body: config.defaultTemplate.body },
          mailConfigured,
          sender: { fromAddress: config.fromAddress || null, ourCompany: config.ourCompany ?? "" },
          placeholders: [...PLACEHOLDER_KEYS],
        });
        return true;
      }

      if (request.method === "PUT" && url.pathname === "/api/buyer-outreach/template") {
        const input = EmailTemplateSchema.parse(await readJsonBody(request));
        const saved = await outreachRepository.saveTemplate(input, { now: now() });
        sendJson(response, 200, { template: saved });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/api/buyer-outreach/summaries") {
        sendJson(response, 200, { summaries: await outreachRepository.listSummaries() });
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/buyer-outreach/send") {
        const result = await handleSend(request);
        sendJson(response, result.status, result.body);
        return true;
      }

      sendError(response, 404, "API_ROUTE_NOT_FOUND", "Outreach API route was not found.");
      return true;
    } catch (error) {
      handleApiError(response, error);
      return true;
    }
  };

  async function handleSend(request) {
    const input = OutreachSendSchema.parse(await readJsonBody(request));
    if (!mailConfigured) {
      return { status: 503, body: error("MAIL_NOT_CONFIGURED", "Configure the Zoho SMTP settings on the server before sending.") };
    }
    const match = await buyerRepository.getBuyerMatch(input.buyerMatchId);
    if (!match) {
      return { status: 404, body: error("BUYER_MATCH_NOT_FOUND", "Buyer candidate was not found.") };
    }
    if (match.reviewStatus !== "APPROVED") {
      return { status: 409, body: error("MATCH_NOT_APPROVED", "Only approved buyers can be emailed.") };
    }
    const contact = match.contacts.find((item) => item.id === input.contactId && item.type === "EMAIL");
    if (!contact) {
      return { status: 409, body: error("RECIPIENT_MISMATCH", "The selected email address is not a stored contact for this buyer.") };
    }
    const sinceIso = new Date(Date.parse(now()) - DAY_MS).toISOString();
    if ((await outreachRepository.countRecentSends(sinceIso)) >= config.maxSendsPerDay) {
      return { status: 429, body: error("DAILY_CAP_REACHED", `The daily outreach limit of ${config.maxSendsPerDay} has been reached.`) };
    }

    const base = {
      id: createId(),
      buyerMatchId: match.id,
      companyId: match.company.id,
      recipientEmail: contact.value,
      subject: input.subject,
      body: input.body,
      sentAt: now(),
    };
    try {
      await mailSender.send({ to: contact.value, subject: input.subject, text: input.body });
      const saved = await outreachRepository.recordSend({ ...base, status: "SENT", errorMessage: null });
      return { status: 201, body: { send: saved } };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown mail error.";
      const saved = await outreachRepository.recordSend({ ...base, status: "FAILED", errorMessage: message.slice(0, 500) });
      return { status: 502, body: { ...error("SEND_FAILED", `Sending failed: ${message.slice(0, 300)}`), send: saved } };
    }
  }
}

function error(code, message) { return { error: { code, message } }; }

function handleApiError(response, err) {
  if (err instanceof z.ZodError) {
    sendError(response, 400, "INVALID_REQUEST", "Request validation failed.", {
      issues: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return;
  }
  if (err instanceof InvalidJsonError) { sendError(response, 400, err.code, err.message); return; }
  if (err instanceof RequestBodyTooLargeError) { sendError(response, 413, err.code, err.message); return; }
  console.error("Outreach API error:", err instanceof Error ? err.message : err);
  sendError(response, 500, "INTERNAL_ERROR", "Outreach encountered an internal error.");
}

async function readJsonBody(request, maximumBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new RequestBodyTooLargeError(maximumBytes);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new InvalidJsonError(); }
}

function sendError(response, status, code, message, details) {
  sendJson(response, status, { error: { code, message, ...(details === undefined ? {} : { details }) } });
}
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
```

- [ ] **Step 5: Mount the handler in serve.mjs**

In `scripts/serve.mjs`, add imports (near the other script imports):

```js
import { createOutreachApiHandler } from "./outreachApi.mjs";
import { DEFAULT_EMAIL_TEMPLATE } from "../dist/domain/outreach/index.js";
import { createSmtpMailSender, readSmtpSettings } from "../dist/infrastructure/email/index.js";
```

Add near where `buyerRepository` is read (the outreach repository comes from `persistence`, wired in Task 4):

```js
const outreachRepository = persistence.outreachRepository;
const smtpSettings = readSmtpSettings(process.env);
const mailSender = smtpSettings ? createSmtpMailSender(smtpSettings) : null;
const maxSendsPerDay = Number(process.env.OUTREACH_MAX_SENDS_PER_DAY ?? 50);
const handleOutreachApiRequest = createOutreachApiHandler({
  outreachRepository,
  buyerRepository,
  mailSender,
  config: {
    defaultTemplate: DEFAULT_EMAIL_TEMPLATE,
    ourCompany: smtpSettings?.ourCompany ?? "",
    fromAddress: smtpSettings?.fromAddress ?? "",
    maxSendsPerDay: Number.isInteger(maxSendsPerDay) && maxSendsPerDay > 0 ? maxSendsPerDay : 50,
    mailConfigured: Boolean(smtpSettings),
  },
  createId: randomUUID,
});
```

Inside `handleApiRequest`, immediately after the buyer-handler block, add:

```js
    if (await handleOutreachApiRequest(request, response, url)) {
      return;
    }
```

So it reads:

```js
  try {
    if (await handleBuyerApiRequest(request, response, url)) {
      return;
    }
    if (await handleOutreachApiRequest(request, response, url)) {
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/costings") {
```

- [ ] **Step 6: Register tests and run the suite**

Register: change end of `package.json` `test` script to `... && node test/outreachRepository.test.mjs && node test/outreachApi.test.mjs"`.
Run: `npm test`
Expected: ALL PASS, including the updated buyer results test asserting `contact.id`.

- [ ] **Step 7: Commit**

```bash
git add scripts/outreachApi.mjs scripts/serve.mjs scripts/buyerApi.mjs test/outreachApi.test.mjs test/buyerApi.test.mjs package.json
git commit -m "feat: add buyer-outreach API handler and wire it into the server"
```

---

## Task 6: Browser outreach client + Email template editor subview

**Files:**
- Create: `src/outreachApi.ts`
- Create: `src/outreachUi.ts`
- Modify: `src/workspaceRoute.ts`
- Modify: `src/app.ts`
- Modify: `index.html`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `authenticatedFetch` (`./auth.js`); `renderEmailTemplate`, `listUnknownPlaceholders`, `DEFAULT_EMAIL_TEMPLATE`, `type EmailTemplate`, `type TemplateValues`, `type OutreachSummary` from `./domain/outreach/emailTemplate.js` (zod-free — required for browser).
- Produces:
  - `fetchOutreachTemplate(): Promise<OutreachTemplateResponse>`, `saveOutreachTemplate(t: EmailTemplate): Promise<void>`, `fetchOutreachSummaries(): Promise<Record<string, OutreachSummary>>` (used by Tasks 6 & 7)
  - `class OutreachUi { show(visible: boolean): void; hide(): void }`

- [ ] **Step 1: Add the outreach subview route**

In `src/workspaceRoute.ts`, change:

```ts
export type ToolSubview = "calculator" | "saved" | "archived" | "outreach";
```

and add an `outreach` path to each tool in `routePaths` (only `buyer` is ever linked in the UI, but the type requires all three):

```ts
  costing: { calculator: "costing/calculator", saved: "costing/saved", archived: "costing/archived", outreach: "costing/outreach" },
  load: { calculator: "load/calculator", saved: "load/saved", archived: "load/archived", outreach: "load/outreach" },
  buyer: { calculator: "buyer/search", saved: "buyer/history", archived: "buyer/saved-buyers", outreach: "buyer/outreach" },
```

- [ ] **Step 2: Write the browser client**

Create `src/outreachApi.ts`:

```ts
import { authenticatedFetch } from "./auth.js";
import type { EmailTemplate, OutreachSummary } from "./domain/outreach/emailTemplate.js";

export type OutreachTemplateResponse = {
  template: EmailTemplate;
  mailConfigured: boolean;
  sender: { fromAddress: string | null; ourCompany: string };
  placeholders: string[];
};

type ErrorBody = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(init?.body ? { body: init.body } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as ErrorBody | null)?.error?.message;
    throw new Error(message ?? `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export function fetchOutreachTemplate(): Promise<OutreachTemplateResponse> {
  return request<OutreachTemplateResponse>("/api/buyer-outreach/template");
}

export function saveOutreachTemplate(template: EmailTemplate): Promise<{ template: EmailTemplate }> {
  return request<{ template: EmailTemplate }>("/api/buyer-outreach/template", {
    method: "PUT",
    body: JSON.stringify(template),
  });
}

export async function fetchOutreachSummaries(): Promise<Record<string, OutreachSummary>> {
  const body = await request<{ summaries: Record<string, OutreachSummary> }>("/api/buyer-outreach/summaries");
  return body.summaries ?? {};
}
```

- [ ] **Step 3: Add markup to index.html**

In the `.workspace-nav` block (currently 3 buttons), append a buyer-only 4th button:

```html
        <button id="show-outreach-view" class="view-button" type="button" hidden>Email</button>
```

After the `buyer-saved-section` block (before `</main>`), add the outreach section:

```html
      <section id="buyer-outreach-section" class="buyer-section" aria-labelledby="buyer-outreach-title" hidden>
        <div class="panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Outreach</p>
              <h2 id="buyer-outreach-title">Email template</h2>
            </div>
            <button id="outreach-save" class="text-button" type="button">Save template</button>
          </div>
          <p id="outreach-config-warning" class="summary-text" hidden></p>
          <label class="outreach-field">
            <span>Subject</span>
            <input id="outreach-subject" type="text" maxlength="500" />
          </label>
          <label class="outreach-field">
            <span>Body</span>
            <textarea id="outreach-body" rows="14" maxlength="20000"></textarea>
          </label>
          <div id="outreach-placeholders" class="placeholder-chips"></div>
          <p id="outreach-unknown" class="summary-text" hidden></p>
          <h3>Preview</h3>
          <pre id="outreach-preview-subject" class="outreach-preview"></pre>
          <pre id="outreach-preview-body" class="outreach-preview"></pre>
          <p id="outreach-status" class="save-status"></p>
          <p id="outreach-error" class="error-message" role="alert"></p>
        </div>
      </section>
```

- [ ] **Step 4: Write the editor subview**

Create `src/outreachUi.ts`:

```ts
import { listUnknownPlaceholders, renderEmailTemplate, type TemplateValues } from "./domain/outreach/emailTemplate.js";
import { fetchOutreachTemplate, saveOutreachTemplate } from "./outreachApi.js";

const SAMPLE: TemplateValues = {
  company: "Acme Foods",
  country: "Thailand",
  city: "Bangkok",
  commodity: "coconut",
  buyerType: "Importer",
  contactName: "Purchasing",
  ourCompany: "Trade Tools",
};

export class OutreachUi {
  private readonly section = mustGetElement("buyer-outreach-section");
  private readonly subject = mustGetElement("outreach-subject") as HTMLInputElement;
  private readonly body = mustGetElement("outreach-body") as HTMLTextAreaElement;
  private ourCompany = "";
  private loaded = false;

  constructor() {
    this.subject.addEventListener("input", () => this.renderPreview());
    this.body.addEventListener("input", () => this.renderPreview());
    mustGetElement("outreach-save").addEventListener("click", () => void this.save());
  }

  show(visible: boolean): void {
    this.section.hidden = !visible;
    if (visible && !this.loaded) void this.load();
  }

  hide(): void {
    this.section.hidden = true;
  }

  private async load(): Promise<void> {
    setText("outreach-error", "");
    try {
      const response = await fetchOutreachTemplate();
      this.ourCompany = response.sender.ourCompany;
      this.subject.value = response.template.subject;
      this.body.value = response.template.body;
      this.loaded = true;
      const warning = mustGetElement("outreach-config-warning");
      warning.hidden = response.mailConfigured;
      warning.textContent = "Outreach is not configured on the server. Set ZOHO_SMTP_USER and ZOHO_SMTP_PASSWORD to enable sending.";
      this.renderChips(response.placeholders);
      this.renderPreview();
    } catch (error) {
      setText("outreach-error", messageOf(error));
    }
  }

  private renderChips(placeholders: string[]): void {
    const container = mustGetElement("outreach-placeholders");
    container.replaceChildren();
    for (const key of placeholders) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "placeholder-chip";
      chip.textContent = `{${key}}`;
      chip.addEventListener("click", () => this.insertToken(`{${key}}`));
      container.appendChild(chip);
    }
  }

  private insertToken(token: string): void {
    const active = document.activeElement === this.body ? this.body : this.subject;
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? start;
    active.value = `${active.value.slice(0, start)}${token}${active.value.slice(end)}`;
    active.focus();
    active.selectionStart = active.selectionEnd = start + token.length;
    this.renderPreview();
  }

  private renderPreview(): void {
    const template = { subject: this.subject.value, body: this.body.value };
    const values: TemplateValues = { ...SAMPLE, ourCompany: this.ourCompany || SAMPLE.ourCompany };
    const rendered = renderEmailTemplate(template, values);
    setText("outreach-preview-subject", rendered.subject);
    setText("outreach-preview-body", rendered.body);
    const unknown = listUnknownPlaceholders(template);
    const note = mustGetElement("outreach-unknown");
    note.hidden = unknown.length === 0;
    note.textContent = unknown.length ? `Unrecognized placeholders (kept as typed): ${unknown.map((k) => `{${k}}`).join(", ")}.` : "";
  }

  private async save(): Promise<void> {
    setText("outreach-error", "");
    setText("outreach-status", "");
    try {
      await saveOutreachTemplate({ subject: this.subject.value, body: this.body.value });
      setText("outreach-status", "Template saved.");
    } catch (error) {
      setText("outreach-error", messageOf(error));
    }
  }
}

function mustGetElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element;
}
function setText(id: string, value: string): void {
  const element = mustGetElement(id);
  element.textContent = value;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
```

Note: `this.subject.value` etc. use `HTMLInputElement`/`HTMLTextAreaElement` which expose `selectionStart`. `document.activeElement === this.body` narrows which field receives the inserted token.

- [ ] **Step 5: Wire into app.ts**

Add near the other UI instances (after `const buyerFinderUi = ...`):

```ts
import { OutreachUi } from "./outreachUi.js";
// ...
const outreachUi = new OutreachUi();
const showOutreachButton = mustGetElement("show-outreach-view");
```

Register the button listener with the others:

```ts
showOutreachButton.addEventListener("click", () => setWorkspace("buyer", "outreach"));
```

In `setWorkspace`, treat `outreach` as a buyer-only subview. Replace the buyer branch:

```ts
  if (tool === "buyer") {
    buyerFinderUi.show(subview);
    outreachUi.show(subview === "outreach");
  } else {
    buyerFinderUi.hide();
    outreachUi.hide();
  }
```

Add the button visibility + active state next to the other toggles:

```ts
  showOutreachButton.hidden = tool !== "buyer";
  showOutreachButton.classList.toggle("is-active", tool === "buyer" && subview === "outreach");
```

In `getPageTitle`, add under the `tool === "buyer"` block:

```ts
    if (subview === "outreach") return "Email Template";
```

- [ ] **Step 6: Add styles**

Append to `src/styles.css`:

```css
.placeholder-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.placeholder-chip { font-family: var(--font-mono, monospace); font-size: 12px; padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; }
.outreach-field { display: block; margin: 12px 0; }
.outreach-field span { display: block; font-weight: 600; margin-bottom: 4px; }
.outreach-field input, .outreach-field textarea { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #cbd5e1; }
.outreach-preview { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; font-family: var(--font-mono, monospace); font-size: 13px; }
```

(Adjust the color tokens to match existing `tokens.css` if they differ; this is cosmetic.)

- [ ] **Step 7: Build + typecheck (no automated browser test exists)**

Run: `npm run build`
Expected: tsc passes with strict settings. Then `npm test` — still green (UI is not unit-tested here).

- [ ] **Step 8: Manual verification (dev server)**

Run: `npm run dev` (with a `.env` containing Supabase + a valid login). Sign in, open Buyer finder, click the **Email** tab.
Expected: template fields load; editing updates the Preview live; clicking a `{token}` chip inserts it at the cursor; Save shows "Template saved."; with no SMTP env the config warning shows.

- [ ] **Step 9: Commit**

```bash
git add src/outreachApi.ts src/outreachUi.ts src/workspaceRoute.ts src/app.ts index.html src/styles.css
git commit -m "feat: add outreach email template editor subview"
```

---

## Task 7: Send panel + Contacted badge on Saved Buyers

**Files:**
- Modify: `src/buyerFinderUi.ts`
- (No new test file — browser send flow verified manually in Task 8.)

**Interfaces:**
- Consumes: `BuyerResult` (has `company.id`, `contacts[].{id,type,value,label}` after Task 5), `renderEmailTemplate`/`type TemplateValues` (`./domain/outreach/emailTemplate.js`), `fetchOutreachTemplate`/`fetchOutreachSummaries`/`OutreachTemplateResponse` (`./outreachApi.js`).
- Produces: user-visible inline send panel + "Contacted" badge per saved buyer card.

- [ ] **Step 1: Import + state**

At the top of `src/buyerFinderUi.ts`, add:

```ts
import { renderEmailTemplate, type OutreachSummary, type TemplateValues } from "./domain/outreach/emailTemplate.js";
import { fetchOutreachSummaries, fetchOutreachTemplate, type OutreachTemplateResponse } from "./outreachApi.js";
```

Add fields on the class (near `private formLocked = false;`):

```ts
  private outreach: OutreachTemplateResponse | undefined;
  private summaries: Record<string, OutreachSummary> = {};
  private activeSendId: string | undefined;
```

- [ ] **Step 2: Fetch outreach data when rendering Saved Buyers**

Replace `renderSavedBuyers()` body with:

```ts
  private async renderSavedBuyers(): Promise<void> {
    const list = getElement("buyer-saved-list");
    list.replaceChildren();
    setText("buyer-saved-error", "");
    try {
      const [searches, outreach, summaries] = await Promise.all([
        apiRequest<SearchListItem[]>("/api/buyer-searches"),
        fetchOutreachTemplate().catch(() => undefined),
        fetchOutreachSummaries().catch(() => ({} as Record<string, OutreachSummary>)),
      ]);
      this.outreach = outreach;
      this.summaries = summaries;
      this.activeSendId = undefined;

      const completed = searches.filter((search) => TERMINAL_STATUSES.has(search.status));
      const responses = await Promise.all(completed.map((search) =>
        apiRequest<ResultsResponse>(`/api/buyer-searches/${encodeURIComponent(search.id)}/results`),
      ));
      const approved = responses.flatMap((response) => response.results).filter((result) => result.reviewStatus === "APPROVED");
      getElement("buyer-saved-empty").hidden = approved.length > 0;
      for (const result of approved) {
        list.appendChild(this.createSavedBuyerCard(result));
      }
    } catch (error) {
      getElement("buyer-saved-empty").hidden = true;
      setText("buyer-saved-error", getErrorMessage(error));
    }
  }
```

- [ ] **Step 3: Replace the card factory with a bound method that adds badge + send**

Delete the module-level `createSavedBuyerCard(result)` function and add this method to the class:

```ts
  private createSavedBuyerCard(result: BuyerResult): HTMLElement {
    const card = createElement("article", "buyer-saved-card");
    card.dataset.buyerMatchId = result.id;

    const heading = createElement("div", "buyer-result-card-top");
    const titleBlock = createElement("div");
    titleBlock.append(createElement("h3", "", result.company.name));
    heading.append(titleBlock, createConfidenceBadge(result.confidence));

    const summary = this.summaries[result.company.id];
    const badge = createElement(
      "span",
      summary && summary.sentCount > 0 ? "contacted-badge is-contacted" : "contacted-badge",
      summary && summary.sentCount > 0 ? `Contacted ${formatDate(summary.lastSentAt ?? "")} (${summary.sentCount})` : "Not contacted",
    );

    card.append(
      heading,
      badge,
      createElement("p", "buyer-result-location", [result.company.city, result.company.countryName].filter(Boolean).join(", ")),
      createElement("p", "buyer-result-role", `${formatBuyerType(result.buyerType)} · ${result.commodity}`),
      createElement("p", "", result.commodityRelationship),
    );

    const links = createElement("div", "buyer-saved-links");
    if (result.company.websiteUrl) links.append(createSafeLink(result.company.websiteUrl, "Website"));
    if (result.sources[0]) links.append(createSafeLink(result.sources[0].url, "Primary evidence"));

    const emailContacts = result.contacts.filter((contact) => contact.type === "EMAIL");
    const sendButton = createElement("button", "text-button buyer-send-button", "Send email");
    sendButton.type = "button";
    if (emailContacts.length === 0) {
      sendButton.disabled = true;
      sendButton.title = "No email contact was found for this company.";
    } else if (!this.outreach?.mailConfigured) {
      sendButton.disabled = true;
      sendButton.title = "Mail is not configured on the server.";
    } else {
      sendButton.addEventListener("click", () => this.openSendPanel(card, result));
    }
    links.append(sendButton);
    card.append(links);
    return card;
  }
```

- [ ] **Step 4: Add the send-panel + submit logic**

Add these methods to the class:

```ts
  private templateValues(result: BuyerResult, contact: BuyerContact | undefined): TemplateValues {
    const ourCompany = this.outreach?.sender.ourCompany ?? "";
    return {
      company: result.company.name,
      country: result.company.countryName,
      commodity: result.commodity,
      buyerType: formatBuyerType(result.buyerType),
      ...(result.company.city ? { city: result.company.city } : {}),
      ...(contact?.label ? { contactName: contact.label } : {}),
      ...(ourCompany ? { ourCompany } : {}),
    };
  }

  private openSendPanel(card: HTMLElement, result: BuyerResult): void {
    this.closeSendPanel();
    const template = this.outreach?.template;
    if (!template) return;

    const emailContacts = result.contacts.filter((contact) => contact.type === "EMAIL");
    const panel = createElement("div", "buyer-send-panel");

    const recipient = document.createElement("select");
    recipient.className = "buyer-send-recipient";
    for (const contact of emailContacts) {
      const option = document.createElement("option");
      option.value = contact.id;
      option.textContent = contact.label ? `${contact.label} — ${contact.value}` : contact.value;
      recipient.appendChild(option);
    }

    const subject = document.createElement("input");
    subject.type = "text";
    subject.className = "buyer-send-subject";
    const body = document.createElement("textarea");
    body.rows = 10;
    body.className = "buyer-send-body";

    const applyTemplate = (): void => {
      const selected = emailContacts.find((contact) => contact.id === recipient.value) ?? emailContacts[0];
      const rendered = renderEmailTemplate(template, this.templateValues(result, selected));
      subject.value = rendered.subject;
      body.value = rendered.body;
    };
    recipient.addEventListener("change", applyTemplate);
    applyTemplate();

    const statusLine = createElement("p", "buyer-send-status");
    const sendButton = createElement("button", "text-button", "Send");
    sendButton.type = "button";
    const cancelButton = createElement("button", "text-button secondary-button", "Cancel");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => this.closeSendPanel());

    const actions = createElement("div", "buyer-send-actions");
    actions.append(sendButton, cancelButton);

    panel.append(
      labelField("To", recipient),
      labelField("Subject", subject),
      labelField("Message", body),
      actions,
      statusLine,
    );

    sendButton.addEventListener("click", () => void this.submitSend(sendButton, statusLine, card, result));
    card.appendChild(panel);
    this.activeSendId = result.id;
  }

  private async submitSend(
    button: HTMLButtonElement,
    statusLine: HTMLElement,
    card: HTMLElement,
    result: BuyerResult,
  ): Promise<void> {
    const recipient = card.querySelector<HTMLSelectElement>(".buyer-send-recipient");
    const subject = card.querySelector<HTMLInputElement>(".buyer-send-subject");
    const body = card.querySelector<HTMLTextAreaElement>(".buyer-send-body");
    if (!recipient || !subject || !body || !recipient.value) return;

    button.disabled = true;
    statusLine.textContent = "Sending…";
    try {
      await apiRequest("/api/buyer-outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerMatchId: result.id, contactId: recipient.value, subject: subject.value, body: body.value }),
      });
      const previous = this.summaries[result.company.id];
      this.summaries[result.company.id] = {
        sentCount: (previous?.sentCount ?? 0) + 1,
        lastSentAt: new Date().toISOString(),
      };
      const badge = card.querySelector<HTMLElement>(".contacted-badge");
      if (badge) {
        badge.textContent = `Contacted ${formatDate(this.summaries[result.company.id].lastSentAt ?? "")} (${this.summaries[result.company.id].sentCount})`;
        badge.classList.add("is-contacted");
      }
      statusLine.textContent = "Sent.";
      this.closeSendPanel();
    } catch (error) {
      statusLine.textContent = getErrorMessage(error);
      button.disabled = false;
    }
  }

  private closeSendPanel(): void {
    this.activeSendId = undefined;
    for (const panel of document.querySelectorAll(".buyer-send-panel")) panel.remove();
  }
```

Add a module-level helper near the other `create*` helpers:

```ts
function labelField(caption: string, control: HTMLElement): HTMLElement {
  const label = createElement("label", "buyer-send-field");
  label.append(createElement("span", "", caption), control);
  return label;
}
```

- [ ] **Step 5: Extend the BuyerContact type**

In `src/buyerFinderUi.ts`, the `BuyerContact` type must include the id now exposed by the API. Change it to:

```ts
type BuyerContact = {
  id: string;
  type: string;
  value: string;
  label?: string;
  isPublicBusinessContact: boolean;
  sourceUrl: string;
};
```

- [ ] **Step 6: Styles + build**

Append to `src/styles.css`:

```css
.buyer-send-panel { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; background: #f8fafc; }
.buyer-send-field { display: block; margin-bottom: 10px; }
.buyer-send-field span { display: block; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
.buyer-send-panel input, .buyer-send-panel select, .buyer-send-panel textarea { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #cbd5e1; }
.buyer-send-actions { display: flex; gap: 8px; }
.buyer-send-status { margin-top: 8px; font-size: 13px; }
.contacted-badge { display: inline-block; font-size: 12px; color: #64748b; margin: 4px 0; }
.contacted-badge.is-contacted { color: #16a34a; font-weight: 600; }
```

Run: `npm run build && npm test`
Expected: build passes; suite still green.

- [ ] **Step 7: Commit**

```bash
git add src/buyerFinderUi.ts src/styles.css
git commit -m "feat: add inline outreach send panel and contacted badge to saved buyers"
```

---

## Task 8: End-to-end verification + docs

**Files:**
- Create: `docs/OUTREACH.md`
- Modify: `.env.example` (if present)
- Verify: full suite + manual flow

- [ ] **Step 1: Full automated gate**

Run: `npm test`
Expected: ALL PASS, including the four new outreach test files.

- [ ] **Step 2: Apply the migration (shared DB — confirm first)**

Confirm with the user, then run `npm run db:migrate`.
Expected: `Applied 20260927000000_add_buyer_outreach.sql`. Idempotent; safe to re-run.

- [ ] **Step 3: Manual end-to-end happy path**

1. Add to `.env`: `ZOHO_SMTP_USER`, `ZOHO_SMTP_PASSWORD` (a Zoho app-specific password from an account with 2FA), `OUTREACH_SENDER_COMPANY`, `OUTREACH_FROM_NAME`. Restart `npm run dev`.
2. Buyer finder → **Email** tab → confirm no config warning. Edit the template, Save.
3. **Saved Buyers** → open an APPROVED company with an email contact → **Send email** → panel prefilled from the template → Send **to your own address** first.
4. Confirm: success message, badge flips to "Contacted …", the email arrives, and a `SENT` row exists in `buyer_outreach_sends`.
5. Un-approve/refresh to confirm "Not contacted" companies have no badge; a company with no email shows a disabled Send with a tooltip.

- [ ] **Step 4: Write operator docs**

Create `docs/OUTREACH.md`:

```markdown
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
```

- [ ] **Step 5: Update `.env.example`**

If `.env.example` exists, append the `ZOHO_SMTP_*` and `OUTREACH_*` keys with blank values. If it does not exist, create it with those keys plus a comment pointing to `docs/OUTREACH.md`.

- [ ] **Step 6: Final gate + commit**

Run: `npm run build && npm test`
Expected: PASS.

```bash
git add docs/OUTREACH.md .env.example
git commit -m "docs: add buyer outreach setup and operator guide"
```

---

## Self-Review Notes

- **Spec coverage:** renderer/placeholders (T1), schemas+caps (T2), SMTP+our_company (T3), template store + send log + daily cap + summaries (T4/T5), one-click send with per-email edit + recipient-from-stored-only (T5/T7), template editor subview + chips + preview (T6), Contacted badge (T7), docs/env (T8), no credential leakage + no innerHTML (T3/T5/T6/T7). Every spec section maps to a task.
- **Type consistency:** `renderEmailTemplate(template, values): EmailTemplate` and `listUnknownPlaceholders` used identically in T1/T6/T7; `OutreachSummary`/`TemplateValues`/`EmailTemplate` all defined in T1 and imported from the zod-free `emailTemplate.js` by every browser file; `recordSend`/`countRecentSends`/`listSummaries`/`getTemplate`/`saveTemplate` signatures match between T4 (repo) and T5 (handler + fakes); `BuyerContact.id` added in T5 (server) and T7 (client type).
- **Zod-in-browser guard:** browser modules import only `./domain/outreach/emailTemplate.js`; the `index.js` barrel and `schemas.js` are server/test-only. This is called out in Global Constraints and every UI task.
- **Placeholders:** none. Every code step contains complete, compilable code.
