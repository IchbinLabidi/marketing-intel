-- "Deleted on the platform": a publication the person removed on Facebook / Instagram / … can be marked as not published,
-- so the post can be published again. Published content stays locked for every other change; only this function may
-- lift the lock, inside its own transaction (app.unpublishing). When no network still holds the post, it returns to
-- Approved (production stage Done). The publication row keeps its history (cancelled, with a note), nothing is deleted.

begin;

-- Let the published lock and the approval check step aside only while unpublish_publication runs
do $$
declare d text := pg_get_functiondef('production_guard'::regproc);
  lock_old text := 'if old.status=''published'' and (';
  lock_new text := 'if old.status=''published'' and coalesce(current_setting(''app.unpublishing'', true), '''') <> ''on'' and (';
  ready_old text := 'if new.production_stage=''ready'' and old.production_stage<>''ready'' then';
  ready_new text := 'if new.production_stage=''ready'' and old.production_stage<>''ready'' and coalesce(current_setting(''app.unpublishing'', true), '''') <> ''on'' then';
begin
  if position('app.unpublishing' in d) > 0 then return; end if; -- already patched
  if (length(d) - length(replace(d, lock_old, ''))) / length(lock_old) <> 1 or (length(d) - length(replace(d, ready_old, ''))) / length(ready_old) <> 1 then
    raise exception 'production_guard changed: patch it by hand';
  end if;
  execute replace(replace(d, lock_old, lock_new), ready_old, ready_new);
end $$;

create or replace function unpublish_publication(p_project uuid, p_publication uuid) returns content_publications
language plpgsql security definer set search_path = public as $$
declare ws uuid := project_workspace(p_project); pub content_publications;
begin
  if not has_workspace_role(ws, array['owner','admin','editor']::workspace_role[])
     or not (has_permission(ws, 'calendar.edit') or has_permission(ws, 'content.create')) then
    raise exception 'Your role can''t change publications' using errcode = '42501';
  end if;
  update content_publications set status = 'cancelled', platform_post_id = null, platform_url = null, scheduled_for = null,
      container_id = null, error = 'Marked as not published (deleted on ' || provider || ') on ' || to_char(now(), 'YYYY-MM-DD'), error_kind = null
    where id = p_publication and project_id = p_project and status in ('published', 'scheduled')
    returning * into pub;
  if pub.id is null then raise exception 'This publication is not published or scheduled.'; end if;
  -- the post goes back to Approved once no network still has it
  if not exists (select 1 from content_publications where content_item_id = pub.content_item_id and status in ('published', 'scheduled', 'uploading', 'processing')) then
    perform set_config('app.unpublishing', 'on', true);
    update content_items set status = 'approved', production_stage = 'ready', published_at = null, published_url = null, publish_error = null
      where id = pub.content_item_id and project_id = p_project and status in ('published', 'scheduled');
    perform set_config('app.unpublishing', 'off', true);
  end if;
  return pub;
end $$;
revoke all on function unpublish_publication(uuid, uuid) from public, anon;
grant execute on function unpublish_publication(uuid, uuid) to authenticated;

commit;
