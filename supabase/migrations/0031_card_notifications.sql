-- 0031: production card notifications.
--  * The lead assignee is notified when a card is created already assigned to them (before, only a later change
--    of assignee notified anyone).
--  * Everyone working on a card (lead assignee + members with an open task on it) is notified when someone else
--    changes it: fields, stage, media, comments. Repeated edits by the same person within 15 minutes are folded
--    into one unread notification instead of piling up.
--  * notifications get a `meta` column (card title, who did it, what changed) so the app can word them in the
--    reader's language, and the table is published to Supabase Realtime so open tabs hear about them live.
--  * notify() is no longer callable from the API (only the triggers use it).

begin;

alter table notifications add column if not exists meta jsonb not null default '{}'::jsonb;
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check check (kind in
  ('assigned','mention','review_requested','changes_requested','approved','invited','card_updated','card_comment','card_media'));
create index if not exists notifications_item_idx on notifications (user_id, content_item_id, kind, created_at desc);

create or replace function actor_display_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(full_name), '') from profiles where id = auth.uid()), '');
$$;

create or replace function notify_meta(p_user uuid, p_kind text, p_project uuid, p_item uuid, p_body text, p_meta jsonb) returns void
language sql security definer set search_path = public as $$
  insert into notifications (workspace_id, user_id, kind, project_id, content_item_id, actor_id, body, meta)
  select project_workspace(p_project), p_user, p_kind, p_project, p_item, auth.uid(), left(p_body, 500), coalesce(p_meta, '{}'::jsonb)
  where p_user is not null and p_user is distinct from auth.uid();
$$;

-- Who is working on a card: the lead assignee and members with an open task on it.
create or replace function card_watchers(p_item uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select assignee_id from content_items where id = p_item and assignee_id is not null
  union
  select user_id from content_assignments where content_item_id = p_item and status not in ('approved', 'completed');
$$;

create or replace function notify_card_change(p_project uuid, p_item uuid, p_kind text, p_body text, p_meta jsonb, p_skip uuid[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  u uuid;
  t text;
  who text := actor_display_name();
  prev notifications;
  v_meta jsonb;
begin
  -- Automatic changes (scheduled publishing, metric syncs) are nobody's edit: they don't ping anyone.
  if me is null then return; end if;
  select title into t from content_items where id = p_item;
  v_meta := coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('title', coalesce(t, ''), 'actor', who);
  for u in select * from card_watchers(p_item) loop
    continue when u = me or u = any(coalesce(p_skip, '{}'));
    -- Just told they were assigned by this same person: that already covers it.
    continue when exists (select 1 from notifications n where n.user_id = u and n.content_item_id = p_item and n.kind = 'assigned'
      and n.actor_id = me and n.created_at > now() - interval '1 minute');
    prev := null;
    if p_kind = 'card_updated' then
      select * into prev from notifications n where n.user_id = u and n.content_item_id = p_item and n.kind = 'card_updated'
        and n.actor_id = me and n.read_at is null and n.created_at > now() - interval '15 minutes'
        order by n.created_at desc limit 1 for update;
    end if;
    if prev.id is not null then
      update notifications set created_at = now(), body = left(p_body, 500),
        meta = v_meta || jsonb_build_object('fields', (
          select coalesce(jsonb_agg(distinct f), '[]'::jsonb) from (
            select jsonb_array_elements_text(coalesce(prev.meta->'fields', '[]'::jsonb)) f
            union select jsonb_array_elements_text(coalesce(v_meta->'fields', '[]'::jsonb))) x))
        where id = prev.id;
    else
      perform notify_meta(u, p_kind, p_project, p_item, p_body, v_meta);
    end if;
  end loop;
end $$;

create or replace function notify_on_content() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; changed text[];
  tracked text[] := array['title','hook','caption','main_content','cta','hashtags','creative_brief','visual_direction','platform',
    'target_platforms','format','language','language_variants','platform_captions','target_audience','audience','pillar_id',
    'funnel_stage','due_date','production_stage','scheduled_date','scheduled_time','media_url','priority','description','tags'];
  newly uuid[] := '{}';
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      perform notify_meta(new.assignee_id, 'assigned', new.project_id, new.id, 'You lead: ' || new.title,
        jsonb_build_object('title', new.title, 'actor', actor_display_name()));
    end if;
    return new;
  end if;
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    perform notify_meta(new.assignee_id, 'assigned', new.project_id, new.id, 'You lead: ' || new.title,
      jsonb_build_object('title', new.title, 'actor', actor_display_name()));
    newly := array[new.assignee_id];
  end if;
  if new.production_stage in ('internal_review','approval') and new.production_stage is distinct from old.production_stage then
    perform notify(new.created_by, 'review_requested', new.project_id, new.id, 'Ready for review: ' || new.title);
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  select coalesce(array_agg(k order by k), '{}') into changed from unnest(tracked) k where n ? k and (n->k) is distinct from (o->k);
  if cardinality(changed) > 0 and new.archived_at is null then
    perform notify_card_change(new.project_id, new.id, 'card_updated',
      coalesce(nullif(actor_display_name(), ''), 'A team member') || ' changed ' || array_to_string(changed, ', ') || ' on: ' || new.title,
      jsonb_build_object('fields', to_jsonb(changed), 'stage', case when 'production_stage' = any(changed) then new.production_stage end),
      newly);
  end if;
  return new;
end $$;
drop trigger if exists notify_on_content on content_items;
create trigger notify_on_content after insert or update on content_items for each row execute function notify_on_content();

create or replace function notify_on_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare m uuid; title text;
begin
  select c.title into title from content_items c where c.id = new.content_item_id;
  if new.kind = 'comment' then
    foreach m in array coalesce(new.mentions, '{}') loop
      perform notify_meta(m, 'mention', new.project_id, new.content_item_id, 'Mentioned you on ' || title || ': ' || left(new.body, 200),
        jsonb_build_object('title', title, 'actor', actor_display_name(), 'excerpt', left(new.body, 200)));
    end loop;
    perform notify_card_change(new.project_id, new.content_item_id, 'card_comment',
      coalesce(nullif(actor_display_name(), ''), 'A team member') || ' commented on ' || title || ': ' || left(new.body, 200),
      jsonb_build_object('excerpt', left(new.body, 200)), coalesce(new.mentions, '{}'));
  elsif new.kind = 'attachment' then
    perform notify_card_change(new.project_id, new.content_item_id, 'card_media',
      coalesce(nullif(actor_display_name(), ''), 'A team member') || case when new.body ilike '%delete%' then ' removed media from: ' else ' added media to: ' end || title,
      jsonb_build_object('action', case when new.body ilike '%delete%' then 'removed' else 'added' end));
  elsif new.kind = 'changes_requested' then
    perform notify((select assignee_id from content_items where id = new.content_item_id), 'changes_requested', new.project_id, new.content_item_id, 'Changes requested: ' || title);
  end if;
  return new;
end $$;

-- Only the triggers above may write notifications.
revoke all on function notify(uuid,text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function notify_meta(uuid,text,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function notify_card_change(uuid,uuid,text,text,jsonb,uuid[]) from public, anon, authenticated;
revoke all on function card_watchers(uuid) from public, anon, authenticated;
revoke all on function actor_display_name() from public, anon;

-- Live delivery to open tabs (Realtime applies the "own read" RLS policy: people only receive their own).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

commit;
