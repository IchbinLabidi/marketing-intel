-- Content Production. Additive: keeps existing calendar items, assets and opportunity links.
begin;
alter table projects add column production_workflow jsonb not null default '{"require_internal_review":true,"labels":{}}';
alter table content_items
  add column production_stage text not null default 'idea' check (production_stage in ('idea','brief','in_production','internal_review','approval','ready','published')),
  add column main_content text,
  add column visual_direction text,
  add column target_audience text,
  add column language_variants jsonb not null default '{}',
  add column revision integer not null default 1,
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz;
update content_items set production_stage = case status
  when 'brief_ready' then 'brief' when 'in_production' then 'in_production' when 'in_review' then 'internal_review'
  when 'approved' then 'ready' when 'scheduled' then 'ready' when 'published' then 'published' else 'idea' end;
create index on content_items(project_id, production_stage, due_date);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  revision integer not null, snapshot jsonb not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(content_item_id, revision)
);
create table content_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  content_item_id uuid not null references content_items(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('created','edited','stage','assigned','comment','internal_approved','approved','rejected','changes_requested','restored','attachment')),
  body text not null default '' check (length(body) <= 5000),
  mentions uuid[] not null default '{}', revision integer not null,
  created_at timestamptz not null default now()
);
create index on content_activity(content_item_id, created_at desc);
create table content_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  body jsonb not null, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table content_versions enable row level security;
alter table content_activity enable row level security;
alter table content_templates enable row level security;
create policy "versions: members read" on content_versions for select using (is_workspace_member(project_workspace(project_id)));
create policy "activity: members read" on content_activity for select using (is_workspace_member(project_workspace(project_id)));
create policy "templates: members read" on content_templates for select using (is_workspace_member(project_workspace(project_id)));
create policy "templates: editors insert" on content_templates for insert with check (created_by = auth.uid() and has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]));
create policy "templates: author or admin delete" on content_templates for delete using (has_workspace_role(project_workspace(project_id), array['owner','admin']::workspace_role[]) or (created_by = auth.uid() and has_workspace_role(project_workspace(project_id), array['editor']::workspace_role[])));

-- Activity and versions are append-only and written by checked functions/triggers, never supplied by clients.
create function production_can_edit(p uuid, item uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from content_items c where c.id = item and c.project_id = p and
    (has_workspace_role(project_workspace(p), array['owner','admin']::workspace_role[]) or
     (has_workspace_role(project_workspace(p), array['editor']::workspace_role[]) and
      (c.assignee_id = auth.uid() or (c.assignee_id is null and c.created_by = auth.uid())))));
$$;

-- Compare only production copy/context. Scheduling and assignment never invalidate an approval.
create function production_copy(c content_items) returns jsonb language sql immutable as $$
  select jsonb_build_object('title',c.title,'hook',c.hook,'caption',c.caption,'main_content',c.main_content,
    'cta',c.cta,'hashtags',c.hashtags,'creative_brief',c.creative_brief,'visual_direction',c.visual_direction,
    'language',c.language,'language_variants',c.language_variants,'platform',c.platform,'format',c.format,
    'target_audience',c.target_audience,'pillar_id',c.pillar_id,'funnel_stage',c.funnel_stage,'media_url',c.media_url);
$$;

create function production_guard() returns trigger language plpgsql security definer set search_path = public as $$
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
    if new.project_id <> old.project_id or new.created_by is distinct from old.created_by or new.opportunity_id is distinct from old.opportunity_id then
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
    -- A calendar edit can change status without knowing the production stage.
    if new.status is distinct from old.status and new.production_stage=old.production_stage then
      new.production_stage := case new.status when 'brief_ready' then 'brief' when 'in_production' then 'in_production'
        when 'in_review' then 'internal_review' when 'approved' then 'ready' when 'scheduled' then 'ready'
        when 'published' then 'published' else 'idea' end;
    end if;
    if copy_changed and old.production_stage in ('internal_review','approval','ready') then
      new.production_stage := 'in_production'; new.status := 'in_production';
      new.approved_by := null; new.approved_at := null;
    else
      new.approved_by := old.approved_by; new.approved_at := old.approved_at;
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
  -- Publication requires a post already confirmed by the connected platform sync, in this project.
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
  -- Lock the source row to serialize concurrent calendar/production conversions without deleting existing duplicates.
  if new.opportunity_id is not null and tg_op='INSERT' then
    select id into opp from opportunities where id=new.opportunity_id and project_id=new.project_id for update;
    if opp is null then raise exception 'Opportunity not found'; end if;
    if exists(select 1 from content_items where opportunity_id=opp and id<>new.id) then raise exception 'This opportunity already has a content item'; end if;
  end if;
  return new;
end $$;
create trigger production_guard before insert or update on content_items for each row execute function production_guard();

