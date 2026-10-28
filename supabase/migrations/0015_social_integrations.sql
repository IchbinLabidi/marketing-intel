-- Social media integrations beyond Meta: YouTube, LinkedIn Pages, TikTok.
-- Meta keeps its own tables (0003). Every other provider uses the generic tables below: one row per connected
-- account (channel, organization page, TikTok account), several per project and provider when allowed.
-- Posts and videos go into historical_content_items, identified by (project_id, source, external_id), so repeated
-- syncs update rows instead of duplicating them. Nothing here touches existing data.

begin;

-- ---------------------------------------------------------------------------
-- Connected accounts
-- ---------------------------------------------------------------------------
create table social_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  provider text not null check (provider in ('youtube', 'linkedin', 'tiktok')),
  -- api_key: public data read with the server's API key (YouTube only); oauth: the account owner authorized access
  auth_type text not null check (auth_type in ('api_key', 'oauth')),
  external_account_id text not null,          -- channel id, organization URN, TikTok open_id
  account_name text,
  account_handle text,
  account_url text,
  avatar_url text,
  status text not null default 'connected'
    check (status in ('connected', 'needs_attention', 'permission_denied', 'disconnected')),
  granted_scopes text[] not null default '{}',
  declined_scopes text[] not null default '{}',
  token_expires_at timestamptz,
  auto_sync boolean not null default true,
  followers bigint,                            -- latest follower / subscriber count, null when not exposed
  followers_updated_at timestamptz,
  backfill_done boolean not null default false,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_sync_status text check (last_sync_status in ('running', 'succeeded', 'partial', 'failed')),
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider, external_account_id)
);
create trigger set_updated_at before update on social_connections for each row execute function set_updated_at();
create index on social_connections (project_id, provider);

-- Tokens are kept apart from the connection: RLS on, no policies, so no client can select them. Access only through
-- the security-definer functions below. Values are AES-256-GCM encrypted by the app server before they get here.
create table social_tokens (
  connection_id uuid primary key references social_connections(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table social_tokens enable row level security;

-- Daily account-level figures (audience growth). One row per account and day, overwritten by later syncs that day.
create table social_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  connection_id uuid not null references social_connections(id) on delete cascade,
  snapshot_date date not null,
  followers bigint,
  total_views bigint,
  total_posts integer,
  metrics jsonb not null default '{}',         -- other account metrics exactly as the provider returned them
  created_at timestamptz not null default now(),
  unique (connection_id, snapshot_date)
);
create index on social_account_snapshots (project_id, snapshot_date);

create table social_sync_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  connection_id uuid not null references social_connections(id) on delete cascade,
  trigger text not null default 'manual' check (trigger in ('manual', 'auto', 'scheduled', 'connect')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  stats jsonb not null default '{}',           -- {fetched, created, updated, api_calls}
  errors jsonb not null default '[]',
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz,
  finished_at timestamptz
);
create index on social_sync_runs (connection_id, started_at desc);
-- At most one running sync per account: a concurrent start fails on insert instead of racing.
create unique index social_sync_runs_one_running on social_sync_runs (connection_id) where status = 'running';

-- ---------------------------------------------------------------------------
-- Posts: provider-specific columns on the shared table
-- ---------------------------------------------------------------------------
alter table historical_content_items
  add column if not exists social_connection_id uuid references social_connections(id) on delete set null,
  add column if not exists watch_time_minutes numeric;
create index if not exists historical_items_social_connection on historical_content_items (social_connection_id);

-- ---------------------------------------------------------------------------
-- RLS: reading needs intelligence.view, writing intelligence.edit (same rule as the Meta connection)
-- ---------------------------------------------------------------------------
alter table social_connections enable row level security;
alter table social_account_snapshots enable row level security;
alter table social_sync_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['social_connections', 'social_account_snapshots', 'social_sync_runs'] loop
    execute format($p$create policy "%1$s: intelligence view" on %1$I for select using (project_id in (select permitted_projects('intelligence.view')))$p$, t);
    execute format($p$create policy "%1$s: intelligence write" on %1$I for all using (project_id in (select permitted_projects('intelligence.edit'))) with check (project_id in (select permitted_projects('intelligence.edit')))$p$, t);
  end loop;
end $$;

-- Token access for people who may edit intelligence on the project.
create or replace function social_store_tokens(p_connection uuid, p_access text, p_refresh text, p_refresh_expires timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from social_connections where id = p_connection;
  if pid is null or not has_permission(project_workspace(pid), 'intelligence.edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into social_tokens (connection_id, access_token_enc, refresh_token_enc, refresh_expires_at, updated_at)
    values (p_connection, p_access, p_refresh, p_refresh_expires, now())
  on conflict (connection_id) do update set
    access_token_enc = coalesce(excluded.access_token_enc, social_tokens.access_token_enc),
    refresh_token_enc = coalesce(excluded.refresh_token_enc, social_tokens.refresh_token_enc),
    refresh_expires_at = coalesce(excluded.refresh_expires_at, social_tokens.refresh_expires_at),
    updated_at = now();
end $$;

create or replace function social_read_tokens(p_connection uuid) returns table (access_token_enc text, refresh_token_enc text, refresh_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from social_connections where id = p_connection;
  if pid is null or not has_permission(project_workspace(pid), 'intelligence.edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select t.access_token_enc, t.refresh_token_enc, t.refresh_expires_at from social_tokens t where t.connection_id = p_connection;
end $$;

create or replace function social_clear_tokens(p_connection uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from social_connections where id = p_connection;
  if pid is null or not has_permission(project_workspace(pid), 'intelligence.edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from social_tokens where connection_id = p_connection;
end $$;

revoke all on function social_store_tokens(uuid, text, text, timestamptz) from public, anon;
revoke all on function social_read_tokens(uuid) from public, anon;
revoke all on function social_clear_tokens(uuid) from public, anon;
grant execute on function social_store_tokens(uuid, text, text, timestamptz) to authenticated;
grant execute on function social_read_tokens(uuid) to authenticated;
grant execute on function social_clear_tokens(uuid) to authenticated;

commit;
