"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { formToObject, type ActionResult } from "@/lib/validation/common";
import { zodErrorToResult } from "@/lib/validation/errors";
import { brandProfileSchema, channelSchema, projectSchema } from "@/lib/validation/project";
import { requireUser } from "@/server/services/session";
import { verifyCurrentPassword } from "@/server/services/reauth";
import { getT } from "@/i18n/server";
import type { TFor } from "@/i18n/messages";
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

type ActionKey = Parameters<TFor<"projects">>[0];
const fail = async (e: unknown, fallback: ActionKey): Promise<ActionResult> => ({ ok: false, error: e instanceof Error ? e.message : (await getT("projects"))(fallback) });
const noEdit = async (): Promise<ActionResult> => ({ ok: false, error: (await getT("projects"))("actions.readOnly") });
const tr = async (key: ActionKey) => (await getT("projects"))(key);

export async function createProjectAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const workspace = await getActiveWorkspace();
  if (!workspace) return { ok: false, error: await tr("actions.noWorkspace") };
  if (!canEdit(workspace.role)) return noEdit();
  const parsed = projectSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  let id: string;
  try {
    id = await createProject(workspace.id, user.id, parsed.data);
  } catch (e) {
    return fail(e, "actions.createFailed");
  }
  revalidatePath("/", "layout");
  redirect(`/p/${id}`);
}

export async function updateProjectAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return noEdit();
  const parsed = projectSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await updateProject(projectId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, message: await tr("actions.saved") };
  } catch (e) {
    return fail(e, "actions.saveFailed");
  }
}

export async function archiveProjectAction(projectId: string, archived: boolean): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return noEdit();
  try {
    await setProjectArchived(projectId, archived);
    revalidatePath("/", "layout");
    return { ok: true, message: await tr(archived ? "actions.archived" : "actions.restored") };
  } catch (e) {
    return fail(e, "actions.updateFailed");
  }
}

/**
 * Hard-deletes a project and its data. Owners and admins only, and they must re-enter their account
 * password: both are checked here on the server, whatever the UI shows.
 */
export async function deleteProjectAction(
  projectId: string,
  password: string,
  after: "dashboard" | "projects" = "projects",
): Promise<ActionResult> {
  const user = await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canAdmin(role)) return { ok: false, error: await tr("actions.onlyAdminsDelete") };
  if (typeof password !== "string" || !password) return { ok: false, error: await tr("actions.enterPassword") };
  if (!(await verifyCurrentPassword(user, password))) return { ok: false, error: await tr("actions.incorrectPassword") };
  try {
    await deleteProject(projectId);
  } catch (e) {
    return fail(e, "actions.deleteFailed");
  }
  revalidatePath("/", "layout");
  redirect(after === "dashboard" ? "/dashboard" : "/projects");
}

export async function saveBrandProfileAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return noEdit();
  const parsed = brandProfileSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await saveBrandProfile(projectId, parsed.data);
    revalidatePath(`/p/${projectId}`);
    return { ok: true, message: await tr("actions.brandSaved") };
  } catch (e) {
    return fail(e, "actions.brandSaveFailed");
  }
}

export async function addChannelAction(projectId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return noEdit();
  const parsed = channelSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await addChannel(projectId, parsed.data);
    revalidatePath(`/p/${projectId}`);
    return { ok: true, message: await tr("actions.channelAdded") };
  } catch (e) {
    return fail(e, "actions.channelAddFailed");
  }
}

export async function removeChannelAction(projectId: string, channelId: string): Promise<ActionResult> {
  const { role } = await getProjectContext(projectId);
  if (!canEdit(role)) return noEdit();
  try {
    await removeChannel(projectId, channelId);
    revalidatePath(`/p/${projectId}`);
    return { ok: true, message: await tr("actions.channelRemoved") };
  } catch (e) {
    return fail(e, "actions.channelRemoveFailed");
  }
}
