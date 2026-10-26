-- One running sync per connection, enforced by the database (the app-side check alone could race),
-- and a heartbeat so a run abandoned by a crashed process is detected within minutes.
alter table meta_sync_runs add column heartbeat_at timestamptz;

-- close any run left "running" before this migration
update meta_sync_runs set status = 'failed', finished_at = now(), errors = '[{"platform":"all","message":"Interrupted"}]'
where status = 'running';

create unique index meta_sync_runs_one_running on meta_sync_runs (connection_id) where status = 'running';
