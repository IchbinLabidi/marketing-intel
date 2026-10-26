-- SERP Intelligence. On-demand Google SERP analyses from an approved data provider (server-side API key).
-- Each run is a dated snapshot; re-running a keyword adds a snapshot (comparisons), it never overwrites one.
-- Keyword opportunities are rows of the existing opportunities table (source serp_analysis, details in `seo`).

-- One analysis run = one SERP snapshot for keyword × country × language × engine × device
create table serp_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  keyword text not null check (length(trim(keyword)) between 1 and 200),
  keyword_normalized text not null,
  country text not null check (country ~ '^[a-z]{2}$'),
  language text not null check (language ~ '^[a-z]{2}$'),
  search_engine text not null default 'google' check (search_engine in ('google')),
  device text not null check (device in ('desktop', 'mobile')),
  location text,
  provider text not null,
  provider_search_id text,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error text,
  total_results bigint,
  features text[] not null default '{}',           -- SERP features present (featured_snippet, people_also_ask, local_pack…)
  intent jsonb,                                    -- deterministic, SERP-based classification with its signals
  competitors jsonb,                               -- calculated: ranking pages analysed (content type, headings, depth)
  ai_analysis jsonb,                               -- AI interpretation (labelled), optional
  fetched_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on serp_analyses (project_id, keyword_normalized, country, language, device, created_at desc);
create index on serp_analyses (project_id, created_at desc);

-- Every SERP element as returned by the provider (organic results, snippets, questions, local, images, videos…)
create table serp_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  analysis_id uuid not null references serp_analyses(id) on delete cascade,
  type text not null check (type in ('organic', 'featured_snippet', 'people_also_ask', 'related_search', 'local', 'image', 'video', 'top_story', 'knowledge_graph', 'ad', 'shopping', 'other')),
  position integer,
  title text,
  url text,
  domain text,
  snippet text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on serp_items (analysis_id, type, position);
create index on serp_items (project_id, domain);

-- SEO content briefs (AI, labelled), optionally linked to an opportunity and to the calendar item created from it
create table seo_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  analysis_id uuid references serp_analyses(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  content_item_id uuid references content_items(id) on delete set null,
  keyword text not null,
  country text not null,
  language text not null,
  brief jsonb not null,
  draft text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on seo_briefs (project_id, created_at desc);
create trigger set_updated_at before update on seo_briefs for each row execute function set_updated_at();

-- Opportunities from SERP analysis keep their SEO fields (keyword, intent, country, language, slug, outline, evidence)
alter table opportunities drop constraint if exists opportunities_source_check;
alter table opportunities add constraint opportunities_source_check
  check (source in ('manual', 'historical_analysis', 'competitor_analysis', 'opportunity_engine', 'serp_analysis'));
alter table opportunities add column seo jsonb;
alter table opportunities add column serp_analysis_id uuid references serp_analyses(id) on delete set null;

-- Rows must stay inside one project
create or replace function serp_same_project() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'serp_items' and not exists (select 1 from serp_analyses where id = new.analysis_id and project_id = new.project_id) then
    raise exception 'Analysis belongs to another project';
  end if;
  if tg_table_name = 'seo_briefs' then
    if new.analysis_id is not null and not exists (select 1 from serp_analyses where id = new.analysis_id and project_id = new.project_id) then
      raise exception 'Analysis belongs to another project';
    end if;
    if new.opportunity_id is not null and not exists (select 1 from opportunities where id = new.opportunity_id and project_id = new.project_id) then
      raise exception 'Opportunity belongs to another project';
    end if;
    if new.content_item_id is not null and not exists (select 1 from content_items where id = new.content_item_id and project_id = new.project_id) then
      raise exception 'Content belongs to another project';
    end if;
  end if;
  return new;
end $$;
create trigger serp_same_project before insert or update on serp_items for each row execute function serp_same_project();
create trigger serp_same_project before insert or update on seo_briefs for each row execute function serp_same_project();

do $$
declare t text;
begin
  foreach t in array array['serp_analyses', 'serp_items', 'seo_briefs'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "%1$s: members read" on %1$I for select using (is_workspace_member(project_workspace(project_id)))$p$, t);
    execute format($p$create policy "%1$s: editors write" on %1$I for all
      using (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))
      with check (has_workspace_role(project_workspace(project_id), array['owner','admin','editor']::workspace_role[]))$p$, t);
  end loop;
end $$;
