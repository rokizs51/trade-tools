create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('ADMIN', 'USER')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  unique (user_id)
);

insert into public.workspaces (slug, name)
values ('default', 'Trade Tools')
on conflict (slug) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, u.id, 'USER'
from public.workspaces w
cross join auth.users u
where w.slug = 'default'
on conflict (user_id) do nothing;

update public.workspace_members
set role = 'ADMIN', updated_at = now()
where user_id = (select id from auth.users order by created_at, id limit 1);

alter table public.costings add column if not exists workspace_id uuid;
alter table public.costings add column if not exists created_by uuid;
alter table public.load_plans add column if not exists workspace_id uuid;
alter table public.load_plans add column if not exists created_by uuid;
alter table public.buyer_search_runs add column if not exists workspace_id uuid;
alter table public.buyer_search_runs add column if not exists created_by uuid;
alter table public.buyer_companies add column if not exists workspace_id uuid;
alter table public.buyer_matches add column if not exists workspace_id uuid;
alter table public.buyer_sources add column if not exists workspace_id uuid;
alter table public.buyer_contacts add column if not exists workspace_id uuid;

update public.costings set workspace_id = (select id from public.workspaces where slug = 'default') where workspace_id is null;
update public.load_plans set workspace_id = (select id from public.workspaces where slug = 'default') where workspace_id is null;
update public.buyer_search_runs set workspace_id = (select id from public.workspaces where slug = 'default') where workspace_id is null;
update public.buyer_companies set workspace_id = (select id from public.workspaces where slug = 'default') where workspace_id is null;
update public.buyer_matches m set workspace_id = r.workspace_id from public.buyer_search_runs r where m.search_run_id = r.id and m.workspace_id is null;
update public.buyer_sources s set workspace_id = m.workspace_id from public.buyer_matches m where s.buyer_match_id = m.id and s.workspace_id is null;
update public.buyer_contacts c set workspace_id = s.workspace_id
from public.buyer_sources s
where c.source_id = s.id and c.workspace_id is null;
update public.buyer_contacts c set workspace_id = company.workspace_id
from public.buyer_companies company
where c.company_id = company.id and c.workspace_id is null;

update public.costings set created_by = (select user_id from public.workspace_members order by (role = 'ADMIN') desc, created_at limit 1) where created_by is null;
update public.load_plans set created_by = (select user_id from public.workspace_members order by (role = 'ADMIN') desc, created_at limit 1) where created_by is null;
update public.buyer_search_runs set created_by = (select user_id from public.workspace_members order by (role = 'ADMIN') desc, created_at limit 1) where created_by is null;

alter table public.costings alter column workspace_id set not null;
alter table public.load_plans alter column workspace_id set not null;
alter table public.buyer_search_runs alter column workspace_id set not null;
alter table public.buyer_companies alter column workspace_id set not null;
alter table public.buyer_matches alter column workspace_id set not null;
alter table public.buyer_sources alter column workspace_id set not null;
alter table public.buyer_contacts alter column workspace_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'costings_workspace_id_fkey') then
    alter table public.costings add constraint costings_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
    alter table public.costings add constraint costings_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
    alter table public.load_plans add constraint load_plans_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
    alter table public.load_plans add constraint load_plans_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
    alter table public.buyer_search_runs add constraint buyer_search_runs_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
    alter table public.buyer_search_runs add constraint buyer_search_runs_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
    alter table public.buyer_companies add constraint buyer_companies_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
    alter table public.buyer_matches add constraint buyer_matches_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
    alter table public.buyer_sources add constraint buyer_sources_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
    alter table public.buyer_contacts add constraint buyer_contacts_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
  end if;
end $$;

create index if not exists workspace_members_user_active_idx on public.workspace_members (user_id) where is_active;
create index if not exists costings_workspace_status_updated_idx on public.costings (workspace_id, status, updated_at desc);
create index if not exists load_plans_workspace_status_updated_idx on public.load_plans (workspace_id, status, updated_at desc);
create index if not exists buyer_search_runs_workspace_status_created_idx on public.buyer_search_runs (workspace_id, status, created_at desc);
create index if not exists buyer_companies_workspace_domain_idx on public.buyer_companies (workspace_id, website_domain);
create index if not exists buyer_companies_workspace_name_country_idx on public.buyer_companies (workspace_id, normalized_name, country_code, country_name);
create index if not exists buyer_matches_workspace_search_idx on public.buyer_matches (workspace_id, search_run_id);
create index if not exists buyer_sources_workspace_match_idx on public.buyer_sources (workspace_id, buyer_match_id);
create index if not exists buyer_contacts_workspace_company_idx on public.buyer_contacts (workspace_id, company_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
