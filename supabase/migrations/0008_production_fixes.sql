-- Fixes on top of 0007 (Content Production). Safe to run once after 0007.
begin;

-- 1. Foreign keys "on delete set null" (opportunity or user deleted) update content_items; the guard rejected any change
--    of opportunity_id / created_by, which blocked those deletions. Clearing them is allowed; changing them is not.
create or replace function production_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare ws uuid; admin boolean; copy_changed boolean := false; review_event boolean := false; opp uuid;
begin
  ws := project_workspace(new.project_id);
  admin := has_workspace_role(ws, array['owner','admin']::workspace_role[]);
  if auth.uid() is not null and not has_workspace_role(ws, array['owner','admin','editor']::workspace_role[]) then
    raise exception 'This workspace is read-only' using errcode='42501';
  end if;
  if new.assignee_id is not null and not exists(select 1 from workspace_members where workspace_id=ws and user_id=new.assignee_id and role <> 'viewer') then
    raise exception 'Assignee must be an editor or administrator in this workspace';
  end if;
  if new.calendar_id is not null and not exists(select 1 from editorial_calendars where id=new.calendar_id and project_id=new.project_id) then
    raise exception 'Calendar belongs to another project';
  end if;
  if new.historical_source_id is not null and not exists(select 1 from historical_content_items where id=new.historical_source_id and project_id=new.project_id) then
    raise exception 'Historical source belongs to another project';
  end if;
  if tg_op='UPDATE' then
    if new.project_id <> old.project_id
      or (new.created_by is not null and new.created_by is distinct from old.created_by)
      or (new.opportunity_id is not null and new.opportunity_id is distinct from old.opportunity_id) then
      raise exception 'Content ownership and source cannot be changed';
    end if;
    copy_changed := production_copy(new) is distinct from production_copy(old);
    select exists(select 1 from content_activity where content_item_id=old.id and revision=old.revision and actor_id=auth.uid()
      and kind in ('internal_approved','approved','rejected','changes_requested') and created_at >= transaction_timestamp()) into review_event;
    if auth.uid() is not null and not production_can_edit(old.project_id,old.id) then
      if not (review_event and not copy_changed and new.assignee_id is not distinct from old.assignee_id
        and new.due_date is not distinct from old.due_date and new.scheduled_at is not distinct from old.scheduled_at
        and new.scheduled_date is not distinct from old.scheduled_date and new.scheduled_time is not distinct from old.scheduled_time) then
        raise exception 'Only the assignee, unassigned owner, or an administrator can edit this content' using errcode='42501';
      end if;
    end if;
    if old.status='published' and (copy_changed or new.status<>old.status or new.production_stage<>old.production_stage or new.scheduled_at is distinct from old.scheduled_at or new.scheduled_date is distinct from old.scheduled_date) then
      raise exception 'Published content is locked. Duplicate it to create a new draft.';
    end if;
    if new.status is distinct from old.status and new.production_stage=old.production_stage then
      new.production_stage := case new.status when 'brief_ready' then 'brief' when 'in_production' then 'in_production'
        when 'in_review' then 'internal_review' when 'approved' then 'ready' when 'scheduled' then 'ready'
        when 'published' then 'published' else 'idea' end;
    end if;
    if copy_changed and old.production_stage in ('internal_review','approval','ready') then
      new.production_stage := 'in_production'; new.status := 'in_production';
      new.approved_by := null; new.approved_at := null;
    else
      -- keep the approval, unless the approving user was deleted (FK set null)
      new.approved_by := case when new.approved_by is null and old.approved_by is not null and not exists(select 1 from auth.users where id=old.approved_by) then null else old.approved_by end;
      new.approved_at := old.approved_at;
    end if;
    if new.production_stage='approval' and old.production_stage<>'approval' then
      if (select coalesce((production_workflow->>'require_internal_review')::boolean,true) from projects where id=new.project_id)
        and not exists(select 1 from content_activity where content_item_id=old.id and revision=old.revision and kind='internal_approved' and created_at>=transaction_timestamp()) then
        raise exception 'Complete internal review before requesting manager approval';
      end if;
    end if;
    if new.production_stage='ready' and old.production_stage<>'ready' then
      if not admin or not exists(select 1 from content_activity where content_item_id=old.id and revision=old.revision and actor_id=auth.uid() and kind='approved' and created_at>=transaction_timestamp()) then
        raise exception 'Manager approval is required. Use Review & Approval.' using errcode='42501';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    end if;
    if new.production_stage not in ('ready','published') then new.approved_by:=null; new.approved_at:=null; end if;
    new.revision := old.revision + 1;
  else
    if auth.uid() is not null then new.created_by:=auth.uid(); end if;
    new.revision:=1; new.approved_by:=null; new.approved_at:=null;
    if new.status in ('approved','scheduled','published') or new.production_stage in ('approval','ready','published') then
      raise exception 'New content starts as a draft and must go through review';
    end if;
    new.production_stage:=case new.status when 'brief_ready' then 'brief' when 'in_production' then 'in_production' when 'in_review' then 'internal_review' else new.production_stage end;
  end if;
  if new.status='published' and (tg_op='INSERT' or old.status<>'published') then
    if not exists(select 1 from historical_content_items h where h.id=new.historical_source_id and h.project_id=new.project_id
      and h.source='meta_api' and h.platform=new.platform and h.published_at is not null
      and h.permalink=new.published_url and h.published_at=new.published_at) then
      raise exception 'Publication must be verified against a synced post from the connected platform';
    end if;
  end if;
  if new.production_stage='published' and new.status<>'published' then raise exception 'Verify publication from the calendar first'; end if;
  new.status:=case new.production_stage when 'idea' then case when new.status='planned' then 'planned'::content_status else 'idea'::content_status end
    when 'brief' then 'brief_ready'::content_status when 'in_production' then 'in_production'::content_status
    when 'internal_review' then 'in_review'::content_status when 'approval' then 'in_review'::content_status
    when 'ready' then case when new.status='scheduled' then 'scheduled'::content_status else 'approved'::content_status end
    else 'published'::content_status end;
  if new.status='scheduled' and (tg_op='INSERT' or old.status<>'scheduled' or new.scheduled_at is distinct from old.scheduled_at) and (new.scheduled_at is null or new.scheduled_at <= now()) then raise exception 'Scheduling requires a future date and time'; end if;
  if new.opportunity_id is not null and (tg_op='INSERT' or old.opportunity_id is null) then
    select id into opp from opportunities where id=new.opportunity_id and project_id=new.project_id for update;
    if opp is null then raise exception 'Opportunity not found'; end if;
    if exists(select 1 from content_items where opportunity_id=opp and id<>new.id) then raise exception 'This opportunity already has a content item'; end if;
  end if;
  return new;
end $$;

-- 2. Opportunity statuses written before 0007 used "scheduled" for any planned calendar item. Recompute them with the
--    rule the production_audit trigger now applies: published > scheduled > in progress (dismissed kept).
update opportunities o set state = case
    when exists(select 1 from content_items c where c.opportunity_id=o.id and c.status='published') then 'published'
    when exists(select 1 from content_items c where c.opportunity_id=o.id and c.status='scheduled') then 'scheduled'
    else 'in_progress' end,
  status_changed_at = now()
where o.state <> 'dismissed' and exists(select 1 from content_items c where c.opportunity_id=o.id);
update opportunities o set state='in_progress', status_changed_at=now()
where o.state in ('scheduled','published') and not exists(select 1 from content_items c where c.opportunity_id=o.id);

commit;
