"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ALL_PERMISSIONS, PRIORITIES, TASK_STATUSES, TASK_TYPES, type Permission } from "@/lib/permissions";
import { zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { ACTIVE_WORKSPACE_COOKIE, getActiveWorkspace } from "@/server/services/workspaces";
import { assertPermission, isMissingTeamSchema, listItemTasks, type Task } from "@/server/services/team";
import { appUrl } from "@/server/meta/config";

function failure(e: unknown): ActionResult<never> {
  if (isMissingTeamSchema(e)) return { ok: false, error: "Team features need database migration 0013. Ask your administrator to apply it." };
  const message = e && typeof e === "object" && "message" in e ? String(e.message) : "The request could not be completed. Please try again.";
  return { ok: false, error: message };
}

/** Workspace actions always target the active workspace, never one passed by the client. */
async function workspace() {
  await requireUser();
  const ws = await getActiveWorkspace();
  if (!ws) throw new Error("No workspace");
  return ws;
}

const refreshTeam = () => {
  revalidatePath("/team", "layout");
  revalidatePath("/", "layout");
};

// ---------------------------------------------------------------------------
// Invitations and members
// ---------------------------------------------------------------------------
export async function inviteMemberAction(input: { email: string; roleId: string }): Promise<ActionResult<{ link: string }>> {
  const parsed = z.object({ email: z.email("Enter a valid email address").trim().toLowerCase(), roleId: z.uuid("Choose a role") }).safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage", "Only team managers can invite members.");
    const db = await createClient();
    const { data, error } = await db.rpc("create_invitation", { p_workspace: ws.id, p_email: parsed.data.email, p_role: parsed.data.roleId });
    if (error) throw error;
    refreshTeam();
    return { ok: true, data: { link: `${appUrl()}/invite/${data as string}` }, message: "Invitation created" };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeInvitationAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid invitation" };
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage");
    const db = await createClient();
    const { error } = await db.rpc("revoke_invitation", { p_invitation: id });
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: "Invitation revoked" };
  } catch (e) {
    return failure(e);
  }
}

export async function setMemberRoleAction(userId: string, roleId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success || !z.uuid().safeParse(roleId).success) return { ok: false, error: "Invalid member or role" };
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage", "Only team managers can change roles.");
    const db = await createClient();
    const { error } = await db.rpc("set_member_role", { p_workspace: ws.id, p_user: userId, p_role: roleId });
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: "Role updated" };
  } catch (e) {
    return failure(e);
  }
}

export async function removeMemberAction(userId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: "Invalid member" };
  try {
    const ws = await workspace();
    const db = await createClient();
    const { error } = await db.rpc("remove_member", { p_workspace: ws.id, p_user: userId });
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: "Member removed" };
  } catch (e) {
    return failure(e);
  }
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, error: "This invitation link is not valid." };
  try {
    await requireUser();
    const db = await createClient();
    const { data, error } = await db.rpc("accept_invitation", { p_token: token });
    if (error) throw error;
    // Open the workspace the person just joined.
    if (typeof data === "string") {
      (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, data, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Welcome to the team" };
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const roleSchema = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  description: z.string().trim().max(300).default(""),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
});

export async function saveRoleAction(id: string | null, input: unknown): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "roles.manage", "Only role managers can edit roles.");
    const db = await createClient();
    const { name, description, permissions } = parsed.data;
    const base_role = permissions.includes("team.manage") ? "admin" : "editor";
    if (id) {
      const { error } = await db.from("workspace_roles").update({ name, description, permissions, base_role }).eq("id", id).eq("workspace_id", ws.id);
      if (error) throw error;
    } else {
      const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "role"}_${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await db.from("workspace_roles").insert({ workspace_id: ws.id, key, name, description, permissions, base_role });
      if (error) throw error;
    }
    refreshTeam();
    return { ok: true, message: id ? "Role updated" : "Role created" };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid role" };
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "roles.manage");
    const db = await createClient();
    const { error, count } = await db.from("workspace_roles").delete({ count: "exact" }).eq("id", id).eq("workspace_id", ws.id);
    if (error) throw error;
    if (!count) throw new Error("Role not found");
    refreshTeam();
    return { ok: true, message: "Role deleted" };
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Tasks on ideas and briefs
// ---------------------------------------------------------------------------
const taskSchema = z.object({
  userId: z.uuid("Choose a team member"),
  taskType: z.enum(TASK_TYPES),
  priority: z.enum(PRIORITIES).default("medium"),
  dueDate: z.union([z.iso.date(), z.literal("")]).nullish().transform((v) => v || null),
  note: z.string().trim().max(2000).default(""),
});

