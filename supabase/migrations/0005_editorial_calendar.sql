-- Editorial Calendar (Phase 7). Additive only: existing rows are kept and backfilled.

-- A post that could not be published. Only set when a publication attempt actually fails.
alter type content_status add value if not exists 'failed';

-- Times are entered and shown in the project's time zone and stored as timestamptz (UTC).
alter table projects add column timezone text not null default 'Africa/Tunis';

alter table content_items
  add column scheduled_at timestamptz,        -- exact publication slot (UTC); scheduled_date/time stay in sync (local)
  add column media_url text check (media_url is null or media_url ~* '^https://'),
  add column published_at timestamptz,        -- set only when publication is confirmed
  add column published_url text check (published_url is null or published_url ~* '^https://'),
  add column publish_error text;
create index on content_items (project_id, scheduled_at);

-- Only posts that already have a time get an exact slot; date-only posts stay "time not set" (no invented times).
update content_items c
set scheduled_at = ((c.scheduled_date + c.scheduled_time) at time zone p.timezone)
from projects p
where p.id = c.project_id and c.scheduled_date is not null and c.scheduled_time is not null and c.scheduled_at is null;

-- Exact publication time of synced posts (Meta returns it), used for best-day / best-time insights.
alter table historical_content_items add column published_at timestamptz;
