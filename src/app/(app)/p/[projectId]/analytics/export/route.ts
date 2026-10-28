import { NextResponse, type NextRequest } from "next/server";
import { contentType, inPeriod, isOverdue, localDate } from "@/lib/analytics/compute";
import { toCsv } from "@/lib/analytics/csv";
import { FUNNEL_LABELS, PLATFORM_LABELS, type FunnelStage, type Platform } from "@/lib/domain/constants";
import { STAGE_LABELS, type ProductionStage } from "@/lib/production/model";
import { loadAnalytics } from "@/server/services/analytics";
import { getProjectContext } from "@/server/services/projects";
import { hasPermission } from "@/server/services/team";

/**
 * CSV of the content behind the dashboard, with the same filters. Rows are read through row-level security,
 * and the export needs both calendar access and the content.export permission.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/p/[projectId]/analytics/export">) {
  const { projectId } = await ctx.params;
  const { project } = await getProjectContext(projectId);
  const [canView, canExport] = await Promise.all([hasPermission(project.workspace_id, "calendar.view"), hasPermission(project.workspace_id, "content.export")]);
  if (!canView || !canExport) return NextResponse.json({ error: "You don't have permission to export this data." }, { status: 403 });

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const data = await loadAnalytics(projectId, sp);
  const p = data.params.period, tz = data.tz;
  // Content that touches the period (created, planned, approved or published in it) plus everything still open.
  const rows = data.filtered.filter((i) =>
    inPeriod(i.scheduled_date, p) || inPeriod(localDate(i.created_at, tz), p) || inPeriod(localDate(i.approved_at, tz), p) || inPeriod(localDate(i.published_at, tz), p) ||
    !["approved", "scheduled", "published"].includes(i.status));

  const header = [
    "id", "title", "platform", "content_type", "format", "pillar", "funnel_stage", "campaign", "production_stage", "status", "lead",
    "created_date", "planned_date", "internal_deadline", "approved_date", "published_date", "overdue", "planned_in_period", "published_in_period",
  ];
  const body = rows.map((i) => [
    i.id, i.title, i.platform ? PLATFORM_LABELS[i.platform as Platform] ?? i.platform : "", contentType(i.format), i.format ?? "",
    i.pillar_id ? data.pillarNames[i.pillar_id] ?? "" : "", i.funnel_stage ? FUNNEL_LABELS[i.funnel_stage as FunnelStage] ?? i.funnel_stage : "",
    i.campaign_id ? data.campaignNames[i.campaign_id] ?? "" : "", STAGE_LABELS[(i.production_stage ?? "idea") as ProductionStage] ?? i.production_stage ?? "", i.status,
    i.assignee_id ? data.peopleNames[i.assignee_id] ?? "" : "",
    localDate(i.created_at, tz) ?? "", i.scheduled_date ?? "", i.due_date ?? "", localDate(i.approved_at, tz) ?? "", localDate(i.published_at, tz) ?? "",
    isOverdue(i, data.today) ? "yes" : "no", inPeriod(i.scheduled_date, p) ? "yes" : "no",
    i.status === "published" && inPeriod(localDate(i.published_at, tz), p) ? "yes" : "no",
  ]);
  const name = `analytics-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}-${p.from}-to-${p.to}.csv`;
  return new NextResponse(`﻿${toCsv([header, ...body])}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
