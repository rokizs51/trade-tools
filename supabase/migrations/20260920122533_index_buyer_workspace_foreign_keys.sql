create index if not exists buyer_matches_search_workspace_idx
  on public.buyer_matches (search_run_id, workspace_id);
create index if not exists buyer_matches_company_workspace_idx
  on public.buyer_matches (company_id, workspace_id);
create index if not exists buyer_sources_match_workspace_idx
  on public.buyer_sources (buyer_match_id, workspace_id);
create index if not exists buyer_contacts_company_workspace_idx
  on public.buyer_contacts (company_id, workspace_id);
create index if not exists buyer_contacts_source_workspace_idx
  on public.buyer_contacts (source_id, workspace_id);
