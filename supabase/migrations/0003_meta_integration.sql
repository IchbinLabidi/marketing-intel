-- Meta (Facebook Pages + Instagram professional accounts) integration for Historical Intelligence.
-- Synced posts are stored in historical_content_items next to file imports (one analysis pipeline),
-- identified by (project_id, source, external_id) so re-syncs never duplicate rows.

-- ---------------------------------------------------------------------------
-- One Meta connection per project (a Page + its linked Instagram account)
-- ---------------------------------------------------------------------------
create table meta_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  connected_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending_page'
    check (status in ('pending_page', 'active', 'expired', 'error', 'disconnected')),
  fb_user_id text,
  fb_user_name text,
  page_id text,
  page_name text,
  ig_user_id text,
  ig_username text,
  granted_scopes text[] not null default '{}',
  declined_scopes text[] not null default '{}',
  token_expires_at timestamptz,          -- long-lived user token expiry (Page tokens derived from it don't expire)
  supported_metrics jsonb not null default '{}',  -- metrics the API accepted / rejected for this account, learned during sync
  backfill jsonb not null default '{}',  -- {facebook: 'done'|'pending', instagram: …}: whether the full history has been listed
  auto_sync boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on meta_connections for each row execute function set_updated_at();

-- Tokens live apart from the connection row: RLS is enabled with NO policies, so neither the browser nor a
-- workspace member can select them through the API. Access goes through the security-definer functions below,
-- which check the caller's role. Values are additionally AES-256-GCM encrypted by the app server.
create table meta_tokens (
  connection_id uuid primary key references meta_connections(id) on delete cascade,
  user_token_enc text,
  page_token_enc text,
  updated_at timestamptz not null default now()
);
alter table meta_tokens enable row level security;

create table meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  connection_id uuid references meta_connections(id) on delete cascade,
  kind text not null check (kind in ('initial', 'incremental', 'refresh')),
  trigger text not null default 'manual' check (trigger in ('manual', 'auto', 'scheduled')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  stats jsonb not null default '{}',     -- {facebook: {fetched, created, updated}, instagram: {...}, api_calls}
  errors jsonb not null default '[]',    -- [{platform, code, message}]
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on meta_sync_runs (project_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Synced posts reuse historical_content_items
-- ---------------------------------------------------------------------------
alter table historical_content_items
  add column source data_source not null default 'manual',
  add column external_id text,
  add column permalink text,
  add column media_type text,              -- as returned by the API (IMAGE, VIDEO, CAROUSEL_ALBUM, photo…)
  add column media_product_type text,      -- Instagram FEED / REELS / STORY
  add column views bigint,
  add column metrics_raw jsonb not null default '{}',  -- every metric exactly as Meta returned it, by API name
  add column metrics_updated_at timestamptz,
  add column meta_connection_id uuid references meta_connections(id) on delete set null,
  add column pillar_assigned_by text check (pillar_assigned_by in ('import', 'user', 'ai'));
alter table historical_content_items add constraint historical_items_external_unique unique (project_id, source, external_id);
create index on historical_content_items (project_id, source);

-- existing rows came from file imports
update historical_content_items h set source = j.file_type, pillar_assigned_by = case when h.pillar_id is not null then 'import' end
from import_jobs j where h.import_job_id = j.id;

alter table content_items add column views bigint;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table meta_connections enable row level security;
create policy "meta_connections: members read" on meta_connections for select using (is_workspace_member(project_workspace(project_id)));
create policy "meta_connections: editors write" on meta_connections for all
  using (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))
  with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]));

alter table meta_sync_runs enable row level security;
create policy "meta_sync_runs: members read" on meta_sync_runs for select using (is_workspace_member(project_workspace(project_id)));
create policy "meta_sync_runs: editors write" on meta_sync_runs for all
  using (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))
  with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]));

-- Token access, editors and above only.
create or replace function meta_store_tokens(p_connection uuid, p_user_token text, p_page_token text) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from meta_connections where id = p_connection;
  if pid is null or not has_workspace_role(project_workspace(pid), array['owner','admin','editor']::workspace_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into meta_tokens (connection_id, user_token_enc, page_token_enc, updated_at)
    values (p_connection, p_user_token, p_page_token, now())
  on conflict (connection_id) do update set
    user_token_enc = coalesce(excluded.user_token_enc, meta_tokens.user_token_enc),
    page_token_enc = coalesce(excluded.page_token_enc, meta_tokens.page_token_enc),
    updated_at = now();
end $$;

create or replace function meta_read_tokens(p_connection uuid) returns table (user_token_enc text, page_token_enc text)
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from meta_connections where id = p_connection;
  if pid is null or not has_workspace_role(project_workspace(pid), array['owner','admin','editor']::workspace_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select t.user_token_enc, t.page_token_enc from meta_tokens t where t.connection_id = p_connection;
end $$;

create or replace function meta_clear_tokens(p_connection uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from meta_connections where id = p_connection;
  if pid is null or not has_workspace_role(project_workspace(pid), array['owner','admin','editor']::workspace_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from meta_tokens where connection_id = p_connection;
end $$;

revoke all on function meta_store_tokens(uuid, text, text) from public, anon;
revoke all on function meta_read_tokens(uuid) from public, anon;
revoke all on function meta_clear_tokens(uuid) from public, anon;
grant execute on function meta_store_tokens(uuid, text, text) to authenticated;
grant execute on function meta_read_tokens(uuid) to authenticated;
grant execute on function meta_clear_tokens(uuid) to authenticated;
