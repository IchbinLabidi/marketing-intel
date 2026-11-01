-- Scheduled publishing for networks whose API can't schedule (Instagram, TikTok, YouTube): the post is queued with its
-- time (scheduled_for) and the media chosen, and a pg_cron job calls the app every 5 minutes to send what is due.
-- Facebook keeps using its own scheduling. Only additions.

alter table content_publications
  add column if not exists media_asset_ids uuid[] not null default '{}',
  -- the person allowed the temporary private link Instagram downloads from (asked when scheduling, used later)
  add column if not exists allow_temp_link boolean not null default false;
create index if not exists content_publications_due_idx on content_publications (scheduled_for) where status in ('queued', 'failed') and scheduled_for is not null;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- every 5 minutes; the endpoint only sends posts already scheduled and due, so it takes no secret
select cron.unschedule(jobid) from cron.job where jobname = 'orix-publish-due';
select cron.schedule('orix-publish-due', '*/5 * * * *',
  $$select net.http_get(url := 'https://marketing-intel-alpha.vercel.app/api/cron/publish-due', timeout_milliseconds := 300000)$$);
