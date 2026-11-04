"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ALL_PERMISSIONS, canGrant, PRIORITIES, TASK_STATUSES, TASK_TYPES, type Permission } from "@/lib/permissions";
import { type ActionResult } from "@/lib/validation/common";
import { zodErrorToResult } from "@/lib/validation/errors";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";
import { ACTIVE_WORKSPACE_COOKIE, getActiveWorkspace } from "@/server/services/workspaces";
import { assertPermission, getPermissions, isMissingTeamSchema, listItemTasks, listRoles, listTeam, type Task } from "@/server/services/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/server/meta/config";
import { getT } from "@/i18n/server";

async function failure(e: unknown): Promise<ActionResult<never>> {
  const t = await getT("team");
  if (isMissingTeamSchema(e)) return { ok: false, error: t("errors.migration") };
  const message = e && typeof e === "object" && "message" in e ? String(e.message) : t("errors.generic");
  return { ok: false, error: message };
}

/** zodErrorToResult, with this module's own schema messages ("team:<key>") translated from the team namespace. */
async function invalid(error: z.ZodError): Promise<ActionResult<never>> {
  const result = await zodErrorToResult(error);
  if (result.ok || !result.fieldErrors) return result;
  const t = await getT("team");
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (issue.message.startsWith("team:")) result.fieldErrors[key] = t(issue.message.slice(5) as Parameters<typeof t>[0]);
  }
  return result;
}

/** Workspace actions always target the active workspace, never one passed by the client. */
async function workspace() {
  await requireUser();
  const ws = await getActiveWorkspace();
  if (!ws) throw new Error((await getT("team"))("errors.noWorkspace"));
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
  const t = await getT("team");
  const parsed = z.object({ email: z.email("team:errors.validEmail").trim().toLowerCase(), roleId: z.uuid("team:errors.chooseRole") }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage", t("errors.onlyManagersInvite"));
    const db = await createClient();
    const { data, error } = await db.rpc("create_invitation", { p_workspace: ws.id, p_email: parsed.data.email, p_role: parsed.data.roleId });
    if (error) throw error;
    refreshTeam();
    return { ok: true, data: { link: `${appUrl()}/invite/${data as string}` }, message: t("messages.invitationCreated") };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeInvitationAction(id: string): Promise<ActionResult> {
  const t = await getT("team");
  if (!z.uuid().safeParse(id).success) return { ok: false, error: t("errors.invalidInvitation") };
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage");
    const db = await createClient();
    const { error } = await db.rpc("revoke_invitation", { p_invitation: id });
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: t("messages.invitationRevoked") };
  } catch (e) {
    return failure(e);
  }
}

export async function setMemberRoleAction(userId: string, roleId: string): Promise<ActionResult> {
  const t = await getT("team");
  if (!z.uuid().safeParse(userId).success || !z.uuid().safeParse(roleId).success) return { ok: false, error: t("errors.invalidMemberOrRole") };
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage", t("errors.onlyManagersRoles"));
    const db = await createClient();
    const { error } = await db.rpc("set_member_role", { p_workspace: ws.id, p_user: userId, p_role: roleId });
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: t("messages.roleUpdated") };
  } catch (e) {
    return failure(e);
  }
}

export async function renameMemberAction(userId: string, name: string): Promise<ActionResult> {
  const t = await getT("team");
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: t("errors.invalidMember") };
  const parsed = z.string().trim().min(1).max(80).safeParse(name);
  if (!parsed.success) return { ok: false, error: t("errors.invalidName") };
  try {
    const user = await requireUser();
    const ws = await workspace();
    await assertPermission(ws.id, "team.manage", t("errors.onlyManagersRename"));
    // Same rule as role changes: the person must be in this workspace, and you can't rename the owner
    // or someone whose role holds permissions you don't have (your own name is changed in Settings).
    const [team, roles, mine] = await Promise.all([listTeam(ws.id), listRoles(ws.id), getPermissions(ws.id)]);
    const target = team.find((m) => m.user_id === userId);
    if (!target) return { ok: false, error: t("errors.invalidMember") };
    const role = roles.find((r) => r.id === target.role_id);
    if (target.user_id !== user.id && (target.role === "owner" || (role && !canGrant(mine, role.permissions)))) {
      return { ok: false, error: t("errors.noPermission") };
    }
    // profiles RLS only lets people update their own row, so the checked rename goes through the service client.
    const admin = createAdminClient();
    if (!admin) throw new Error(t("errors.generic"));
    const { error } = await admin.from("profiles").update({ full_name: parsed.data }).eq("id", userId);
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: t("messages.memberRenamed") };
  } catch (e) {
    return failure(e);
  }
}

export async function removeMemberAction(userId: string): Promise<ActionResult> {
  const t = await getT("team");
  if (!z.uuid().safeParse(userId).success) return { ok: false, error: t("errors.invalidMember") };
  try {
    const ws = await workspace();
    const db = await createClient();
    const { error } = await db.rpc("remove_member", { p_workspace: ws.id, p_user: userId });
    if (error) throw error;
    refreshTeam();
    return { ok: true, message: t("messages.memberRemoved") };
  } catch (e) {
    return failure(e);
  }
}

