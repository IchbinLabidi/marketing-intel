"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { formToObject, zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import { brandProfileSchema, channelSchema, projectSchema } from "@/lib/validation/project";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace } from "@/server/services/workspaces";
import {
  addChannel,
  createProject,
  deleteProject,
  getProjectContext,
  removeChannel,
  saveBrandProfile,
  setProjectArchived,
  updateProject,
} from "@/server/services/projects";

const fail = (e: unknown, fallback: string): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : fallback });
const NO_EDIT: ActionResult = { ok: false, error: "Your role in this workspace is read-only." };

export async function createProjectAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const workspace = await getActiveWorkspace();
  if (!workspace) return { ok: false, error: "No workspace found." };
  if (!canEdit(workspace.role)) return NO_EDIT;
  const parsed = projectSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  let id: string;
  try {
    id = await createProject(workspace.id, user.id, parsed.data);
  } catch (e) {
    return fail(e, "Could not create project");
  }
  revalidatePath("/", "layout");
  redirect(`/p/${id}`);
}

export async function updateProjectAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  const parsed = projectSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await updateProject(projectId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, message: "Project saved" };
  } catch (e) {
    return fail(e, "Could not save project");
  }
}

export async function archiveProjectAction(projectId: string, archived: boolean): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  try {
    await setProjectArchived(projectId, archived);
    revalidatePath("/", "layout");
    return { ok: true, message: archived ? "Project archived" : "Project restored" };
  } catch (e) {
    return fail(e, "Could not update project");
  }
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canAdmin(role)) return { ok: false, error: "Only owners and admins can delete projects." };
  try {
    await deleteProject(projectId);
  } catch (e) {
    return fail(e, "Could not delete project");
  }
  revalidatePath("/", "layout");
  redirect("/projects");
}

export async function saveBrandProfileAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  const parsed = brandProfileSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await saveBrandProfile(projectId, parsed.data);
    revalidatePath(`/p/${projectId}`);
    return { ok: true, message: "Brand identity saved" };
  } catch (e) {
    return fail(e, "Could not save brand identity");
  }
}

export async function addChannelAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  const parsed = channelSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await addChannel(projectId, parsed.data);
    revalidatePath(`/p/${projectId}`);
    return { ok: true, message: "Channel added" };
  } catch (e) {
    return fail(e, "Could not add channel");
  }
}

export async function removeChannelAction(projectId: string, channelId: string): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return NO_EDIT;
  try {
    await removeChannel(projectId, channelId);
    revalidatePath(`/p/${projectId}`);
    return { ok: true, message: "Channel removed" };
  } catch (e) {
    return fail(e, "Could not remove channel");
  }
}
