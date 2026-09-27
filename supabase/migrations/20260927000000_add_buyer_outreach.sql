create table if not exists public.email_templates (
  id text primary key,
  subject text not null,
  body text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.buyer_outreach_sends (
  id text primary key,
  -- Not foreign keys, on purpose: a cascade FK would erase this audit row when the
  -- originating search run is deleted, and a RESTRICT FK would block deleting a run
  -- that has ever emailed. The send log is the durable audit trail, so it survives
  -- run deletion; the ids are kept as plain references for grouping and triage.
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
