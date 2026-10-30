-- Smart Ideas Backlog. An idea is a content_items row (single source of truth): it is in the Backlog while it has no
-- calendar date and isn't archived; dragging it onto the calendar sets the date (planning), production keeps its own
-- production_stage, and publishing keeps status/content_publications. This migration only adds idea metadata, the
-- per-project scoring weights and saved Backlog filters. Nothing existing is modified or removed.

begin;

alter table content_items
  add column if not exists description text check (char_length(description) <= 4000),
  add column if not exists tags text[] not null default '{}',
  add column if not exists target_platforms text[] not null default '{}',
  add column if not exists idea_score smallint check (idea_score between 0 and 100),
  -- {criteria: {audience: 0-100, ...}, weights: {...}, explanation, source: 'ai'|'manual', model?, scored_at}
  add column if not exists score_details jsonb,
  -- {date, time, alternatives: [{date, time}], platform, confidence: 'low'|'medium'|'high', reason, source, sample, computed_at}
  add column if not exists suggested_slot jsonb,
  add column if not exists archived_at timestamptz,
  add column if not exists idea_source text check (idea_source in ('manual', 'ai', 'import', 'content', 'campaign', 'pillar', 'opportunity'));

-- Backlog queries: a project's undated, non-archived ideas, sorted by score or recency
create index if not exists content_items_backlog_idx on content_items (project_id, idea_score desc nulls last, created_at desc) where scheduled_date is null and archived_at is null;
create index if not exists content_items_tags_idx on content_items using gin (tags);

-- Scoring weights per brand (project); defaults apply when null
alter table projects add column if not exists idea_score_weights jsonb;

-- Saved Backlog filters, private to each member
create table if not exists backlog_filter_presets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 60),
  filters jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id, name)
);
alter table backlog_filter_presets enable row level security;
create policy "backlog presets: own" on backlog_filter_presets for all
  using (user_id = auth.uid() and is_workspace_member(project_workspace(project_id)))
  with check (user_id = auth.uid() and is_workspace_member(project_workspace(project_id)));

commit;
