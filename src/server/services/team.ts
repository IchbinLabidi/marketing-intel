import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { legacyPermissions, type Permission, type Priority, type TaskStatus, type TaskType } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/domain/constants";
import { getWorkspaceRole } from "./workspaces";

/** True when migration 0013 has not been applied yet (team tables/functions missing). */
export function isMissingTeamSchema(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "42883" || code === "42P01" || code === "PGRST202" || code === "PGRST205" || /schema cache|does not exist|Could not find the function/.test(message);
}

/**
 * The current user's permissions in a workspace, as computed by the database (my_permissions()).
 * Falls back to the previous fixed roles while migration 0013 is not applied, so nothing breaks before it runs.
 */
export const getPermissions = cache(async (workspaceId: string): Promise<Set<string>> => {
  const role = await getWorkspaceRole(workspaceId);
  if (!role) return new Set();
  const db = await createClient();
  const { data, error } = await db.rpc("my_permissions", { ws: workspaceId });
  if (error) {
    if (isMissingTeamSchema(error)) return new Set(legacyPermissions(role));
    throw error;
  }
  return new Set((data as string[] | null) ?? []);
});

export async function hasPermission(workspaceId: string, permission: Permission) {
  return (await getPermissions(workspaceId)).has(permission);
}

/** For server actions: throws a readable error when the permission is missing. */
export async function assertPermission(workspaceId: string, permission: Permission, message?: string) {
  if (!(await hasPermission(workspaceId, permission))) throw new Error(message ?? "You don't have permission to do this.");
}

export const teamSchemaReady = cache(async (): Promise<boolean> => {
  const db = await createClient();
  const { error } = await db.from("workspace_roles").select("id").limit(1);
  return !error || !isMissingTeamSchema(error);
});

// ---------------------------------------------------------------------------
// Members, roles, invitations
// ---------------------------------------------------------------------------
export type TeamRole = {
  id: string; key: string; name: string; description: string; base_role: WorkspaceRole; permissions: string[]; is_system: boolean;
};
export type TeamMember = {
  user_id: string; full_name: string; email: string | null; role: WorkspaceRole; role_id: string | null; joined_at: string;
};
export type Invitation = {
  id: string; email: string; role_id: string; created_at: string; expires_at: string; accepted_at: string | null; revoked_at: string | null;
};
export type AuditEntry = { id: string; actor_id: string | null; action: string; target_user: string | null; details: Record<string, unknown>; created_at: string };

export const listRoles = cache(async (workspaceId: string): Promise<TeamRole[]> => {
  const db = await createClient();
  const { data, error } = await db.from("workspace_roles").select("id, key, name, description, base_role, permissions, is_system").eq("workspace_id", workspaceId).order("is_system", { ascending: false }).order("created_at");
  if (error) {
    if (isMissingTeamSchema(error)) return [];
    throw error;
  }
  return data as TeamRole[];
});

export const listTeam = cache(async (workspaceId: string): Promise<TeamMember[]> => {
  const db = await createClient();
  const { data, error } = await db.rpc("workspace_directory", { p_workspace: workspaceId });
  if (error) {
    if (!isMissingTeamSchema(error)) throw error;
    // Before the migration: plain member list.
    const { data: members, error: e2 } = await db.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId).order("created_at");
    if (e2) throw e2;
    const ids = (members ?? []).map((m) => m.user_id);
    const { data: profiles } = ids.length ? await db.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? ""]));
    return (members ?? []).map((m) => ({ user_id: m.user_id, full_name: names.get(m.user_id) ?? "", email: null, role: m.role as WorkspaceRole, role_id: null, joined_at: m.created_at }));
  }
  return data as TeamMember[];
});

/** Members with their role name, for assignee and collaborator pickers. */
export async function assignablePeople(workspaceId: string) {
  const [team, roles] = await Promise.all([listTeam(workspaceId), listRoles(workspaceId)]);
  const roleNames = new Map(roles.map((r) => [r.id, r.name]));
  return team.map((m) => ({
    user_id: m.user_id,
    name: m.full_name,
    roleName: (m.role_id && roleNames.get(m.role_id)) || (m.role === "owner" ? "Owner" : m.role[0].toUpperCase() + m.role.slice(1)),
    canEdit: m.role !== "viewer",
  }));
}