create function production_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare event_kind text; description text;
begin
  if tg_op<>'DELETE' then
    insert into content_versions(project_id,content_item_id,revision,snapshot,actor_id) values(new.project_id,new.id,new.revision,to_jsonb(new),auth.uid());
    event_kind:=case when tg_op='INSERT' then 'created' when new.production_stage<>old.production_stage then 'stage' when new.assignee_id is distinct from old.assignee_id then 'assigned' else 'edited' end;
    description:=case when event_kind='stage' then old.production_stage || ' → ' || new.production_stage when event_kind='assigned' then 'Assignment updated' when event_kind='created' then 'Content created' else 'Content updated' end;
    insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(new.project_id,new.id,auth.uid(),event_kind,description,new.revision);
  end if;
  if coalesce(new.opportunity_id,old.opportunity_id) is not null then
    update opportunities set state=case
      when exists(select 1 from content_items where opportunity_id=opportunities.id and status='published') then 'published'
      when exists(select 1 from content_items where opportunity_id=opportunities.id and status='scheduled') then 'scheduled'
      else 'in_progress' end, status_changed_at=now()
    where id=coalesce(new.opportunity_id,old.opportunity_id);
  end if;
  return coalesce(new,old);
end $$;
create trigger production_audit after insert or update or delete on content_items for each row execute function production_audit();
insert into content_versions(project_id,content_item_id,revision,snapshot,actor_id) select project_id,id,revision,to_jsonb(c),created_by from content_items c;

-- Preserve assignment authorization for deletion as well as updates (existing RLS used broad editor access).
drop policy "content_items: editors write" on content_items;
create policy "content: insert" on content_items for insert with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]) and created_by=auth.uid());
create policy "content: update" on content_items for update using (production_can_edit(project_id,id)) with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]));
create policy "content: delete" on content_items for delete using (production_can_edit(project_id,id) and status<>'published');

-- Lock + expected revision prevents two tabs overwriting each other; all writes and audit are one transaction.
create function save_production(p_project uuid, p_id uuid, p_revision integer, p_values jsonb) returns content_items
language plpgsql security definer set search_path=public as $$
declare c content_items; v content_items;
begin
  if not has_workspace_role(project_workspace(p_project),array['owner','admin','editor']::workspace_role[]) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_id is not null then
    select * into c from content_items where id=p_id and project_id=p_project for update;
    if c.id is null or not production_can_edit(p_project,p_id) then raise exception 'Content not found or not assigned to you' using errcode='42501'; end if;
    if c.revision<>p_revision then raise exception 'This content changed in another session. Reload before saving.' using errcode='40001'; end if;
  end if;
  v:=jsonb_populate_record(null::content_items,p_values);
  if length(trim(v.title)) not between 1 and 300 or v.platform is null or v.language is null then raise exception 'Title, platform and language are required'; end if;
  if p_id is null then
    insert into content_items(project_id,created_by,title,platform,format,language,hook,caption,main_content,cta,hashtags,creative_brief,visual_direction,target_audience,pillar_id,funnel_stage,assignee_id,due_date,language_variants)
    values(p_project,auth.uid(),v.title,v.platform,v.format,v.language,v.hook,v.caption,v.main_content,v.cta,coalesce(v.hashtags,'{}'),v.creative_brief,v.visual_direction,v.target_audience,v.pillar_id,v.funnel_stage,v.assignee_id,v.due_date,coalesce(v.language_variants,'{}')) returning * into c;
  else
    update content_items set title=v.title,platform=v.platform,format=v.format,language=v.language,hook=v.hook,caption=v.caption,main_content=v.main_content,cta=v.cta,hashtags=coalesce(v.hashtags,'{}'),creative_brief=v.creative_brief,visual_direction=v.visual_direction,target_audience=v.target_audience,pillar_id=v.pillar_id,funnel_stage=v.funnel_stage,assignee_id=v.assignee_id,due_date=v.due_date,language_variants=coalesce(v.language_variants,'{}') where id=p_id returning * into c;
  end if;
  return c;
end $$;

create function production_transition(p_project uuid,p_id uuid,p_revision integer,p_stage text,p_decision text default null,p_comment text default '') returns content_items
language plpgsql security definer set search_path=public as $$
declare c content_items; admin boolean; review_kind text;
begin
  if not has_workspace_role(project_workspace(p_project),array['owner','admin','editor']::workspace_role[]) then raise exception 'Not authorized' using errcode='42501'; end if;
  admin:=has_workspace_role(project_workspace(p_project),array['owner','admin']::workspace_role[]);
  select * into c from content_items where id=p_id and project_id=p_project for update;
  if c.id is null then raise exception 'Content not found'; end if;
  if c.revision<>p_revision then raise exception 'This content changed. Reload before continuing.' using errcode='40001'; end if;
  if c.status='published' or p_stage='published' then raise exception 'Publication must be confirmed by a connected platform'; end if;
  if p_decision is not null then
    if c.production_stage not in ('internal_review','approval') then raise exception 'Content is not awaiting review'; end if;
    if c.production_stage='approval' and not admin then raise exception 'Only owners and admins can give final approval' using errcode='42501'; end if;
    if p_decision not in ('approve','reject','changes') then raise exception 'Invalid decision'; end if;
    if p_decision in ('reject','changes') and length(trim(p_comment))=0 then raise exception 'Explain the requested changes or rejection'; end if;
    review_kind:=case when p_decision='approve' then case c.production_stage when 'internal_review' then 'internal_approved' else 'approved' end when p_decision='reject' then 'rejected' else 'changes_requested' end;
    p_stage:=case when p_decision='approve' then case c.production_stage when 'internal_review' then 'approval' else 'ready' end else 'in_production' end;
    insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(p_project,p_id,auth.uid(),review_kind,p_comment,c.revision);
  elsif not production_can_edit(p_project,p_id) then raise exception 'This content is not assigned to you' using errcode='42501';
  end if;
  update content_items set production_stage=p_stage where id=p_id returning * into c;
  return c;
