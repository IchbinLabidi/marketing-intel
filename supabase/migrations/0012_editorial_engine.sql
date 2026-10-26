-- Editorial Intelligence Engine. Additive: existing calendars, posts and opportunities are kept unchanged.
-- A planned calendar goes draft → planned (content mix approved) → generated → approved (posts moved to production).

alter table editorial_calendars
  add column status text not null default 'saved' check (status in ('draft', 'planned', 'generated', 'approved', 'saved')),
  add column objective text,                    -- business objective of the month (awareness, leads…)
  add column plan jsonb,                        -- content mix: totals by platform / pillar / funnel / format, campaigns, dates
  add column sources jsonb,                     -- which data sources were available when it was planned
  add column optimizer jsonb,                   -- latest balance / repetition / workload report
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz;
-- calendars created before the engine (Historical Intelligence, manual) keep status 'saved'

alter table content_items
  add column locked boolean not null default false,  -- kept as is when the calendar or its week is regenerated
  add column topic text,
  add column content_angle text,
  add column rationale text,                         -- why this post is in the plan
  add column format_details jsonb,                   -- reel {hook, script, scenes, on_screen_text, cta} | carousel {cover, slides, final_cta} | article {…}
  add column objective_kpi text,                     -- the metric that judges this post (reach, engagement_rate, saves, clicks…)
  add column repetition jsonb;                       -- latest repetition check: [{with, kind, similarity, verdict, note}]

alter table opportunities
  add column campaign_id uuid references campaigns(id) on delete set null,
  add column production_effort text check (production_effort in ('low', 'medium', 'high')),
  add column calendar_id uuid references editorial_calendars(id) on delete set null;
create index on opportunities (calendar_id) where calendar_id is not null;

-- Cost per calendar: AI requests made while planning / generating a calendar
alter table ai_runs add column calendar_id uuid references editorial_calendars(id) on delete set null;
create index on ai_runs (calendar_id) where calendar_id is not null;

-- Opportunities may only reference this project's pillars, personas, campaigns and calendars
create or replace function opportunity_same_project() returns trigger language plpgsql as $$
begin
  if new.pillar_id is not null and not exists (select 1 from content_pillars where id = new.pillar_id and project_id = new.project_id) then
    raise exception 'pillar does not belong to this project' using errcode = '23514';
  end if;
  if new.persona_id is not null and not exists (select 1 from personas where id = new.persona_id and project_id = new.project_id) then
    raise exception 'persona does not belong to this project' using errcode = '23514';
  end if;
  if new.campaign_id is not null and not exists (select 1 from campaigns where id = new.campaign_id and project_id = new.project_id) then
    raise exception 'campaign does not belong to this project' using errcode = '23514';
  end if;
  if new.calendar_id is not null and not exists (select 1 from editorial_calendars where id = new.calendar_id and project_id = new.project_id) then
    raise exception 'calendar does not belong to this project' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger opportunity_same_project on opportunities;
create trigger opportunity_same_project before insert or update of pillar_id, persona_id, campaign_id, calendar_id, project_id on opportunities
  for each row execute function opportunity_same_project();

-- AI requests may only be attached to a calendar of their own workspace
create or replace function ai_run_same_workspace() returns trigger language plpgsql as $$
begin
  if new.calendar_id is not null and not exists (
    select 1 from editorial_calendars c join projects p on p.id = c.project_id where c.id = new.calendar_id and p.workspace_id = new.workspace_id
  ) then
    raise exception 'calendar does not belong to this workspace' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger ai_run_same_workspace before insert or update of calendar_id, workspace_id on ai_runs
  for each row execute function ai_run_same_workspace();
