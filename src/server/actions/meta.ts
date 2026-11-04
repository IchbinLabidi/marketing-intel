"use server";

import { revalidatePath } from "next/cache";
import { canEdit } from "@/lib/domain/constants";
import type { ActionResult } from "@/lib/validation/common";
import { getT } from "@/i18n/server";
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

const noEdit = async (): Promise<ActionResult<never>> => ({ ok: false, error: (await getT("integrations"))("actions.readOnly") });
const refresh = (projectId: string) => revalidatePath(`/p/${projectId}`, "layout");

async function guard(projectId: string) {
  await requireUser();
  const { role } = await getProjectContext(projectId);
  return canEdit(role);
}

export async function syncMetaAction(projectId: string, kind: "incremental" | "refresh"): Promise<ActionResult> {
  if (!(await guard(projectId))) return noEdit();
  try {
    const conn = await getMetaConnection(projectId);
    const r = await startMetaSync(projectId, conn?.last_sync_at ? kind : "initial", "manual");
    if (!r.ok) return r;
    refresh(projectId);
    const t = await getT("integrations");
    return { ok: true, message: kind === "refresh" ? t("actions.metaRefreshing") : t("actions.syncStarted") };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}

/** Pages the connected person manages (no tokens leave the server). */
export async function listMetaPagesAction(projectId: string): Promise<ActionResult<{ id: string; name: string; instagram: string | null; canAnalyze: boolean }[]>> {
  if (!(await guard(projectId))) return noEdit();
  try {
    const t = await getT("integrations");
    const conn = await getMetaConnection(projectId);
    if (!conn) return { ok: false, error: t("actions.metaConnectFirst") };
    const { user } = await readMetaTokens(conn.id);
    if (!user) return { ok: false, error: t("actions.metaAuthMissing") };
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
  if (!(await guard(projectId))) return noEdit();
  try {
    const t = await getT("integrations");
    const conn = await getMetaConnection(projectId);
    if (!conn) return { ok: false, error: t("actions.metaConnectFirst") };
    const { user } = await readMetaTokens(conn.id);
    if (!user) return { ok: false, error: t("actions.metaAuthMissing") };
    const page = (await listManagedPages(user)).find((p) => p.id === pageId);
    if (!page) return { ok: false, error: t("actions.metaPageNotManaged") };
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
    return { ok: true, message: t("actions.metaPageConnected", { name: page.name }) };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}

export async function disconnectMetaAction(projectId: string, deletePosts: boolean): Promise<ActionResult> {
  if (!(await guard(projectId))) return noEdit();
  try {
    const t = await getT("integrations");
    const conn = await getMetaConnection(projectId);
    if (!conn) return { ok: true, message: t("actions.alreadyDisconnected") };
    await clearMetaTokens(conn.id);
    await updateMetaConnection(projectId, { status: "disconnected", last_error: null });
    if (deletePosts) await deleteMetaPosts(projectId);
    refresh(projectId);
    return { ok: true, message: deletePosts ? t("actions.metaDisconnectedDeleted") : t("actions.metaDisconnectedKept") };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}

export async function setMetaAutoSyncAction(projectId: string, enabled: boolean): Promise<ActionResult> {
  if (!(await guard(projectId))) return noEdit();
  try {
    await updateMetaConnection(projectId, { auto_sync: enabled });
    refresh(projectId);
    const t = await getT("integrations");
    return { ok: true, message: enabled ? t("actions.metaAutoOn") : t("actions.metaAutoOff") };
  } catch (e) {
    return { ok: false, error: describeMetaError(e) };
  }
}
