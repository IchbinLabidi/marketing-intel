// Permission catalogue. Mirrors team_all_permissions() / legacy_role_permissions() in
// supabase/migrations/0013_team_collaboration.sql: the database is the authority, this file drives the UI
// and the server-side checks that run before a query.
import type { WorkspaceRole } from "./domain/constants";

export const PERMISSION_GROUPS = [
  {
    key: "workspace",
    label: "Workspace",
    permissions: [
      { key: "team.manage", label: "Manage members and invitations" },
      { key: "roles.manage", label: "Create and edit roles" },
      { key: "settings.manage", label: "Workspace settings" },
      { key: "projects.manage", label: "Create and edit projects" },
      { key: "ai_usage.view", label: "View AI usage and costs" },
    ],
  },
  {
    key: "modules",
    label: "Modules",
    permissions: [
      { key: "strategy.view", label: "View strategy and brand" },
      { key: "strategy.edit", label: "Edit strategy and brand" },
      { key: "intelligence.view", label: "View content history and competitors" },
      { key: "intelligence.edit", label: "Import, sync and manage competitors" },
      { key: "seo.view", label: "View SERP research and SEO briefs" },
      { key: "seo.edit", label: "Run SERP analyses and write briefs" },
      { key: "opportunities.view", label: "View content opportunities" },
      { key: "opportunities.edit", label: "Generate and manage opportunities" },
      { key: "calendar.view", label: "View the editorial calendar" },
      { key: "calendar.edit", label: "Plan and schedule the calendar" },
    ],
  },
  {
    key: "content",
    label: "Ideas, briefs and content",
    permissions: [
      { key: "content.view_all", label: "See all content (not only assigned)" },
      { key: "content.create", label: "Create ideas and briefs" },
      { key: "content.edit_any", label: "Edit any content" },
      { key: "content.assign", label: "Assign tasks and collaborators" },
      { key: "content.review", label: "Internal review" },
      { key: "content.approve", label: "Final approval" },
      { key: "content.approve_own", label: "Approve own work" },
      { key: "content.delete", label: "Delete content" },
      { key: "content.export", label: "Export content" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

const LEGACY_EDITOR: Permission[] = [
  "projects.manage", "ai_usage.view", "strategy.view", "strategy.edit", "intelligence.view", "intelligence.edit",
  "seo.view", "seo.edit", "opportunities.view", "opportunities.edit", "calendar.view", "calendar.edit",
  "content.view_all", "content.create", "content.assign", "content.review", "content.approve_own", "content.delete", "content.export",
];
const LEGACY_VIEWER: Permission[] = [
  "ai_usage.view", "strategy.view", "intelligence.view", "seo.view", "opportunities.view", "calendar.view", "content.view_all",
];

/** Permissions of the previous fixed roles (members without a role row). */
export function legacyPermissions(role: WorkspaceRole): Permission[] {
  if (role === "owner" || role === "admin") return [...ALL_PERMISSIONS];
  return role === "editor" ? [...LEGACY_EDITOR] : [...LEGACY_VIEWER];
}

export const TASK_TYPES = ["copywriting", "design", "video", "seo", "approval", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  copywriting: "Copywriting", design: "Design", video: "Video editing", seo: "SEO", approval: "Approval", other: "Other",
};

export const TASK_STATUSES = ["backlog", "assigned", "in_progress", "in_review", "changes_requested", "approved", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog", assigned: "Assigned", in_progress: "In progress", in_review: "In review",
  changes_requested: "Changes requested", approved: "Approved", completed: "Completed",
};
export const OPEN_TASK_STATUSES: TaskStatus[] = ["backlog", "assigned", "in_progress", "in_review", "changes_requested"];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export type PermissionSet = ReadonlySet<string>;
export const can = (perms: PermissionSet, p: Permission) => perms.has(p);

/** Same rule as the database: you can only hand out (or manage someone with) permissions you hold. */
export function canGrant(mine: PermissionSet, target: readonly string[]) {
  return target.every((p) => mine.has(p));
}

/**
 * Status changes a user may make on a task, mirroring update_task_status():
 * owners move their own work forward, reviewers approve or request changes, managers can do anything.
 */
export function allowedTaskTransitions(
  task: { status: TaskStatus; task_type: TaskType; mine: boolean },
  perms: PermissionSet,
): TaskStatus[] {
  const manager = perms.has("content.assign");
  const reviewer = perms.has("content.approve") || perms.has("content.review");
  const out = new Set<TaskStatus>();
  const closed = task.status === "approved" || task.status === "completed";
  if ((task.mine && !closed) || manager) {
    for (const s of ["backlog", "assigned", "in_progress", "in_review"] as const) out.add(s);
  }
  if (reviewer && task.status === "in_review") {
    out.add("changes_requested");
    if (!task.mine || perms.has("content.approve_own")) out.add("approved");
  }
  if (manager || (task.mine && task.task_type !== "approval" && task.status === "approved")) out.add("completed");
  out.delete(task.status);
  return TASK_STATUSES.filter((s) => out.has(s));
}

/** Which modules a member can open, for navigation and page guards. */
export const MODULE_PERMISSION: Record<string, Permission> = {
  strategy: "strategy.view",
  history: "intelligence.view",
  competitors: "intelligence.view",
  seo: "seo.view",
  opportunities: "opportunities.view",
  calendar: "calendar.view",
};
