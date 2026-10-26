-- Phase 6 — Competitor Intelligence. Extends the competitor tables created in 0001 (kept, no data removed).
-- Competitor analyses and gap analyses are stored in analysis_reports (kind competitor / comparison); ideas become
-- rows of the existing opportunities table (source competitor_analysis).

alter type data_source add value if not exists 'x_api';
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Competitors: profile and monitoring settings
-- ---------------------------------------------------------------------------
alter table competitors
  add column description text check (description is null or length(description) <= 2000),
  add column industry text check (industry is null or length(industry) <= 200),
  add column target_audience text check (target_audience is null or length(target_audience) <= 2000),
  add column monitoring text not null default 'weekly' check (monitoring in ('manual', 'daily', 'weekly')),
  add column history_days integer not null default 90 check (history_days between 7 and 730),
  add column max_posts integer not null default 200 check (max_posts between 10 and 1000),
  add column last_synced_at timestamptz,
  add column sync_status text not null default 'never'
    check (sync_status in ('never', 'synchronizing', 'synchronized', 'partial', 'failed', 'needs_config'));
create unique index competitors_project_name on competitors (project_id, lower(name));

-- ---------------------------------------------------------------------------
-- Social profiles (one row per platform account) with collection status and coverage
-- ---------------------------------------------------------------------------
alter table competitor_channels
  add column project_id uuid references projects(id) on delete cascade,
  add column enabled boolean not null default true,
  add column external_id text,
  add column display_name text,
  add column bio text,
  add column followers_count bigint,
  add column media_count bigint,
  add column profile_image_url text,
  add column website text,
  add column status text not null default 'pending'
    check (status in ('pending', 'synchronizing', 'synchronized', 'partial', 'failed', 'needs_config', 'unsupported')),
  add column last_error text,
  add column last_attempt_at timestamptz,
  add column coverage_from timestamptz,
  add column coverage_to timestamptz,
  add column posts_collected integer not null default 0,
  add column updated_at timestamptz not null default now();
update competitor_channels ch set project_id = c.project_id from competitors c where c.id = ch.competitor_id;
alter table competitor_channels alter column project_id set not null;
create unique index competitor_channels_profile on competitor_channels (project_id, platform, lower(handle)) where handle is not null;
create index on competitor_channels (competitor_id);
create trigger set_updated_at before update on competitor_channels for each row execute function set_updated_at();

-- project_id always comes from the competitor; it can never point at another project
create or replace function competitor_channel_project() returns trigger language plpgsql as $$
begin
  select project_id into new.project_id from competitors where id = new.competitor_id;
  if new.project_id is null then raise exception 'Competitor not found'; end if;
  return new;
end $$;
create trigger competitor_channel_project before insert or update of competitor_id, project_id on competitor_channels
  for each row execute function competitor_channel_project();

-- ---------------------------------------------------------------------------
-- Collected posts: media, hashtags, mentions, raw metrics as returned, audience size at collection
-- ---------------------------------------------------------------------------
alter table competitor_content_items
  add column channel_id uuid references competitor_channels(id) on delete cascade,
  add column media_type text,
  add column media_url text,
  add column thumbnail_url text,
  add column hashtags text[] not null default '{}',
  add column mentions text[] not null default '{}',
  add column duration_seconds integer,
  add column saves bigint,
  add column metrics_raw jsonb not null default '{}',
  add column followers_at_collection bigint,
  add column metrics_updated_at timestamptz;
create index on competitor_content_items (project_id, published_at desc);
create index on competitor_content_items (competitor_id, published_at desc);
create index on competitor_content_items (channel_id);
create index competitor_content_caption_trgm on competitor_content_items using gin (caption gin_trgm_ops);

create or replace function competitor_content_project() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from competitors where id = new.competitor_id and project_id = new.project_id) then
    raise exception 'Competitor belongs to another project';
  end if;
  if new.channel_id is not null and not exists (select 1 from competitor_channels where id = new.channel_id and competitor_id = new.competitor_id) then
    raise exception 'Profile belongs to another competitor';
  end if;
  return new;
end $$;
create trigger competitor_content_project before insert or update of competitor_id, project_id, channel_id on competitor_content_items
  for each row execute function competitor_content_project();

-- ---------------------------------------------------------------------------
-- Metric snapshots: every collection appends one row per profile and per post, so history is never overwritten
-- ---------------------------------------------------------------------------
create table competitor_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  channel_id uuid not null references competitor_channels(id) on delete cascade,
  content_item_id uuid references competitor_content_items(id) on delete cascade,
  collected_at timestamptz not null default now(),
  followers bigint,
  media_count bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  views bigint,
  saves bigint
);
create index on competitor_metric_snapshots (content_item_id, collected_at desc);
create index on competitor_metric_snapshots (channel_id, collected_at desc) where content_item_id is null;

-- ---------------------------------------------------------------------------
-- Collection runs (manual and scheduled), one running run per competitor
-- ---------------------------------------------------------------------------
create table competitor_sync_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled', 'initial')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}',
  log jsonb not null default '[]',
  error text,
  started_by uuid references auth.users(id) on delete set null
);
create unique index competitor_sync_runs_one_running on competitor_sync_runs (competitor_id) where status = 'running';
create index on competitor_sync_runs (competitor_id, started_at desc);

do $$
declare t text;
begin
  foreach t in array array['competitor_metric_snapshots', 'competitor_sync_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "%1$s: members read" on %1$I for select using (is_workspace_member(project_workspace(project_id)))$p$, t);
    execute format($p$create policy "%1$s: editors write" on %1$I for all
      using (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))
      with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))$p$, t);
  end loop;
end $$;
