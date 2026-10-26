import type { ContentStatus, FunnelStage, InsightType, Language, Metric, Platform, WorkspaceRole } from "@/lib/domain/constants";

export type Workspace = { id: string; name: string; role: WorkspaceRole };

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  industry: string | null;
  website: string | null;
  default_language: Language;
  timezone: string;
  opportunity_weights?: unknown;
  production_workflow?: import("@/lib/production/model").WorkflowSettings;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductService = { name: string; description?: string };

export type BrandProfile = {
  project_id: string;
  brand_name: string | null;
  mission: string | null;
  vision: string | null;
  values: string[];
  personality: string | null;
  visual_identity: string | null;
  target_audience: string | null;
  products_services: ProductService[];
  differentiators: string | null;
};

export type ProjectChannel = {
  id: string;
  project_id: string;
  platform: Platform;
  handle: string | null;
  url: string | null;
  is_active: boolean;
  target_posts_per_week: number | null;
};

export type BrandVoice = { tone?: string | null; do?: string | null; dont?: string | null; vocabulary?: string | null; examples?: string | null };
export type JourneyStage = { stage: string; goal?: string | null; touchpoints?: string | null; content_needs?: string | null };

export type Strategy = {
  project_id: string;
  business_objectives: string | null;
  marketing_objectives: string | null;
  brand_positioning: string | null;
  value_proposition: string | null;
  brand_voice: BrandVoice;
  customer_journey: JourneyStage[];
  funnel: Partial<Record<FunnelStage, string>>;
  updated_at: string;
};

export type Persona = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  demographics: string | null;
  goals: string | null;
  pain_points: string | null;
  objections: string | null;
  preferred_platforms: Platform[];
};

export type ContentPillar = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_share: number | null;
  color: string | null;
};

export type Campaign = {
  id: string;
  project_id: string;
  name: string;
  objective: string | null;
  description: string | null;
  starts_on: string | null;
  ends_on: string | null;
  funnel_focus: FunnelStage | null;
};

export type Kpi = {
  id: string;
  project_id: string;
  name: string;
  target_value: string | null;
  unit: string | null;
  period: string | null;
  funnel_stage: FunnelStage | null;
};

export type MetricValues = Partial<Record<Metric, number | null>>;

export type ImportStatus = "uploaded" | "extracted" | "mapped" | "validated" | "imported" | "failed";
export type RowIssue = { row: number; field: string; message: string };

