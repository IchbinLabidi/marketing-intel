// Enum values mirror the Postgres enums in supabase/migrations/0001_init.sql.

export const PLATFORMS = [
  "instagram", "facebook", "tiktok", "linkedin", "youtube", "x", "pinterest", "snapchat", "threads", "blog", "newsletter", "other",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X",
  pinterest: "Pinterest", snapchat: "Snapchat", threads: "Threads", blog: "Blog", newsletter: "Newsletter", other: "Other",
};

export const FUNNEL_STAGES = ["awareness", "engagement", "trust", "acquisition", "conversion", "loyalty"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  awareness: "Awareness", engagement: "Engagement", trust: "Trust", acquisition: "Acquisition", conversion: "Conversion", loyalty: "Loyalty",
};

export const LANGUAGES = ["fr", "en", "ar", "ar_tn"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  fr: "French", en: "English", ar: "Arabic (MSA)", ar_tn: "Tunisian Arabic (Derja)",
};

export const CONTENT_STATUSES = [
  "idea", "planned", "brief_ready", "in_production", "in_review", "approved", "scheduled", "published", "failed",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_STATUS_LABELS: Record<ContentStatus, string> = {
  idea: "Idea", planned: "Planned", brief_ready: "Brief ready", in_production: "In production",
  in_review: "In review", approved: "Approved", scheduled: "Scheduled", published: "Published", failed: "Failed",
};

/** Publication workflow shown in the calendar. Several production stages count as a draft. */
export const WORKFLOW_STATES = ["draft", "pending", "approved", "scheduled", "published", "failed"] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  draft: "Draft", pending: "Pending approval", approved: "Approved", scheduled: "Scheduled", published: "Published", failed: "Failed",
};

export const STATUS_TO_WORKFLOW: Record<ContentStatus, WorkflowState> = {
  idea: "draft", planned: "draft", brief_ready: "draft", in_production: "draft",
  in_review: "pending", approved: "approved", scheduled: "scheduled", published: "published", failed: "failed",
};

/** Platforms the calendar supports today; the data model accepts every platform in PLATFORMS. */
export const CALENDAR_PLATFORMS = ["instagram", "facebook"] as const;

// Performance metrics stored on historical items and calendar items. Always nullable: a missing value means "not imported".
export const METRICS = [
  "views", "impressions", "reach", "engagements", "clicks", "likes", "comments", "shares", "saves", "video_views", "leads", "subscriptions", "conversions",
] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABELS: Record<Metric, string> = {
  views: "Views", impressions: "Impressions", reach: "Reach", engagements: "Engagements", clicks: "Clicks", likes: "Likes", comments: "Comments",
  shares: "Shares", saves: "Saves", video_views: "Video views", leads: "Leads", subscriptions: "Subscriptions", conversions: "Conversions",
};

export const INSIGHT_TYPES = ["data_supported", "hypothesis", "experiment"] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export const INSIGHT_LABELS: Record<InsightType, string> = {
  data_supported: "Historical fact", hypothesis: "AI hypothesis", experiment: "Suggested experiment",
};

export const ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof ROLES)[number];

export function canEdit(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "admin" || role === "editor";
}
export function canAdmin(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "admin";
}
