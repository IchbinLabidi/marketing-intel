-- Google Drive as a media source for publishing. The project's Drive authorization reuses social_connections and
-- the encrypted social_tokens store (0015): only the allowed provider list changes. A publication can also remember
-- the temporary copy made for Instagram (deleted once Instagram has processed it). Nothing else is modified.

begin;

alter table social_connections drop constraint if exists social_connections_provider_check;
alter table social_connections add constraint social_connections_provider_check
  check (provider in ('youtube', 'linkedin', 'tiktok', 'google_drive'));

alter table content_publications add column if not exists temp_media_path text;

commit;
