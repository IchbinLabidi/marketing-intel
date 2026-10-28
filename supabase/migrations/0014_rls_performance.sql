-- Performance for the least-privilege policies of 0013: evaluate permissions once per query (hashed subplan)
-- instead of once per row. Same rules, same results; only the policy expressions change.
begin;

create or replace function permitted_projects(perm text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from projects p
  join workspace_members m on m.workspace_id = p.workspace_id and m.user_id = auth.uid()
  where has_permission(p.workspace_id, perm);
$$;

create or replace function my_content_items() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from content_items c where c.assignee_id = auth.uid() or c.created_by = auth.uid()
  union
  select a.content_item_id from content_assignments a where a.user_id = auth.uid();
$$;

drop policy "content: visibility" on content_items;
create policy "content: visibility" on content_items as restrictive for select
  using (project_id in (select permitted_projects('content.view_all')) or id in (select my_content_items()));
drop policy "activity: visibility" on content_activity;
create policy "activity: visibility" on content_activity as restrictive for select
  using (project_id in (select permitted_projects('content.view_all')) or content_item_id in (select my_content_items()));
drop policy "versions: visibility" on content_versions;
create policy "versions: visibility" on content_versions as restrictive for select
  using (project_id in (select permitted_projects('content.view_all')) or content_item_id in (select my_content_items()));
drop policy "assets: visibility" on content_assets;
create policy "assets: visibility" on content_assets as restrictive for select
  using (project_id in (select permitted_projects('content.view_all')) or content_item_id in (select my_content_items()));
drop policy "assignments: visible with content" on content_assignments;
create policy "assignments: visible with content" on content_assignments for select
  using (project_id in (select permitted_projects('content.view_all')) or content_item_id in (select my_content_items()));

do $$
declare t text; m text;
begin
  foreach t in array array[
    'brand_profiles:strategy','project_channels:strategy','strategies:strategy','personas:strategy','content_pillars:strategy','campaigns:strategy','kpis:strategy',
    'import_jobs:intelligence','historical_content_items:intelligence','analysis_reports:intelligence','competitors:intelligence',
    'competitor_content_items:intelligence','competitor_metric_snapshots:intelligence','competitor_sync_runs:intelligence',
    'meta_connections:intelligence','meta_sync_runs:intelligence',
    'serp_analyses:seo','serp_items:seo','seo_briefs:seo',
    'opportunities:opportunities','opportunity_feedback:opportunities',
    'editorial_calendars:calendar'
  ] loop
    m := split_part(t, ':', 2); t := split_part(t, ':', 1);
    continue when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'project_id');
    execute format('drop policy if exists %I on %I', t || ': ' || m || ' view', t);
    execute format('drop policy if exists %I on %I', t || ': ' || m || ' insert', t);
    execute format('drop policy if exists %I on %I', t || ': ' || m || ' update', t);
    execute format('drop policy if exists %I on %I', t || ': ' || m || ' delete', t);
    execute format($p$create policy "%1$s: %2$s view" on %1$I as restrictive for select using (project_id in (select permitted_projects('%2$s.view')))$p$, t, m);
    execute format($p$create policy "%1$s: %2$s insert" on %1$I as restrictive for insert with check (project_id in (select permitted_projects('%2$s.edit')))$p$, t, m);
    execute format($p$create policy "%1$s: %2$s update" on %1$I as restrictive for update using (project_id in (select permitted_projects('%2$s.edit')))$p$, t, m);
    execute format($p$create policy "%1$s: %2$s delete" on %1$I as restrictive for delete using (project_id in (select permitted_projects('%2$s.edit')))$p$, t, m);
  end loop;
end $$;

drop policy "competitor_channels: intelligence view" on competitor_channels;
create policy "competitor_channels: intelligence view" on competitor_channels as restrictive for select
  using (competitor_id in (select c.id from competitors c where c.project_id in (select permitted_projects('intelligence.view'))));
drop policy "competitor_channels: intelligence write" on competitor_channels;
create policy "competitor_channels: intelligence write" on competitor_channels as restrictive for all
  using (competitor_id in (select c.id from competitors c where c.project_id in (select permitted_projects('intelligence.edit'))))
  with check (competitor_id in (select c.id from competitors c where c.project_id in (select permitted_projects('intelligence.edit'))));

commit;
