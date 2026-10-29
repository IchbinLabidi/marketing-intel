-- Competitor ads recorded from Meta's public Ad Library. Meta's Ad Library API only returns commercial ads that
-- reached the EU, so ads aimed elsewhere are saved by a person (link, start date, text, platforms). Kept apart from
-- competitor_content_items so paid ads never mix with organic post analysis. Adds a table; changes nothing else.

begin;

create table competitor_ads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  competitor_id uuid not null references competitors(id) on delete cascade,
  library_id text not null check (library_id ~ '^\d{5,25}$'),   -- Meta Ad Library ID
  url text not null,
  started_on date not null,
  ended_on date,                                                 -- null while the ad is still running
  platforms text[] not null default '{}',                        -- facebook, instagram, messenger, audience_network, threads
  body text not null default '' check (length(body) <= 5000),
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competitor_id, library_id),
  check (ended_on is null or ended_on >= started_on)
);
create trigger set_updated_at before update on competitor_ads for each row execute function set_updated_at();
create index on competitor_ads (project_id, competitor_id, started_on desc);

alter table competitor_ads enable row level security;
create policy "competitor_ads: intelligence view" on competitor_ads for select
  using (project_id in (select permitted_projects('intelligence.view')));
create policy "competitor_ads: intelligence write" on competitor_ads for all
  using (project_id in (select permitted_projects('intelligence.edit')))
  with check (project_id in (select permitted_projects('intelligence.edit')));

commit;