export type ImportJob = {
  id: string;
  project_id: string;
  file_name: string;
  file_type: "csv" | "xlsx" | "pdf";
  storage_path: string | null;
  status: ImportStatus;
  label: string | null;
  reference_year: number | null;
  raw_columns: string[];
  raw_rows: Record<string, string>[];
  column_mapping: Record<string, string>;
  validation_errors: RowIssue[];
  warnings: RowIssue[];
  excluded_rows: number[];
  imported_count: number;
  error: string | null;
  file_hash: string | null;
  file_size: number | null;
  sheet_name: string | null;
  sheet_names: string[];
  period_start: string | null;
  period_end: string | null;
  imported_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HistoricalItem = MetricValues & {
  id: string;
  project_id: string;
  import_job_id: string | null;
  source_row: number | null;
  publication_date: string | null;
  actual_publication_date: string | null;
  platform: Platform | null;
  platform_raw: string | null;
  title: string | null;
  topic: string | null;
  description: string | null;
  content_pillar: string | null;
  pillar_id: string | null;
  format: string | null;
  marketing_objective: string | null;
  caption: string | null;
  cta: string | null;
  campaign: string | null;
  campaign_id: string | null;
  funnel_stage: FunnelStage | null;
  product: string | null;
  publication_status: string | null;
  extra: Record<string, unknown>;
  source: "manual" | "csv" | "xlsx" | "pdf" | "meta_api" | "youtube_api" | "linkedin_api" | "tiktok_api";
  external_id: string | null;
  permalink: string | null;
  media_type: string | null;
  media_product_type: string | null;
  metrics_raw: Record<string, number>;
  metrics_updated_at: string | null;
  pillar_assigned_by: "import" | "user" | "ai" | null;
  published_at: string | null;
};

export type MetaConnection = {
  id: string;
  project_id: string;
  status: "pending_page" | "active" | "expired" | "error" | "disconnected";
  fb_user_id: string | null;
  fb_user_name: string | null;
  page_id: string | null;
  page_name: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  granted_scopes: string[];
  declined_scopes: string[];
  token_expires_at: string | null;
  supported_metrics: MetaSupportedMetrics;
  backfill: Partial<Record<"facebook" | "instagram", "done" | "pending">>;
  auto_sync: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_error: string | null;
  created_at: string;
};

/** Learned per account: which insight metrics the API accepted ("ok") or rejected, per surface. */
export type MetaSupportedMetrics = Partial<Record<string, { ok: string[]; rejected: string[] }>>;

export type MetaSyncRun = {
  id: string;
  kind: "initial" | "incremental" | "refresh";
  trigger: "manual" | "auto" | "scheduled";
  status: "running" | "succeeded" | "partial" | "failed";
  stats: { facebook?: SyncCounts; instagram?: SyncCounts; api_calls?: number; truncated?: boolean };
  errors: { platform: string; code?: number | string; message: string }[];
  started_at: string;
  finished_at: string | null;
};
export type SyncCounts = { fetched: number; created: number; updated: number; metrics: number };

export type AnalysisReport = {
  id: string;
  project_id: string;
  kind: "historical" | "competitor" | "comparison";
  title: string;
  scope: Record<string, unknown>;
  result: Record<string, unknown>;
  model: string | null;
  created_at: string;
};

export type Opportunity = {
  id: string;
  project_id: string;
  title: string | null;
  idea: string;
  rationale: string;
  target_audience: string | null;
  persona_id: string | null;
  marketing_objective: string | null;
  pillar_id: string | null;
  funnel_stage: FunnelStage | null;
  platform: Platform | null;
  format: string | null;
  hook: string | null;
  creative_angle: string | null;
  cta: string | null;
  evidence: OpportunityEvidence[];
  insight_type: InsightType;
  opportunity_score: number | null;
  confidence: "low" | "medium" | "high" | null;
  suggested_timing: string | null;
  state: OpportunityState;
  source: string;
  analysis_report_id: string | null;
  score_breakdown: import("@/lib/opportunities/scoring").ScoreBreakdown | null;
  /** SEO opportunities (SERP Intelligence): keyword, intent, market, slug, outline */
  seo?: { keyword: string; intent: string; country: string; language: string; content_type: string; slug: string; outline: string[]; kind: string } | null;
  serp_analysis_id?: string | null;
  campaign_id?: string | null;
  production_effort?: "low" | "medium" | "high" | null;
  /** editorial calendar this opportunity was generated for or attached to */
  calendar_id?: string | null;
  focus: { pillar_id?: string | null; platform?: string | null; funnel_stage?: string | null; instruction?: string | null };
  generation_id: string | null;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OpportunityState = "new" | "in_progress" | "scheduled" | "published" | "dismissed";

/**
 * Evidence entry. Engine rows carry the full signal snapshot (statement, method, period, metrics, posts); older
 * history recommendations only have {type, ref_id, note}.
 */
export type OpportunityEvidence = {
  type: string; // historical | statistic | strategy | competitor | ai_reasoning
  ref_id?: string | null;
  note: string;
  signal?: string;
  kind?: string;
  method?: string;
  period?: { from: string | null; to: string | null };
  metrics?: Record<string, number | string | null>;
  ref_ids?: string[];
  n?: number;
};

export type OpportunityFeedback = {
  id: string;
  project_id: string;
  opportunity_id: string;
  user_id: string | null;
  kind: import("@/lib/opportunities/scoring").FeedbackKind;
  note: string | null;
  created_at: string;
};

export type EditorialCalendar = {
  id: string;
  project_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  settings: Record<string, unknown>;
  created_at: string;
};

export type ContentItem = MetricValues & {
  production_stage?: import("@/lib/production/model").ProductionStage;
  id: string;
  project_id: string;
  calendar_id: string | null;
  opportunity_id: string | null;
  historical_source_id: string | null;
  scheduled_date: string | null;
  platform: Platform | null;
  title: string;
  format: string | null;
  pillar_id: string | null;
  campaign_id: string | null;
  marketing_objective: string | null;
  funnel_stage: FunnelStage | null;
  hook: string | null;
  caption: string | null;
  cta: string | null;
  creative_brief: string | null;
  /** long-form body (Content Production, SEO article drafts) */
  main_content?: string | null;
  language?: import("@/lib/domain/constants").Language | null;
  hashtags: string[];
  status: ContentStatus;
  scheduled_time: string | null;
  scheduled_at: string | null;
  media_url: string | null;
  published_at: string | null;
  published_url: string | null;
  publish_error: string | null;
  updated_at: string;
};

export type StrategyBundle = {
  strategy: Strategy | null;
  personas: Persona[];
  pillars: ContentPillar[];
  campaigns: Campaign[];
  kpis: Kpi[];
};
