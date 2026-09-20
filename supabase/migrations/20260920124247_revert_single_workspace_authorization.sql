alter table public.buyer_contacts drop constraint if exists buyer_contacts_source_workspace_fkey;
alter table public.buyer_contacts drop constraint if exists buyer_contacts_company_workspace_fkey;
alter table public.buyer_sources drop constraint if exists buyer_sources_match_workspace_fkey;
alter table public.buyer_matches drop constraint if exists buyer_matches_company_workspace_fkey;
alter table public.buyer_matches drop constraint if exists buyer_matches_search_workspace_fkey;

alter table public.buyer_contacts drop constraint if exists buyer_contacts_workspace_id_fkey;
alter table public.buyer_sources drop constraint if exists buyer_sources_workspace_id_fkey;
alter table public.buyer_matches drop constraint if exists buyer_matches_workspace_id_fkey;
alter table public.buyer_companies drop constraint if exists buyer_companies_workspace_id_fkey;
alter table public.buyer_search_runs drop constraint if exists buyer_search_runs_workspace_id_fkey;
alter table public.buyer_search_runs drop constraint if exists buyer_search_runs_created_by_fkey;
alter table public.load_plans drop constraint if exists load_plans_workspace_id_fkey;
alter table public.load_plans drop constraint if exists load_plans_created_by_fkey;
alter table public.costings drop constraint if exists costings_workspace_id_fkey;
alter table public.costings drop constraint if exists costings_created_by_fkey;

alter table public.buyer_contacts drop column if exists workspace_id;
alter table public.buyer_sources drop column if exists workspace_id;
alter table public.buyer_matches drop column if exists workspace_id;
alter table public.buyer_companies drop column if exists workspace_id;
alter table public.buyer_search_runs drop column if exists created_by;
alter table public.buyer_search_runs drop column if exists workspace_id;
alter table public.load_plans drop column if exists created_by;
alter table public.load_plans drop column if exists workspace_id;
alter table public.costings drop column if exists created_by;
alter table public.costings drop column if exists workspace_id;

drop table if exists public.workspace_members;
drop table if exists public.workspaces;
