"use server";

import { revalidatePath } from "next/cache";
import { canEdit } from "@/lib/domain/constants";
import type { ActionResult } from "@/lib/validation/common";
import { MetaApiError } from "@/server/meta/graph";
import { listManagedPages } from "@/server/meta/oauth";
import { startMetaSync } from "@/server/meta/start";
import { describeMetaError } from "@/server/meta/sync";
import {
  clearMetaTokens,
  deleteMetaPosts,
  getMetaConnection,
  readMetaTokens,
  storeMetaTokens,
  updateMetaConnection,
} from "@/server/services/meta";
import { getProjectContext } from "@/server/services/projects";
import { requireUser } from "@/server/services/session";

const NO_EDIT: ActionResult<never> = { ok: false, error: "Your role in this workspace is read-only." };
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

async function guard(projectId: string) {
  await requireUser();
  const { role } = await getProjectContext(projectId);
  return canEdit(role);
}

export async function syncMetaAction(projectId: string, kind: "incremental" | "refresh"): Promise<ActionResult> {
  if (!(await guard(projectId))) return NO_EDIT;
  try {
    const conn = await getMetaConnection(projectId);
    const r = await startMetaSync(projectId, conn?.last_sync_at ? kind : "initial", "manual");
    if (!r.ok) return r;
    refresh(projectId);
    return { ok: true, message: kind === "refresh" ? "Refreshing metrics of all synced posts…" : "Synchronization started" };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}

/** Pages the connected person manages (no tokens leave the server). */
export async function listMetaPagesAction(projectId: string): Promise<ActionResult<{ id: string; name: string; instagram: string | null; canAnalyze: boolean }[]>> {
  if (!(await guard(projectId))) return NO_EDIT;
  try {
    const conn = await getMetaConnection(projectId);
    if (!conn) return { ok: false, error: "Connect Meta first." };
    const { user } = await readMetaTokens(conn.id);
    if (!user) return { ok: false, error: "Meta authorization is missing. Connect Meta again." };
    const pages = await listManagedPages(user);
    return {
      ok: true,
      data: pages.map((p) => ({
        id: p.id,
        name: p.name,
        instagram: p.instagram_business_account ? p.instagram_business_account.username ?? p.instagram_business_account.id : null,
        canAnalyze: !p.tasks || p.tasks.includes("ANALYZE"),
      })),
    };
  } catch (e) {
    if (e instanceof MetaApiError && e.isTokenError) await updateMetaConnection(projectId, { status: "expired", last_error: describeMetaError(e) });
    return { ok: false, error: describeMetaError(e) };
  }
}

export async function selectMetaPageAction(projectId: string, pageId: string): Promise<ActionResult> {
  if (!(await guard(projectId))) return NO_EDIT;
  try {
    const conn = await getMetaConnection(projectId);
    if (!conn) return { ok: false, error: "Connect Meta first." };
    const { user } = await readMetaTokens(conn.id);
    if (!user) return { ok: false, error: "Meta authorization is missing. Connect Meta again." };
    const page = (await listManagedPages(user)).find((p) => p.id === pageId);
    if (!page) return { ok: false, error: "That Page is not managed by the connected Facebook account." };
    const switching = conn.page_id && conn.page_id !== page.id;
    if (switching) await deleteMetaPosts(projectId); // posts from another Page would mix two brands' histories
    await storeMetaTokens(conn.id, { page: page.access_token });
    await updateMetaConnection(projectId, {
      status: "active",
      page_id: page.id,
      page_name: page.name,
      ig_user_id: page.instagram_business_account?.id ?? null,
      ig_username: page.instagram_business_account?.username ?? null,
      supported_metrics: switching ? {} : conn.supported_metrics,
      backfill: switching ? {} : conn.backfill,
      last_sync_at: switching ? null : conn.last_sync_at,
      last_error: null,
    });
    await startMetaSync(projectId, "initial", "manual");
    refresh(projectId);
    return { ok: true, message: `${page.name} connected. The first synchronization has started.` };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}

export async function disconnectMetaAction(projectId: string, deletePosts: boolean): Promise<ActionResult> {
  if (!(await guard(projectId))) return NO_EDIT;
  try {
    const conn = await getMetaConnection(projectId);
    if (!conn) return { ok: true, message: "Already disconnected" };
    await clearMetaTokens(conn.id);
    await updateMetaConnection(projectId, { status: "disconnected", last_error: null });
    if (deletePosts) await deleteMetaPosts(projectId);
    refresh(projectId);
    return { ok: true, message: deletePosts ? "Meta disconnected and synced posts deleted" : "Meta disconnected. Synced posts are kept." };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}

export async function setMetaAutoSyncAction(projectId: string, enabled: boolean): Promise<ActionResult> {
  if (!(await guard(projectId))) return NO_EDIT;
  try {
    await updateMetaConnection(projectId, { auto_sync: enabled });
    refresh(projectId);
    return { ok: true, message: enabled ? "Automatic synchronization on" : "Automatic synchronization off" };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}
