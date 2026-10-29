-- Adding or deleting a post's media no longer sends approved content back to "In production". The team now moves
-- posts freely on the board (0019) and attaches photos while publishing; a media change silently un-approving a post
-- made "Publish now" fail. Every media change is still recorded in the activity log. Only this function changes.

begin;

create or replace function production_asset_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare c content_items;
begin
  select * into c from content_items where id=coalesce(new.content_item_id,old.content_item_id) and project_id=coalesce(new.project_id,old.project_id);
  if c.id is null then
    if tg_op='DELETE' then return old; end if; -- FK cascade after the parent content has been removed
    raise exception 'Content belongs to another project';
  end if;
  if auth.uid() is not null and not production_can_edit(c.project_id,c.id) then raise exception 'Content is not assigned to you' using errcode='42501'; end if;
  if c.status='published' then raise exception 'Published content is locked'; end if;
  if tg_op='UPDATE' and (new.content_item_id<>old.content_item_id or new.project_id<>old.project_id) then raise exception 'Asset ownership cannot change'; end if;
  if tg_op<>'DELETE' and new.kind='media' then
    if new.body->>'url' is not null and new.body->>'url' !~ '^https://[^[:space:]]+$' then raise exception 'Use an HTTPS media URL'; end if;
    if new.body->>'path' is not null and new.body->>'path' not like c.project_id::text || '/' || c.id::text || '/%' then raise exception 'Invalid upload path'; end if;
  end if;
  insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(c.project_id,c.id,auth.uid(),'attachment','Media attachment ' || lower(tg_op),c.revision);
  return coalesce(new,old);
end $$;

commit;
