-- Publishing posts to social networks from the editorial calendar.
--  * content_publications: one row per (post, network, account) with its status, the platform's post id and link,
--    errors and attempts. The unique key makes publishing idempotent: the same post can't be sent twice to the
--    same account by a double click or a retried job.
--  * Media stays in content_assets (kind 'media'); its body now also describes Google Drive files
--    ({source_type:'google_drive', source_file_id, …}). No new media table: the existing model is reused.
--  * The production-media bucket accepts files up to 50 MB (Supabase's per-file limit on the free plan) so short
--    videos can be stored for publishing.
-- Adds a table and widens a limit; changes no existing data.

begin;

create table content_publications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  provider text not null check (provider in ('facebook', 'instagram', 'youtube', 'linkedin', 'tiktok')),
  account_ref text not null,                    -- Page id, Instagram user id, channel id, organization URN, open_id
  account_name text,
  media_asset_id uuid references content_assets(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'uploading', 'processing', 'scheduled', 'published', 'failed', 'cancelled')),
  scheduled_for timestamptz,                    -- set when the network schedules it natively (Facebook)
  platform_post_id text,
  platform_url text,
  container_id text,                            -- Instagram media container while it is being processed
  error text,
  error_kind text check (error_kind in ('transient', 'permanent', 'auth', 'validation')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, provider, account_ref)
);
create trigger set_updated_at before update on content_publications for each row execute function set_updated_at();
create index on content_publications (project_id, status);
create index on content_publications (status, next_attempt_at) where status in ('queued', 'processing');

alter table content_publications enable row level security;
create policy "content_publications: calendar view" on content_publications for select
  using (project_id in (select permitted_projects('calendar.view')));
create policy "content_publications: calendar edit" on content_publications for all
  using (project_id in (select permitted_projects('calendar.edit')))
  with check (project_id in (select permitted_projects('calendar.edit')));

update storage.buckets set file_size_limit = 52428800 where id = 'production-media';

commit;
