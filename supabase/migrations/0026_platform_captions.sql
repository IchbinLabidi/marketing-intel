-- Content Studio V2: per-platform captions and descriptions. Additive and non-destructive. (Applied to the live database on 2026-11-01 under the working name 0024.)
--
-- content_items.platform_captions holds one entry per platform (tiktok, facebook, instagram, youtube_shorts, youtube,
-- linkedin, x, threads, pinterest), each with its own title, caption/description, hashtags, CTA, keywords, link, alt
-- text, chapters, links, post type, a "draft"/"approved" lock and per-platform generation settings. It follows the
-- language_variants pattern: saved by save_production in the same transaction, captured in content_versions
-- snapshots, and part of production_copy so editing platform copy after approval returns the item to production.
-- Locking a platform as final (status) or changing its generation settings is not a copy change.
--
-- The general caption column is untouched: existing items keep it as legacy copy, no platform is filled from it, and
-- publishing falls back to it for a platform that has no caption of its own.

begin;

alter table content_items add column if not exists platform_captions jsonb not null default '{}';
alter table content_items drop constraint if exists content_items_platform_captions_object;
alter table content_items add constraint content_items_platform_captions_object check (jsonb_typeof(platform_captions) = 'object');

create or replace function production_copy(c content_items) returns jsonb language sql immutable as $$
  select jsonb_build_object('title',c.title,'hook',c.hook,'caption',c.caption,'main_content',c.main_content,
    'cta',c.cta,'hashtags',c.hashtags,'creative_brief',c.creative_brief,'visual_direction',c.visual_direction,
    'language',c.language,'language_variants',c.language_variants,'platform',c.platform,'format',c.format,
    'target_audience',c.target_audience,'pillar_id',c.pillar_id,'funnel_stage',c.funnel_stage,'media_url',c.media_url,
    'platform_captions',(select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v)='object' then v - 'status' - 'settings' - 'updated_at' else v end), '{}'::jsonb)
      from jsonb_each(coalesce(c.platform_captions,'{}'::jsonb)) e(k,v)));
$$;

-- Same as 0007, plus platform_captions. A caller that doesn't send it (restoring a version saved before 0024) keeps
-- the current platform copy instead of clearing it.
create or replace function save_production(p_project uuid, p_id uuid, p_revision integer, p_values jsonb) returns content_items
language plpgsql security definer set search_path=public as $$
declare c content_items; v content_items;
begin
  if not has_workspace_role(project_workspace(p_project),array['owner','admin','editor']::workspace_role[]) then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_id is not null then
    select * into c from content_items where id=p_id and project_id=p_project for update;
    if c.id is null or not production_can_edit(p_project,p_id) then raise exception 'Content not found or not assigned to you' using errcode='42501'; end if;
    if c.revision<>p_revision then raise exception 'This content changed in another session. Reload before saving.' using errcode='40001'; end if;
  end if;
  if p_values ? 'platform_captions' and jsonb_typeof(p_values->'platform_captions') not in ('object','null') then raise exception 'Platform captions must be an object'; end if;
  v:=jsonb_populate_record(null::content_items,p_values);
  if length(trim(v.title)) not between 1 and 300 or v.platform is null or v.language is null then raise exception 'Title, platform and language are required'; end if;
  if p_id is null then
    insert into content_items(project_id,created_by,title,platform,format,language,hook,caption,main_content,cta,hashtags,creative_brief,visual_direction,target_audience,pillar_id,funnel_stage,assignee_id,due_date,language_variants,platform_captions)
    values(p_project,auth.uid(),v.title,v.platform,v.format,v.language,v.hook,v.caption,v.main_content,v.cta,coalesce(v.hashtags,'{}'),v.creative_brief,v.visual_direction,v.target_audience,v.pillar_id,v.funnel_stage,v.assignee_id,v.due_date,coalesce(v.language_variants,'{}'),coalesce(v.platform_captions,'{}')) returning * into c;
  else
    update content_items set title=v.title,platform=v.platform,format=v.format,language=v.language,hook=v.hook,caption=v.caption,main_content=v.main_content,cta=v.cta,hashtags=coalesce(v.hashtags,'{}'),creative_brief=v.creative_brief,visual_direction=v.visual_direction,target_audience=v.target_audience,pillar_id=v.pillar_id,funnel_stage=v.funnel_stage,assignee_id=v.assignee_id,due_date=v.due_date,language_variants=coalesce(v.language_variants,'{}'),platform_captions=coalesce(v.platform_captions,c.platform_captions,'{}') where id=p_id returning * into c;
  end if;
  return c;
end $$;

revoke all on function save_production(uuid,uuid,integer,jsonb) from public;
grant execute on function save_production(uuid,uuid,integer,jsonb) to authenticated;

commit;
