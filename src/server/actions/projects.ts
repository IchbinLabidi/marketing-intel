"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/server/permission-errors";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canAdmin, canEdit } from "@/lib/domain/constants";
import { formToObject, type ActionResult } from "@/lib/validation/common";
import { zodErrorToResult } from "@/lib/validation/errors";
import { brandProfileSchema, channelSchema, projectSchema } from "@/lib/validation/project";
import { requireUser } from "@/server/services/session";
import { hasRecentLinkReauth, sendReauthLink, verifyCurrentPassword } from "@/server/services/reauth";
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
const fail = async (e: unknown, fallback: ActionKey): Promise<ActionResult> => ({ ok: false, error: await friendlyError(e, (await getT("projects"))(fallback)) });
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

/** Same-site path only, so the emailed link can never send anyone elsewhere. */
function safeReturnPath(path: unknown): string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && path.length < 500 ? path : "/projects";
}

/** Typed confirmation: the project name, ignoring case and surrounding/repeated spaces. */
function sameName(typed: unknown, name: string) {
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return typeof typed === "string" && norm(typed) === norm(name);
}

/**
 * What the delete dialog should ask for: the password, or nothing more because the person just
 * confirmed their identity through an emailed sign-in link. Admins only.
 */
export async function getDeleteConfirmationStatusAction(projectId: string): Promise<ActionResult<{ emailVerified: boolean; email: string }>> {
  const user = await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canAdmin(role)) return { ok: false, error: await tr("actions.onlyAdminsDelete") };
  return { ok: true, data: { emailVerified: await hasRecentLinkReauth(user), email: user.email } };
}

/**
 * Emails the admin a one-time sign-in link to their own address, for people who sign in without
 * knowing their password. Opening it brings them back here with a freshly verified session.
 */
export async function sendDeleteConfirmationLinkAction(projectId: string, returnPath: string): Promise<ActionResult> {
  const user = await requireUser();
  const { role } = await getProjectContext(projectId);
  if (!canAdmin(role)) return { ok: false, error: await tr("actions.onlyAdminsDelete") };
  const back = safeReturnPath(returnPath);
  const sep = back.includes("?") ? "&" : "?";
  const next = `${back}${sep}confirmDelete=${encodeURIComponent(projectId)}`;
  const origin = (await headers()).get("origin") ?? "";
  const sent = await sendReauthLink(user, `${origin}/auth/callback?next=${encodeURIComponent(next)}`);
  if (!sent.ok) {
    const rateLimited = /rate|limit|seconds/i.test(sent.error);
    return { ok: false, error: await tr(rateLimited ? "actions.linkRateLimited" : "actions.linkFailed") };
  }
  return { ok: true, message: await tr("actions.linkSent") };
}

/**
 * Hard-deletes a project and its data. Owners and admins only. They must type the project name and
 * prove who they are: either their account password, or a sign-in through an emailed link in the
 * last few minutes (for accounts used without a password). All of it is checked here on the server.
 */
export async function deleteProjectAction(
  projectId: string,
  confirmation: { name: string; password?: string },
  after: "dashboard" | "projects" = "projects",
): Promise<ActionResult> {
  const user = await requireUser();
  const { project, role } = await getProjectContext(projectId);
  if (!canAdmin(role)) return { ok: false, error: await tr("actions.onlyAdminsDelete") };
  if (!sameName(confirmation?.name, project.name)) return { ok: false, error: await tr("actions.nameMismatch") };
  const password = typeof confirmation?.password === "string" ? confirmation.password : "";
  if (password) {
    if (!(await verifyCurrentPassword(user, password))) return { ok: false, error: await tr("actions.incorrectPassword") };
  } else if (!(await hasRecentLinkReauth(user))) {
    return { ok: false, error: await tr("actions.confirmIdentity") };
  }
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
