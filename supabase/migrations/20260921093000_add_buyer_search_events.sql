create table if not exists public.buyer_search_events (
  id text primary key,
  search_run_id text not null references public.buyer_search_runs(id) on delete cascade,
  level text not null check (level in ('INFO', 'WARN', 'ERROR')),
  event_type text not null,
  message text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists buyer_search_events_run_created_idx
  on public.buyer_search_events (search_run_id, created_at asc, id asc);

alter table public.buyer_search_events enable row level security;
revoke all on table public.buyer_search_events from anon, authenticated;