export async function acceptInvitationAction(token: string): Promise<ActionResult> {
  const t = await getT("team");
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, error: t("errors.invalidLink") };
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
    return { ok: true, message: t("messages.welcome") };
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
const roleSchema = z.object({
  name: z.string().trim().min(1, "v:required").max(60),
  description: z.string().trim().max(300).default(""),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
});

export async function saveRoleAction(id: string | null, input: unknown): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const t = await getT("team");
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "roles.manage", t("errors.onlyRoleManagers"));
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
    return { ok: true, message: id ? t("messages.roleUpdated") : t("messages.roleCreated") };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  const t = await getT("team");
  if (!z.uuid().safeParse(id).success) return { ok: false, error: t("errors.invalidRole") };
  try {
    const ws = await workspace();
    await assertPermission(ws.id, "roles.manage");
    const db = await createClient();
    const { error, count } = await db.from("workspace_roles").delete({ count: "exact" }).eq("id", id).eq("workspace_id", ws.id);
    if (error) throw error;
    if (!count) throw new Error(t("errors.roleNotFound"));
    refreshTeam();
    return { ok: true, message: t("messages.roleDeleted") };
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------------------
// Tasks on ideas and briefs
// ---------------------------------------------------------------------------
const taskSchema = z.object({
  userId: z.uuid("team:errors.chooseMember"),
  taskType: z.enum(TASK_TYPES),
  priority: z.enum(PRIORITIES).default("medium"),
  dueDate: z.union([z.iso.date(), z.literal("")]).nullish().transform((v) => v || null),
  note: z.string().trim().max(2000).default(""),
});

export async function assignTaskAction(projectId: string, itemId: string, input: unknown): Promise<ActionResult<Task[]>> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const t = await getT("team");
  try {
    await requireUser();
    const { project } = await getProjectContext(projectId);
    await assertPermission(project.workspace_id, "content.assign", t("errors.onlyManagersAssign"));
    const db = await createClient();
    const { userId, taskType, priority, dueDate, note } = parsed.data;
    const { error } = await db.rpc("assign_task", { p_project: projectId, p_item: itemId, p_user: userId, p_task_type: taskType, p_priority: priority, p_due: dueDate, p_note: note });
    if (error) throw error;
    revalidatePath(`/p/${projectId}`, "layout");
    revalidatePath("/tasks");
    return { ok: true, data: await listItemTasks(projectId, itemId), message: t("messages.taskAssigned") };
  } catch (e) {
    return failure(e);
  }
}

export async function removeTaskAction(projectId: string, itemId: string, taskId: string): Promise<ActionResult<Task[]>> {
  const t = await getT("team");
  if (!z.uuid().safeParse(taskId).success) return { ok: false, error: t("errors.invalidTask") };
  try {
    await requireUser();
    const { project } = await getProjectContext(projectId);
    await assertPermission(project.workspace_id, "content.assign");
    const db = await createClient();
    const { error } = await db.rpc("remove_task", { p_assignment: taskId });
    if (error) throw error;
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, data: await listItemTasks(projectId, itemId), message: t("messages.taskRemoved") };
  } catch (e) {
    return failure(e);
  }
}

export async function updateTaskStatusAction(taskId: string, status: string, comment = ""): Promise<ActionResult<Task>> {
  const parsed = z.object({ taskId: z.uuid(), status: z.enum(TASK_STATUSES), comment: z.string().trim().max(2000) }).safeParse({ taskId, status, comment });
  if (!parsed.success) return zodErrorToResult(parsed.error);
  const t = await getT("team");
  try {
    await requireUser();
    const db = await createClient();
    // Authorization (owner / reviewer / manager, no self-approval) is enforced by update_task_status().
    const { data, error } = await db.rpc("update_task_status", { p_assignment: parsed.data.taskId, p_status: parsed.data.status, p_comment: parsed.data.comment });
    if (error) throw error;
    const task = data as Task;
    revalidatePath(`/p/${task.project_id}`, "layout");
    revalidatePath("/tasks");
    return { ok: true, data: task, message: t("messages.taskUpdated") };
  } catch (e) {
    return failure(e);
  }
}

export async function setContentPriorityAction(projectId: string, itemId: string, priority: string): Promise<ActionResult> {
  const t = await getT("team");
  const parsed = z.enum(PRIORITIES).safeParse(priority);
  if (!parsed.success) return { ok: false, error: t("errors.invalidPriority") };
  try {
    await requireUser();
    const { project } = await getProjectContext(projectId);
    await assertPermission(project.workspace_id, "content.assign", t("errors.onlyManagersPriority"));
    const db = await createClient();
    const { error, count } = await db.from("content_items").update({ priority: parsed.data }, { count: "exact" }).eq("project_id", projectId).eq("id", itemId);
    if (error) throw error;
    if (!count) throw new Error(t("errors.contentNotFound"));
    revalidatePath(`/p/${projectId}`, "layout");
    return { ok: true, message: t("messages.priorityUpdated") };
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
