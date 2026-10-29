-- Simpler production board: five columns (Idea, Brief, In production, Internal review, Done) and free movement between
-- them. Moving a card to Done ("ready") is an approval: it is recorded in the activity log with the mover's name and
-- still requires the right to approve content. Only production_transition changes; the guard trigger is untouched.

begin;

create or replace function production_transition(p_project uuid,p_id uuid,p_revision integer,p_stage text,p_decision text default null,p_comment text default '') returns content_items
language plpgsql security definer set search_path=public as $$
declare c content_items; ws uuid := project_workspace(p_project); approver boolean; review_kind text;
begin
  if not has_workspace_role(ws,array['owner','admin','editor']::workspace_role[]) then raise exception 'Not authorized' using errcode='42501'; end if;
  approver:=has_workspace_role(ws,array['owner','admin']::workspace_role[]) or has_permission(ws,'content.approve');
  select * into c from content_items where id=p_id and project_id=p_project for update;
  if c.id is null or not can_view_content(p_project,p_id) then raise exception 'Content not found'; end if;
  if c.revision<>p_revision then raise exception 'This content changed. Reload before continuing.' using errcode='40001'; end if;
  if c.status='published' or p_stage='published' then raise exception 'Publication must be confirmed by a connected platform'; end if;
  if p_decision is not null then
    if c.production_stage not in ('internal_review','approval') then raise exception 'Content is not awaiting review'; end if;
    if c.production_stage='approval' and not approver then raise exception 'Only members who can approve content can give final approval' using errcode='42501'; end if;
    if c.production_stage='internal_review' and not (approver or has_permission(ws,'content.review')) then raise exception 'Only reviewers can review content' using errcode='42501'; end if;
    if p_decision not in ('approve','reject','changes') then raise exception 'Invalid decision'; end if;
    if p_decision='approve' and c.assignee_id=auth.uid() and not has_permission(ws,'content.approve_own') then
      raise exception 'You cannot approve your own work' using errcode='42501';
    end if;
    if p_decision in ('reject','changes') and length(trim(p_comment))=0 then raise exception 'Explain the requested changes or rejection'; end if;
    -- An approver's approval finishes the content (Done); a reviewer without approval rights passes it to an approver.
    review_kind:=case when p_decision='approve' then case when approver then 'approved' else 'internal_approved' end when p_decision='reject' then 'rejected' else 'changes_requested' end;
    p_stage:=case when p_decision='approve' then case when approver then 'ready' else 'approval' end else 'in_production' end;
    insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(p_project,p_id,auth.uid(),review_kind,p_comment,c.revision);
  elsif not production_can_edit(p_project,p_id) then raise exception 'This content is not assigned to you' using errcode='42501';
  elsif p_stage='ready' and c.production_stage<>'ready' then
    -- Dragging to Done is an approval by the person who moved it.
    if not approver then raise exception 'Only members who can approve content can move it to Done' using errcode='42501'; end if;
    if c.assignee_id=auth.uid() and not has_permission(ws,'content.approve_own') then
      raise exception 'You cannot approve your own work' using errcode='42501';
    end if;
    insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(p_project,p_id,auth.uid(),'approved','Moved to Done',c.revision);
  end if;
  update content_items set production_stage=p_stage where id=p_id returning * into c;
  return c;
end $$;

commit;