export async function assignTaskAction(projectId: string, itemId: string, input: unknown): Promise<ActionResult<Task[]>> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await requireUser();
    const { project } = await getProjectContext(projectId);
    await assertPermission(project.workspace_id, "content.assign", "Only managers can assign tasks.");
    const db = await createClient();
    const { userId, taskType, priority, dueDate, note } = parsed.data;
    const { error } = await db.rpc("assign_task", { p_project: projectId, p_item: itemId, p_user: userId, p_task_type: taskType, p_priority: priority, p_due: dueDate, p_note: note });
    if (error) throw error;
    revalidatePath(`/p/${projectId}`, "layout");
    revalidatePath("/tasks");
    return { ok: true, data: await listItemTasks(projectId, itemId), message: "Task assigned" };
  } catch (e) {
    return failure(e);
  }
}

export async function removeTaskAction(projectId: string, itemId: string, taskId: string): Promise<ActionResult<Task[]>> {
  if (!z.uuid().safeParse(taskId).success) return { ok: false, error: "Invalid task" };
  try {
    await requireUser();
    const { project } = await getProjectContext(projectId);
    await assertPermission(project.workspace_id, "content.assign");
    const db = await createClient();
    const { error } = await db.rpc("remove_task", { p_assignment: taskId });
    if (error) throw error;
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, data: await listItemTasks(projectId, itemId), message: "Task removed" };
  } catch (e) {
    return failure(e);
  }
}

export async function updateTaskStatusAction(taskId: string, status: string, comment = ""): Promise<ActionResult<Task>> {
  const parsed = z.object({ taskId: z.uuid(), status: z.enum(TASK_STATUSES), comment: z.string().trim().max(2000) }).safeParse({ taskId, status, comment });
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await requireUser();
    const db = await createClient();
    // Authorization (owner / reviewer / manager, no self-approval) is enforced by update_task_status().
    const { data, error } = await db.rpc("update_task_status", { p_assignment: parsed.data.taskId, p_status: parsed.data.status, p_comment: parsed.data.comment });
    if (error) throw error;
    const task = data as Task;
    revalidatePath(`/p/${task.project_id}`, "layout");
    revalidatePath("/tasks");
    return { ok: true, data: task, message: "Task updated" };
  } catch (e) {
    return failure(e);
  }
}

export async function setContentPriorityAction(projectId: string, itemId: string, priority: string): Promise<ActionResult> {
  const parsed = z.enum(PRIORITIES).safeParse(priority);
  if (!parsed.success) return { ok: false, error: "Invalid priority" };
  try {
    await requireUser();
    const { project } = await getProjectContext(projectId);
    await assertPermission(project.workspace_id, "content.assign", "Only managers can change priority.");
    const db = await createClient();
    const { error, count } = await db.from("content_items").update({ priority: parsed.data }, { count: "exact" }).eq("project_id", projectId).eq("id", itemId);
    if (error) throw error;
    if (!count) throw new Error("Content not found or not editable by you.");
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, message: "Priority updated" };
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function markNotificationsReadAction(ids?: string[]): Promise<ActionResult> {
  try {
    const ws = await workspace();
    const db = await createClient();
    let q = db.from("notifications").update({ read_at: new Date().toISOString() }).eq("workspace_id", ws.id).is("read_at", null);
    if (ids?.length) q = q.in("id", ids.filter((id) => z.uuid().safeParse(id).success));
    const { error } = await q;
    if (error) throw error;
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
