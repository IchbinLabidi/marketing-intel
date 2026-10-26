-- Marketing Intelligence Platform — initial schema
-- Tenancy: workspaces -> projects -> everything else. Authorization is enforced by RLS.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type workspace_role as enum ('owner', 'admin', 'editor', 'viewer');
create type content_language as enum ('fr', 'en', 'ar', 'ar_tn');
create type social_platform as enum (
  'instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'x', 'pinterest', 'snapchat', 'threads', 'blog', 'newsletter', 'other'
);
create type funnel_stage as enum ('awareness', 'engagement', 'trust', 'acquisition', 'conversion', 'loyalty');
create type content_status as enum (
  'idea', 'planned', 'brief_ready', 'in_production', 'in_review', 'approved', 'scheduled', 'published'
);
create type insight_type as enum ('data_supported', 'hypothesis', 'experiment');
create type import_status as enum ('uploaded', 'extracted', 'mapped', 'validated', 'imported', 'failed');
create type data_source as enum ('manual', 'csv', 'xlsx', 'pdf', 'meta_api', 'youtube_api', 'linkedin_api', 'tiktok_api');
create type report_kind as enum ('historical', 'competitor', 'comparison');
create type ai_run_status as enum ('running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------------
-- Utility
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Identity & tenancy
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role workspace_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

-- Helper functions (security definer so policies don't recurse through RLS)
create or replace function is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function has_workspace_role(ws uuid, roles workspace_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members where workspace_id = ws and user_id = auth.uid() and role = any(roles)
  );
$$;

-- New user => profile + personal workspace (owner)
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  insert into workspaces (name, created_by)
    values (coalesce(nullif(new.raw_user_meta_data->>'workspace_name', ''), 'My workspace'), new.id)
    returning id into ws_id;  -- owner membership is added by on_workspace_created
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Creator of a workspace created from the app becomes its owner
create or replace function add_workspace_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner') on conflict do nothing;
  return new;
end $$;

create trigger on_workspace_created after insert on workspaces
  for each row execute function add_workspace_owner();

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  industry text,
  website text,
  default_language content_language not null default 'fr',
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projects (workspace_id);

create or replace function project_workspace(p uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from projects where id = p;
$$;

create table brand_profiles (
  project_id uuid primary key references projects(id) on delete cascade,
  brand_name text,
  mission text,
  vision text,
  values text[] not null default '{}',
  personality text,
  visual_identity text,          -- colours, typography, imagery style (free text in MVP)
  target_audience text,
  products_services jsonb not null default '[]',  -- [{name, description, price_range, priority}]
  differentiators text,
  updated_at timestamptz not null default now()
);

create table project_channels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  platform social_platform not null,
  handle text,
  url text,
  is_active boolean not null default true,
  target_posts_per_week numeric(5,2),
  created_at timestamptz not null default now(),
  unique (project_id, platform, handle)
);

-- ---------------------------------------------------------------------------
-- Marketing strategy
-- ---------------------------------------------------------------------------
create table strategies (
  project_id uuid primary key references projects(id) on delete cascade,
  business_objectives text,
  marketing_objectives text,
  brand_positioning text,
  value_proposition text,
  brand_voice jsonb not null default '{}',        -- {tone[], do[], dont[], vocabulary[], examples}
  customer_journey jsonb not null default '[]',   -- [{stage, goal, touchpoints, content_needs}]
  funnel jsonb not null default '{}',             -- {awareness: "...", engagement: "...", ...} target share / notes
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table personas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text,
  demographics text,
  goals text,
  pain_points text,
  objections text,
  preferred_platforms social_platform[] not null default '{}',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on personas (project_id);

create table content_pillars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text,
  target_share numeric(5,2) check (target_share is null or (target_share >= 0 and target_share <= 100)),
  color text,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on content_pillars (project_id);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  objective text,
  description text,
  starts_on date,
  ends_on date,
  funnel_focus funnel_stage,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index on campaigns (project_id);

create table kpis (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  target_value text,
  unit text,
  period text,
  funnel_stage funnel_stage,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kpis (project_id);

-- ---------------------------------------------------------------------------
-- Historical editorial calendars
-- ---------------------------------------------------------------------------
create table import_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_name text not null,
  file_type data_source not null check (file_type in ('csv', 'xlsx', 'pdf')),
  storage_path text,
  status import_status not null default 'uploaded',
  label text,                                     -- e.g. "Calendar 2025"
  reference_year int,
  raw_columns text[] not null default '{}',
  raw_rows jsonb not null default '[]',           -- extracted rows before mapping
  column_mapping jsonb not null default '{}',     -- {target_field: source_column}
  validation_errors jsonb not null default '[]',  -- [{row, field, message}]
  imported_count int not null default 0,
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on import_jobs (project_id);

create table historical_content_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  import_job_id uuid references import_jobs(id) on delete cascade,
  publication_date date,
  platform social_platform,
  platform_raw text,
  title text,
  topic text,
  content_pillar text,
  format text,
  marketing_objective text,
  caption text,
  campaign text,
  product text,
  publication_status text,          -- as written in the source file; NEVER inferred
  -- Performance data only if the source file actually contains it
  impressions bigint,
  reach bigint,
  engagements bigint,
  clicks bigint,
  extra jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on historical_content_items (project_id, publication_date);

-- ---------------------------------------------------------------------------
-- Competitors
-- ---------------------------------------------------------------------------
create table competitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on competitors (project_id);

create table competitor_channels (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  platform social_platform not null,
  handle text,
  url text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table competitor_content_items (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source data_source not null default 'manual',
  external_id text,
  published_at timestamptz,
  platform social_platform,
  url text,
  format text,
  title text,
  caption text,
  hook text,
  topic text,
  -- Only filled when the source provides real numbers
  likes bigint,
  comments bigint,
  shares bigint,
  views bigint,
  created_at timestamptz not null default now(),
  unique (competitor_id, source, external_id)
);
create index on competitor_content_items (project_id);

-- ---------------------------------------------------------------------------
-- AI outputs
-- ---------------------------------------------------------------------------
create table analysis_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind report_kind not null,
  title text not null,
  scope jsonb not null default '{}',     -- {import_job_ids:[], competitor_ids:[], years:[]}
  result jsonb not null,                 -- validated structured output
  model text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on analysis_reports (project_id, kind);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  idea text not null,
  rationale text not null,
  target_audience text,
  persona_id uuid references personas(id) on delete set null,
  marketing_objective text,
  pillar_id uuid references content_pillars(id) on delete set null,
  funnel_stage funnel_stage,
  platform social_platform,
  format text,
  hook text,
  creative_angle text,
  cta text,
  evidence jsonb not null default '[]',  -- [{type: strategy|historical|competitor, ref_id, note}]
  insight_type insight_type not null,
  opportunity_score int check (opportunity_score between 0 and 100),
  confidence text check (confidence in ('low', 'medium', 'high')),
  state text not null default 'new' check (state in ('new', 'saved', 'dismissed', 'scheduled')),
  created_at timestamptz not null default now()
);
create index on opportunities (project_id, state);

-- ---------------------------------------------------------------------------
-- Editorial calendar & production
-- ---------------------------------------------------------------------------
create table editorial_calendars (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  settings jsonb not null default '{}',   -- generation inputs: frequency, platforms, capacity…
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index on editorial_calendars (project_id);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  calendar_id uuid references editorial_calendars(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  scheduled_date date,
  scheduled_time time,
  platform social_platform,
  title text not null,
  format text,
  pillar_id uuid references content_pillars(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  marketing_objective text,
  funnel_stage funnel_stage,
  hook text,
  caption text,
  cta text,
  creative_brief text,
  hashtags text[] not null default '{}',
  language content_language,
  status content_status not null default 'idea',
  assignee_id uuid references auth.users(id) on delete set null,
  due_date date,
  position int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on content_items (project_id, scheduled_date);
create index on content_items (assignee_id);

create table content_assets (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in (
    'caption', 'reel_script', 'carousel', 'story_sequence', 'creative_brief', 'visual_direction', 'cta_variations', 'hashtags'
  )),
  language content_language not null,
  body jsonb not null,
  is_selected boolean not null default false,
  model text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on content_assets (content_item_id);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  feature text not null,
  model text not null,
  status ai_run_status not null default 'running',
  input_tokens int,
  output_tokens int,
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on ai_runs (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','workspaces','projects','brand_profiles','strategies','personas','content_pillars',
    'campaigns','kpis','import_jobs','competitors','editorial_calendars','content_items'
  ] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;

create policy "profiles: read co-members" on profiles for select using (
  id = auth.uid() or exists (
    select 1 from workspace_members a join workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  )
);
create policy "profiles: update self" on profiles for update using (id = auth.uid());

create policy "workspaces: members read" on workspaces for select using (is_workspace_member(id) or created_by = auth.uid());
create policy "workspaces: any user creates" on workspaces for insert with check (created_by = auth.uid());
create policy "workspaces: admins update" on workspaces for update using (has_workspace_role(id, array['owner','admin']::workspace_role[]));
create policy "workspaces: owner deletes" on workspaces for delete using (has_workspace_role(id, array['owner']::workspace_role[]));

create policy "members: members read" on workspace_members for select using (is_workspace_member(workspace_id));
create policy "members: admins manage" on workspace_members for all
  using (has_workspace_role(workspace_id, array['owner','admin']::workspace_role[]))
  with check (has_workspace_role(workspace_id, array['owner','admin']::workspace_role[]));

alter table projects enable row level security;
create policy "projects: members read" on projects for select using (is_workspace_member(workspace_id));
create policy "projects: editors create" on projects for insert
  with check (has_workspace_role(workspace_id, array['owner','admin','editor']::workspace_role[]));
create policy "projects: editors update" on projects for update
  using (has_workspace_role(workspace_id, array['owner','admin','editor']::workspace_role[]));
create policy "projects: admins delete" on projects for delete
  using (has_workspace_role(workspace_id, array['owner','admin']::workspace_role[]));

-- Generic project-scoped policies: viewers read, editors write.
do $$
declare t text;
begin
  foreach t in array array[
    'brand_profiles','project_channels','strategies','personas','content_pillars','campaigns','kpis',
    'import_jobs','historical_content_items','competitors','competitor_content_items','analysis_reports',
    'opportunities','editorial_calendars','content_items','content_assets'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "%1$s: members read" on %1$I for select using (is_workspace_member(project_workspace(project_id)))$p$, t);
    execute format($p$create policy "%1$s: editors write" on %1$I for all
      using (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))
      with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))$p$, t);
  end loop;
end $$;

alter table competitor_channels enable row level security;
create policy "competitor_channels: members read" on competitor_channels for select using (
  exists (select 1 from competitors c where c.id = competitor_id and is_workspace_member(project_workspace(c.project_id)))
);
create policy "competitor_channels: editors write" on competitor_channels for all using (
  exists (select 1 from competitors c where c.id = competitor_id
          and has_workspace_role(project_workspace(c.project_id), array['owner','admin','editor']::workspace_role[]))
) with check (
  exists (select 1 from competitors c where c.id = competitor_id
          and has_workspace_role(project_workspace(c.project_id), array['owner','admin','editor']::workspace_role[]))
);

alter table ai_runs enable row level security;
create policy "ai_runs: members read" on ai_runs for select using (is_workspace_member(workspace_id));
create policy "ai_runs: editors insert" on ai_runs for insert
  with check (has_workspace_role(workspace_id, array['owner','admin','editor']::workspace_role[]));
create policy "ai_runs: editors update" on ai_runs for update
  using (has_workspace_role(workspace_id, array['owner','admin','editor']::workspace_role[]));

-- ---------------------------------------------------------------------------
-- Storage: private bucket for imported files, path = <project_id>/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('imports', 'imports', false) on conflict do nothing;

create policy "imports: members read" on storage.objects for select using (
  bucket_id = 'imports' and is_workspace_member(project_workspace(((storage.foldername(name))[1])::uuid))
);
create policy "imports: editors upload" on storage.objects for insert with check (
  bucket_id = 'imports' and has_workspace_role(project_workspace(((storage.foldername(name))[1])::uuid), array['owner','admin','editor']::workspace_role[])
);
create policy "imports: editors delete" on storage.objects for delete using (
  bucket_id = 'imports' and has_workspace_role(project_workspace(((storage.foldername(name))[1])::uuid), array['owner','admin','editor']::workspace_role[])
);
