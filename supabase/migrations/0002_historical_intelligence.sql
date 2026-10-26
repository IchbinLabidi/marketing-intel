-- Historical Intelligence (Phase 5)
-- Extends the Phase 1 tables instead of adding parallel ones:
--   * historical items link to the project's real content_pillars / campaigns (raw text is kept for traceability)
--   * performance metrics live on both historical items and content_items, always nullable and sourced
--   * AI recommendations are stored as opportunities, linked to the analysis report that produced them

-- ---------------------------------------------------------------------------
-- Imports: dedupe and covered period
-- ---------------------------------------------------------------------------
alter table import_jobs
  add column file_hash text,                 -- sha256 of the uploaded file, used to warn about duplicate imports
  add column file_size int,
  add column sheet_name text,                -- selected worksheet for Excel files
  add column sheet_names text[] not null default '{}',  -- worksheets with data, so the user can switch
  add column period_start date,              -- covered period, computed on import from the imported rows
  add column period_end date,
  add column warnings jsonb not null default '[]',  -- [{row, field, message}] non-blocking issues
  add column excluded_rows int[] not null default '{}',  -- source rows the user explicitly chose not to import
  add column imported_at timestamptz;
create index on import_jobs (project_id, file_hash);

-- ---------------------------------------------------------------------------
-- Historical items: strategy links, missing fields, full metric set
-- ---------------------------------------------------------------------------
alter table historical_content_items
  add column source_row int,                 -- 1-based row in the source file (traceability)
  add column description text,
  add column cta text,
  add column actual_publication_date date,
  add column pillar_id uuid references content_pillars(id) on delete set null,
  add column campaign_id uuid references campaigns(id) on delete set null,
  add column funnel_stage funnel_stage,
  add column likes bigint,
  add column comments bigint,
  add column shares bigint,
  add column saves bigint,
  add column video_views bigint,
  add column leads bigint,
  add column subscriptions bigint,
  add column conversions bigint,
  add column updated_at timestamptz not null default now();
create index on historical_content_items (import_job_id);
create index on historical_content_items (project_id, platform);
create index on historical_content_items (pillar_id);
create index on historical_content_items (campaign_id);
create trigger set_updated_at before update on historical_content_items for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Editorial calendar items: actual results once published, repurpose source
-- ---------------------------------------------------------------------------
alter table content_items
  add column historical_source_id uuid references historical_content_items(id) on delete set null,
  add column actual_publication_date date,
  add column metrics_source data_source,
  add column metrics_updated_at timestamptz,
  add column impressions bigint,
  add column reach bigint,
  add column engagements bigint,
  add column clicks bigint,
  add column likes bigint,
  add column comments bigint,
  add column shares bigint,
  add column saves bigint,
  add column video_views bigint,
  add column leads bigint,
  add column subscriptions bigint,
  add column conversions bigint;
create index on content_items (calendar_id);

-- ---------------------------------------------------------------------------
-- Opportunities produced by an analysis
-- ---------------------------------------------------------------------------
alter table opportunities
  add column title text,
  add column suggested_timing text,
  add column source text not null default 'manual' check (source in ('manual', 'historical_analysis', 'competitor_analysis')),
  add column analysis_report_id uuid references analysis_reports(id) on delete set null;
create index on opportunities (analysis_report_id);

-- ---------------------------------------------------------------------------
-- Cross-project reference guard
-- Foreign keys are checked without RLS, so a row could otherwise point at another project's pillar or campaign.
-- ---------------------------------------------------------------------------
create or replace function same_project_refs() returns trigger language plpgsql as $$
begin
  if new.pillar_id is not null and not exists (select 1 from content_pillars where id = new.pillar_id and project_id = new.project_id) then
    raise exception 'pillar does not belong to this project' using errcode = '23514';
  end if;
  if new.campaign_id is not null and not exists (select 1 from campaigns where id = new.campaign_id and project_id = new.project_id) then
    raise exception 'campaign does not belong to this project' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger same_project_refs before insert or update of pillar_id, campaign_id, project_id on historical_content_items
  for each row execute function same_project_refs();
create trigger same_project_refs before insert or update of pillar_id, campaign_id, project_id on content_items
  for each row execute function same_project_refs();

-- import_job_id must belong to the same project as the item
create or replace function same_project_import_job() returns trigger language plpgsql as $$
begin
  if new.import_job_id is not null and not exists (select 1 from import_jobs where id = new.import_job_id and project_id = new.project_id) then
    raise exception 'import job does not belong to this project' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger same_project_import_job before insert or update of import_job_id, project_id on historical_content_items
  for each row execute function same_project_import_job();

-- Storage: replacing a file overwrites the object
create policy "imports: editors update" on storage.objects for update using (
  bucket_id = 'imports' and has_workspace_role(project_workspace(((storage.foldername(name))[1])::uuid), array['owner','admin','editor']::workspace_role[])
);
