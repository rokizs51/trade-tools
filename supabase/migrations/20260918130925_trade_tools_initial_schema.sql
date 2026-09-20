create table if not exists public.costings (
  id text primary key,
  name text not null,
  product text not null,
  quantity_value numeric not null check (quantity_value > 0),
  quantity_unit text not null,
  incoterm text not null check (incoterm in ('FOB', 'CFR', 'CIF')),
  quotation_currency text not null,
  usd_idr numeric,
  pricing_type text not null check (pricing_type in ('MARGIN', 'MARKUP', 'BUYER_OFFER')),
  pricing_value numeric not null,
  status text not null check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  costs_json jsonb not null,
  exchange_rates_json jsonb not null,
  pricing_json jsonb not null,
  result_json jsonb not null
);

create index if not exists costings_status_updated_idx
  on public.costings (status, updated_at desc);

create table if not exists public.load_plans (
  id text primary key,
  name text not null,
  product text not null,
  container_id text not null,
  cartons_loaded integer not null check (cartons_loaded >= 0),
  total_units integer not null check (total_units >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  cargo_input_json jsonb not null,
  result_json jsonb not null,
  comparisons_json jsonb not null
);

create index if not exists load_plans_status_updated_idx
  on public.load_plans (status, updated_at desc);

create table if not exists public.buyer_search_runs (
  id text primary key,
  status text not null check (status in ('QUEUED', 'PLANNING', 'RESEARCHING', 'VERIFYING', 'SAVING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  commodity text not null,
  target_country text not null,
  target_area text,
  requested_limit integer not null check (requested_limit between 1 and 25),
  input_json jsonb not null,
  plan_json jsonb,
  model_config_json jsonb not null,
  outcome_json jsonb,
  current_stage text not null,
  progress_current integer not null default 0 check (progress_current >= 0),
  progress_total integer not null default 0 check (progress_total >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric not null default 0 check (estimated_cost_usd >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null,
  check (progress_current <= progress_total)
);

create table if not exists public.buyer_companies (
  id text primary key,
  name text not null,
  normalized_name text not null,
  website_url text,
  website_domain text,
  country_code text,
  country_name text not null,
  city text,
  address text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.buyer_matches (
  id text primary key,
  search_run_id text not null references public.buyer_search_runs(id) on delete cascade,
  company_id text not null references public.buyer_companies(id) on delete restrict,
  commodity text not null,
  buyer_type text not null check (buyer_type in ('IMPORTER', 'DISTRIBUTOR', 'WHOLESALER', 'PROCESSOR', 'MANUFACTURER', 'RETAILER')),
  commodity_relationship text not null,
  confidence_score integer not null check (confidence_score between 0 and 100),
  confidence_level text not null check (confidence_level in ('HIGH', 'MEDIUM', 'LOW')),
  verification_status text not null check (verification_status in ('VERIFIED', 'NEEDS_REVIEW', 'REJECTED')),
  review_status text not null default 'NEW' check (review_status in ('NEW', 'APPROVED', 'REJECTED')),
  rejection_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  reviewed_at timestamptz
);

create table if not exists public.buyer_sources (
  id text primary key,
  buyer_match_id text not null references public.buyer_matches(id) on delete cascade,
  url text not null,
  normalized_url text not null,
  title text not null,
  publisher text,
  evidence_type text not null check (evidence_type in ('COMPANY_IDENTITY', 'LOCATION', 'COMMODITY', 'BUYER_ROLE', 'CONTACT')),
  excerpt text,
  retrieved_at timestamptz not null,
  unique (buyer_match_id, normalized_url, evidence_type)
);

create table if not exists public.buyer_contacts (
  id text primary key,
  company_id text not null references public.buyer_companies(id) on delete cascade,
  source_id text not null references public.buyer_sources(id) on delete cascade,
  contact_type text not null check (contact_type in ('EMAIL', 'PHONE', 'CONTACT_PAGE')),
  value text not null,
  label text,
  is_public_business_contact boolean not null check (is_public_business_contact),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (company_id, contact_type, value)
);

create index if not exists buyer_search_runs_status_created_idx
  on public.buyer_search_runs (status, created_at desc);
create index if not exists buyer_companies_website_domain_idx
  on public.buyer_companies (website_domain);
create index if not exists buyer_companies_name_country_idx
  on public.buyer_companies (normalized_name, country_code, country_name);
create index if not exists buyer_matches_search_run_idx
  on public.buyer_matches (search_run_id);
create index if not exists buyer_matches_company_commodity_idx
  on public.buyer_matches (company_id, commodity);
create index if not exists buyer_sources_match_idx
  on public.buyer_sources (buyer_match_id);
create index if not exists buyer_contacts_company_idx
  on public.buyer_contacts (company_id);

alter table public.costings enable row level security;
alter table public.load_plans enable row level security;
alter table public.buyer_search_runs enable row level security;
alter table public.buyer_companies enable row level security;
alter table public.buyer_matches enable row level security;
alter table public.buyer_sources enable row level security;
alter table public.buyer_contacts enable row level security;

revoke all on table public.costings from anon, authenticated;
revoke all on table public.load_plans from anon, authenticated;
revoke all on table public.buyer_search_runs from anon, authenticated;
revoke all on table public.buyer_companies from anon, authenticated;
revoke all on table public.buyer_matches from anon, authenticated;
revoke all on table public.buyer_sources from anon, authenticated;
revoke all on table public.buyer_contacts from anon, authenticated;
