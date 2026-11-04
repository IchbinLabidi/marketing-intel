-- 0028: project change log — who created, changed or deleted what in the strategy and the content.
-- One row per change, written by triggers (so every code path is covered, including the AI and imports).
-- Rows outlive what they describe: deleting a content item keeps the "deleted" entry.

create table if not exists project_change_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,       -- null = automatic (scheduled jobs, system)
  area text not null check (area in ('strategy', 'content')),
  entity text not null check (entity in ('strategy', 'brand', 'persona', 'pillar', 'campaign', 'kpi', 'content')),
  entity_id uuid,
  label text not null default '',
  action text not null check (action in ('created', 'updated', 'deleted')),
  fields text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists project_change_log_project_idx on project_change_log (project_id, created_at desc);
create index if not exists project_change_log_entity_idx on project_change_log (entity_id, created_at desc);

alter table project_change_log enable row level security;
drop policy if exists "change log: members read" on project_change_log;
-- Strategy entries follow the strategy.view permission; content entries are visible to every member.
create policy "change log: members read" on project_change_log for select using (
  is_workspace_member(project_workspace(project_id))
  and (area = 'content' or has_permission(project_workspace(project_id), 'strategy.view'))
);
-- No insert/update/delete policies: only the trigger below writes, and the log can't be edited.

create or replace function log_project_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ent text := tg_argv[0];
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  pid uuid := (r->>'project_id')::uuid;
  -- Bookkeeping and synced metrics, not edits anyone made.
  ignored text[] := array['id', 'project_id', 'created_at', 'updated_at', 'updated_by', 'created_by', 'revision', 'position',
    'priority_rank', 'metrics_source', 'metrics_updated_at', 'impressions', 'reach', 'engagements', 'clicks', 'likes', 'comments',
    'shares', 'saves', 'video_views', 'views', 'leads', 'subscriptions', 'conversions'];
  changed text[] := '{}';
begin
  -- A project being deleted takes its log with it; don't write entries for the cascade.
  if tg_op = 'DELETE' and not exists (select 1 from projects where id = pid) then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}') into changed
    from jsonb_object_keys(n) k
    where not (k = any (ignored)) and (n->k) is distinct from (o->k);
    if cardinality(changed) = 0 then return new; end if;
  end if;
  insert into project_change_log (project_id, actor_id, area, entity, entity_id, label, action, fields)
  values (
    pid, auth.uid(),
    case when ent = 'content' then 'content' else 'strategy' end,
    ent,
    case when ent in ('strategy', 'brand') then null else (r->>'id')::uuid end,
    left(coalesce(r->>'title', r->>'name', r->>'brand_name', ''), 200),
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    changed
  );
  return coalesce(new, old);
end $$;

-- The strategy and brand rows are created with the project; only their edits are logged.
drop trigger if exists change_log on strategies;
create trigger change_log after update on strategies for each row execute function log_project_change('strategy');
drop trigger if exists change_log on brand_profiles;
create trigger change_log after update on brand_profiles for each row execute function log_project_change('brand');
drop trigger if exists change_log on personas;
create trigger change_log after insert or update or delete on personas for each row execute function log_project_change('persona');
drop trigger if exists change_log on content_pillars;
create trigger change_log after insert or update or delete on content_pillars for each row execute function log_project_change('pillar');
drop trigger if exists change_log on campaigns;
create trigger change_log after insert or update or delete on campaigns for each row execute function log_project_change('campaign');
drop trigger if exists change_log on kpis;
create trigger change_log after insert or update or delete on kpis for each row execute function log_project_change('kpi');
drop trigger if exists change_log on content_items;
create trigger change_log after insert or update or delete on content_items for each row execute function log_project_change('content');
