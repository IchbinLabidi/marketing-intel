-- AI usage tracking for the multi-provider AI layer (Gemini + Claude). Extends the existing ai_runs request log:
-- one row per AI request with provider, model, tier, billed tokens, estimated cost, duration and attempts.

alter table ai_runs
  add column provider text not null default 'anthropic' check (provider in ('anthropic', 'gemini')),
  add column tier text check (tier in ('light', 'standard', 'premium')),
  add column cached_input_tokens int not null default 0,      -- input served from the provider's prompt cache
  add column cache_write_tokens int not null default 0,       -- input written to the cache (Claude)
  add column cost_usd numeric(12, 6),                         -- estimated from public prices; null = unknown price
  add column duration_ms int,
  add column attempts int not null default 1,                 -- provider calls made for this request (fallback included)
  add column fallback_from text;                              -- "provider:model" that failed before this one answered
alter table ai_runs alter column provider drop default;
create index on ai_runs (workspace_id, feature, created_at desc);

-- Usage grouped by day × provider × model × feature × user × status, for one workspace and period.
-- security invoker: RLS on ai_runs applies, so only members of the workspace get rows.
create or replace function ai_usage_breakdown(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (
  day date, provider text, model text, feature text, created_by uuid, status ai_run_status,
  requests bigint, input_tokens bigint, cached_input_tokens bigint, output_tokens bigint, cost_usd numeric, unpriced bigint
)
language sql stable security invoker set search_path = public as $$
  select (created_at at time zone 'UTC')::date, provider, model, split_part(feature, '.', 1) || '.' || split_part(feature, '.', 2), created_by, status,
         count(*), coalesce(sum(input_tokens + cache_write_tokens), 0), coalesce(sum(cached_input_tokens), 0), coalesce(sum(output_tokens), 0),
         coalesce(sum(cost_usd), 0), count(*) filter (where cost_usd is null and status <> 'running')
  from ai_runs
  where workspace_id = p_workspace and created_at >= p_from and created_at < p_to
  group by 1, 2, 3, 4, 5, 6
$$;

-- Estimated spend of a workspace since a date (budget guard).
create or replace function ai_cost_since(p_workspace uuid, p_from timestamptz)
returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from ai_runs where workspace_id = p_workspace and created_at >= p_from
$$;