export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const db = await createClient();
  const { data, error } = await db.from("workspace_invitations").select("id, email, role_id, created_at, expires_at, accepted_at, revoked_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100);
  if (error) {
    if (isMissingTeamSchema(error)) return [];
    throw error;
  }
  return data as Invitation[];
}

export async function listAudit(workspaceId: string, limit = 50): Promise<AuditEntry[]> {
  const db = await createClient();
  const { data, error } = await db.from("workspace_audit_log").select("id, actor_id, action, target_user, details, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (isMissingTeamSchema(error)) return [];
    throw error;
  }
  return data as AuditEntry[];
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export type Task = {
  id: string; project_id: string; content_item_id: string; user_id: string; task_type: TaskType; status: TaskStatus;
  priority: Priority; due_date: string | null; note: string; created_by: string | null; created_at: string; updated_at: string;
};
export type TaskWithContent = Task & {
  content: { id: string; title: string; production_stage: string; platform: string | null; priority: Priority } | null;
  project: { id: string; name: string } | null;
};

export async function listItemTasks(projectId: string, itemId: string): Promise<Task[]> {
  const db = await createClient();
  const { data, error } = await db.from("content_assignments").select("*").eq("project_id", projectId).eq("content_item_id", itemId).order("created_at");
  if (error) {
    if (isMissingTeamSchema(error)) return [];
    throw error;
  }
  return data as Task[];
}

/** Tasks of several content items at once (calendar cards and panels). */
export async function listTasksForItems(projectId: string, itemIds: string[]): Promise<Task[]> {
  if (!itemIds.length) return [];
  const db = await createClient();
  const out: Task[] = [];
  for (let i = 0; i < itemIds.length; i += 300) {
    const { data, error } = await db.from("content_assignments").select("*").eq("project_id", projectId).in("content_item_id", itemIds.slice(i, i + 300));
    if (error) {
      if (isMissingTeamSchema(error)) return [];
      throw error;
    }
    out.push(...(data as Task[]));
  }
  return out;
}

/** Tasks across the workspace's projects (RLS limits them to what the user may see). */
export async function listWorkspaceTasks(workspaceId: string, opts: { userId?: string; limit?: number } = {}): Promise<TaskWithContent[]> {
  const db = await createClient();
  const { data: projects, error: pe } = await db.from("projects").select("id, name").eq("workspace_id", workspaceId);
  if (pe) throw pe;
  const ids = (projects ?? []).map((p) => p.id as string);
  if (!ids.length) return [];
  let q = db.from("content_assignments").select("*, content:content_items(id, title, production_stage, platform, priority)").in("project_id", ids);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(opts.limit ?? 500);
  if (error) {
    if (isMissingTeamSchema(error)) return [];
    throw error;
  }
  const names = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  return (data as (Task & { content: TaskWithContent["content"] })[]).map((t) => ({ ...t, project: { id: t.project_id, name: names.get(t.project_id) ?? "" } }));
}

export async function countOpenTasks(projectIds: string[], userId: string): Promise<number> {
  if (!projectIds.length) return 0;
  const db = await createClient();
  const { count, error } = await db.from("content_assignments").select("id", { count: "exact", head: true })
    .eq("user_id", userId).in("project_id", projectIds).in("status", ["backlog", "assigned", "in_progress", "changes_requested"]);
  return error ? 0 : count ?? 0;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export type Notification = {
  id: string; kind: string; project_id: string | null; content_item_id: string | null; actor_id: string | null; body: string; read_at: string | null; created_at: string;
};

export async function listNotifications(workspaceId: string, limit = 50): Promise<Notification[]> {
  const db = await createClient();
  const { data, error } = await db.from("notifications").select("id, kind, project_id, content_item_id, actor_id, body, read_at, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (isMissingTeamSchema(error)) return [];
    throw error;
  }
  return data as Notification[];
}

export const unreadNotificationCount = cache(async (workspaceId: string): Promise<number> => {
  const db = await createClient();
  const { count, error } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("read_at", null);
  if (error) return 0;
  return count ?? 0;
});
