create unique index if not exists buyer_search_runs_id_workspace_uidx
  on public.buyer_search_runs (id, workspace_id);
create unique index if not exists buyer_companies_id_workspace_uidx
  on public.buyer_companies (id, workspace_id);
create unique index if not exists buyer_matches_id_workspace_uidx
  on public.buyer_matches (id, workspace_id);
create unique index if not exists buyer_sources_id_workspace_uidx
  on public.buyer_sources (id, workspace_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'buyer_matches_search_workspace_fkey') then
    alter table public.buyer_matches
      add constraint buyer_matches_search_workspace_fkey
      foreign key (search_run_id, workspace_id)
      references public.buyer_search_runs(id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'buyer_matches_company_workspace_fkey') then
    alter table public.buyer_matches
      add constraint buyer_matches_company_workspace_fkey
      foreign key (company_id, workspace_id)
      references public.buyer_companies(id, workspace_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'buyer_sources_match_workspace_fkey') then
    alter table public.buyer_sources
      add constraint buyer_sources_match_workspace_fkey
      foreign key (buyer_match_id, workspace_id)
      references public.buyer_matches(id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'buyer_contacts_company_workspace_fkey') then
    alter table public.buyer_contacts
      add constraint buyer_contacts_company_workspace_fkey
      foreign key (company_id, workspace_id)
      references public.buyer_companies(id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'buyer_contacts_source_workspace_fkey') then
    alter table public.buyer_contacts
      add constraint buyer_contacts_source_workspace_fkey
      foreign key (source_id, workspace_id)
      references public.buyer_sources(id, workspace_id) on delete cascade;
  end if;
end $$;
