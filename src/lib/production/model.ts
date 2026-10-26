import { canAdmin, canEdit, type Language, type WorkspaceRole } from "@/lib/domain/constants";
import type { ContentItem } from "@/types/domain";

export const STAGES = ["idea", "brief", "in_production", "internal_review", "approval", "ready", "published"] as const;
export type ProductionStage = typeof STAGES[number];
export const STAGE_LABELS: Record<ProductionStage, string> = { idea: "Idea", brief: "Brief", in_production: "In Production", internal_review: "Internal Review", approval: "Client/Manager Approval", ready: "Ready to Publish", published: "Published" };
export const FORMATS = ["Social caption", "Instagram Reel", "Facebook video", "Carousel", "Story sequence", "Educational post", "Promotional post", "Product announcement", "Creative brief", "Visual direction"] as const;
export const WRITING_FIELDS = ["title", "hook", "caption", "main_content", "cta", "hashtags", "creative_brief", "visual_direction"] as const;
export type Writing = { title: string; hook: string; caption: string; main_content: string; cta: string; hashtags: string[]; creative_brief: string; visual_direction: string };
export type ProductionItem = ContentItem & { language: Language; main_content: string | null; visual_direction: string | null; target_audience: string | null; production_stage: ProductionStage; assignee_id: string | null; due_date: string | null; created_by: string | null; created_at: string; revision: number; approved_by: string | null; approved_at: string | null; language_variants: Partial<Record<Language, Writing>> };
export type ProductionEvent = { id: string; content_item_id: string; actor_id: string | null; kind: string; body: string; mentions: string[]; revision: number; created_at: string };
export type ProductionVersion = { id: string; revision: number; actor_id: string | null; snapshot: ProductionItem; created_at: string };
export type ProductionAsset = { id: string; body: { name: string; url?: string; path?: string; mime?: string }; created_at: string; signedUrl?: string };
export type ContentTemplate = { id: string; name: string; description: string; body: Record<string, unknown>; created_by: string | null; created_at: string };
export type WorkflowSettings = { require_internal_review: boolean; labels: Partial<Record<ProductionStage, string>> };
export const DEFAULT_WORKFLOW: WorkflowSettings = { require_internal_review: true, labels: {} };
export function canWriteItem(role: WorkspaceRole, userId: string, item: Pick<ProductionItem, "assignee_id" | "created_by">) {
  return canAdmin(role) || (canEdit(role) && (item.assignee_id === userId || (!item.assignee_id && item.created_by === userId)));
}
export function writingOf(item: Partial<Writing>): Writing {
  return { title: item.title ?? "", hook: item.hook ?? "", caption: item.caption ?? "", main_content: item.main_content ?? "", cta: item.cta ?? "", hashtags: item.hashtags ?? [], creative_brief: item.creative_brief ?? "", visual_direction: item.visual_direction ?? "" };
}
export function isRTL(language: string) { return language === "ar" || language === "ar_tn"; }
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return [...WRITING_FIELDS, "platform", "format", "language", "language_variants", "target_audience", "pillar_id", "funnel_stage", "assignee_id", "due_date", "production_stage", "scheduled_date", "scheduled_time", "media_url"].filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
}
