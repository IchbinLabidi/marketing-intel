"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAdmin } from "@/lib/domain/constants";
import { formToObject, zodErrorToResult, type ActionResult } from "@/lib/validation/common";
import { requireUser } from "@/server/services/session";
import {
  ACTIVE_WORKSPACE_COOKIE,
  createWorkspace,
  getWorkspaceRole,
  listWorkspaces,
  renameWorkspace,
} from "@/server/services/workspaces";

const nameSchema = z.object({ name: z.string().trim().min(1, "Required").max(120) });

async function setActiveWorkspace(id: string) {
  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}

export async function switchWorkspaceAction(workspaceId: string) {
  const workspaces = await listWorkspaces();
  if (!workspaces.some((w) => w.id === workspaceId)) return;
  await setActiveWorkspace(workspaceId);
  (await cookies()).delete("mi_project");
  revalidatePath("/", "layout");
}

export async function createWorkspaceAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = nameSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    const id = await createWorkspace(parsed.data.name, user.id);
    await setActiveWorkspace(id);
    revalidatePath("/", "layout");
    return { ok: true, message: "Workspace created" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create workspace" };
  }
}

export async function renameWorkspaceAction(workspaceId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!canAdmin(await getWorkspaceRole(workspaceId))) return { ok: false, error: "Only owners and admins can rename the workspace." };
  const parsed = nameSchema.safeParse(formToObject(formData));
  if (!parsed.success) return zodErrorToResult(parsed.error);
  try {
    await renameWorkspace(workspaceId, parsed.data.name);
    revalidatePath("/", "layout");
    return { ok: true, message: "Workspace renamed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not rename workspace" };
  }
}
