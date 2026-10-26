-- Phase 7b — Content Opportunities engine
-- Extends the existing `opportunities` table (already used by Historical Intelligence recommendations) instead of
-- creating a parallel one. Existing rows are kept; the old 'saved' state becomes 'in_progress'.

-- ---------------------------------------------------------------------------
-- Status workflow: new → in_progress → scheduled (added to calendar) → published | dismissed
-- ---------------------------------------------------------------------------
alter table opportunities drop constraint if exists opportunities_state_check;
update opportunities set state = 'in_progress' where state = 'saved';
alter table opportunities add constraint opportunities_state_check
  check (state in ('new', 'in_progress', 'scheduled', 'published', 'dismissed'));

alter table opportunities drop constraint if exists opportunities_source_check;
alter table opportunities add constraint opportunities_source_check
  check (source in ('manual', 'historical_analysis', 'competitor_analysis', 'opportunity_engine'));

-- ---------------------------------------------------------------------------
-- Scoring and generation metadata
--   score_breakdown: {dimensions: {key: {score, weight, basis: 'data'|'ai'|'neutral'|'excluded', reason}}, formula, weights}
--   evidence (existing jsonb): entries now also carry {signal, method, period, metrics, ref_ids}
-- ---------------------------------------------------------------------------
alter table opportunities
  add column score_breakdown jsonb,
  add column focus jsonb not null default '{}',          -- {pillar_id, platform, funnel_stage, instruction} used to generate it
  add column generation_id uuid,                         -- groups opportunities produced by one AI run
  add column updated_at timestamptz not null default now(),
  add column status_changed_at timestamptz;
create trigger set_updated_at before update on opportunities for each row execute function set_updated_at();
create index on opportunities (project_id, opportunity_score desc);

-- Configurable scoring weights per project (null = defaults in the app)
alter table projects add column opportunity_weights jsonb;

-- ---------------------------------------------------------------------------
-- Feedback (one row per click; the latest per user and opportunity is the current one)
-- ---------------------------------------------------------------------------
create table opportunity_feedback (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('useful', 'not_relevant', 'already_covered', 'not_aligned', 'different_angle')),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index on opportunity_feedback (project_id, created_at desc);
create index on opportunity_feedback (opportunity_id);

alter table opportunity_feedback enable row level security;
create policy "opportunity_feedback: members read" on opportunity_feedback for select
  using (is_workspace_member(project_workspace(project_id)));
create policy "opportunity_feedback: editors write" on opportunity_feedback for all
  using (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))
  with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]));

-- ---------------------------------------------------------------------------
-- Cross-project guards (foreign keys are checked without RLS)
-- ---------------------------------------------------------------------------
create or replace function opportunity_same_project() returns trigger language plpgsql as $$
begin
  if new.pillar_id is not null and not exists (select 1 from content_pillars where id = new.pillar_id and project_id = new.project_id) then
    raise exception 'pillar does not belong to this project' using errcode = '23514';
  end if;
  if new.persona_id is not null and not exists (select 1 from personas where id = new.persona_id and project_id = new.project_id) then
    raise exception 'persona does not belong to this project' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger opportunity_same_project before insert or update of pillar_id, persona_id, project_id on opportunities
  for each row execute function opportunity_same_project();

create or replace function linked_opportunity_same_project() returns trigger language plpgsql as $$
begin
  if new.opportunity_id is not null and not exists (select 1 from opportunities where id = new.opportunity_id and project_id = new.project_id) then
    raise exception 'opportunity does not belong to this project' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger linked_opportunity_same_project before insert or update of opportunity_id, project_id on content_items
  for each row execute function linked_opportunity_same_project();
create trigger linked_opportunity_same_project before insert or update of opportunity_id, project_id on opportunity_feedback
  for each row execute function linked_opportunity_same_project();

create index if not exists content_items_opportunity_id_idx on content_items (opportunity_id) where opportunity_id is not null;