end $$;

create function production_comment(p_project uuid,p_id uuid,p_body text,p_mentions uuid[] default '{}') returns void
language plpgsql security definer set search_path=public as $$
declare c content_items;
begin
  if not has_workspace_role(project_workspace(p_project),array['owner','admin','editor']::workspace_role[]) then raise exception 'Read-only workspace' using errcode='42501'; end if;
  select * into c from content_items where id=p_id and project_id=p_project;
  if c.id is null or length(trim(p_body)) not between 1 and 5000 then raise exception 'Content and comment are required'; end if;
  if exists(select 1 from unnest(p_mentions) m where not exists(select 1 from workspace_members where workspace_id=project_workspace(p_project) and user_id=m)) then raise exception 'Mentioned user is not a workspace member'; end if;
  insert into content_activity(project_id,content_item_id,actor_id,kind,body,mentions,revision) values(p_project,p_id,auth.uid(),'comment',p_body,p_mentions,c.revision);
end $$;

create function restore_production(p_project uuid,p_id uuid,p_revision integer,p_version uuid) returns content_items
language plpgsql security definer set search_path=public as $$
declare v jsonb; c content_items;
begin
  select snapshot into v from content_versions where id=p_version and project_id=p_project and content_item_id=p_id;
  if v is null then raise exception 'Version not found'; end if;
  -- Only writing/context is restored. Ownership, deadlines and publication state remain current.
  select * into c from content_items where id=p_id and project_id=p_project for update;
  v:=v || jsonb_build_object('assignee_id',c.assignee_id,'due_date',c.due_date,'language',coalesce(v->>'language','fr'));
  c:=save_production(p_project,p_id,p_revision,v);
  insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(p_project,p_id,auth.uid(),'restored','Restored revision ' || (v->>'revision'),c.revision);
  return c;
end $$;

-- Reuse existing assets for attachments. URL attachments and private uploads share one list.
alter table content_assets drop constraint content_assets_kind_check;
alter table content_assets add constraint content_assets_kind_check check(kind in ('caption','reel_script','carousel','story_sequence','creative_brief','visual_direction','cta_variations','hashtags','media'));
create function production_asset_guard() returns trigger language plpgsql security definer set search_path=public as $$
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
  update content_items set production_stage=case when production_stage in ('internal_review','approval','ready') then 'in_production' else production_stage end where id=c.id;
  insert into content_activity(project_id,content_item_id,actor_id,kind,body,revision) values(c.project_id,c.id,auth.uid(),'attachment','Media attachment ' || lower(tg_op),c.revision);
  return coalesce(new,old);
end $$;
create trigger production_asset_guard before insert or update or delete on content_assets for each row execute function production_asset_guard();

create function production_workflow_guard() returns trigger language plpgsql as $$
begin
  if new.production_workflow is distinct from old.production_workflow and not has_workspace_role(old.workspace_id,array['owner','admin']::workspace_role[]) then raise exception 'Only administrators can configure workflow' using errcode='42501'; end if;
  return new;
end $$;
create trigger production_workflow_guard before update on projects for each row execute function production_workflow_guard();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('production-media','production-media',false,26214400,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf']) on conflict do nothing;
create policy "production media: read" on storage.objects for select using(bucket_id='production-media' and is_workspace_member(project_workspace(((storage.foldername(name))[1])::uuid)));
create policy "production media: upload" on storage.objects for insert with check(bucket_id='production-media' and production_can_edit(((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid));
create policy "production media: delete" on storage.objects for delete using(bucket_id='production-media' and production_can_edit(((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid));

revoke all on function save_production(uuid,uuid,integer,jsonb), production_transition(uuid,uuid,integer,text,text,text), production_comment(uuid,uuid,text,uuid[]), restore_production(uuid,uuid,integer,uuid) from public;
grant execute on function save_production(uuid,uuid,integer,jsonb), production_transition(uuid,uuid,integer,text,text,text), production_comment(uuid,uuid,text,uuid[]), restore_production(uuid,uuid,integer,uuid) to authenticated;
commit;
