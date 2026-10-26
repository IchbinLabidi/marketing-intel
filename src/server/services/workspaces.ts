import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/lib/domain/constants";
import type { Workspace } from "@/types/domain";
import { requireUser } from "./session";

export const ACTIVE_WORKSPACE_COOKIE = "mi_ws";

export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name)")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const ws = row.workspaces as unknown as { id: string; name: string } | null;
    return ws ? [{ id: ws.id, name: ws.name, role: row.role as WorkspaceRole }] : [];
  });
});

export const getActiveWorkspace = cache(async (): Promise<Workspace | null> => {
  const workspaces = await listWorkspaces();
  const preferred = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return workspaces.find((w) => w.id === preferred) ?? workspaces[0] ?? null;
});

export async function getWorkspaceRole(workspaceId: string): Promise<WorkspaceRole | null> {
  const workspaces = await listWorkspaces();
  return workspaces.find((w) => w.id === workspaceId)?.role ?? null;
}

export async function createWorkspace(name: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").insert({ name, created_by: userId }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function renameWorkspace(workspaceId: string, name: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ name }).eq("id", workspaceId);
  if (error) throw error;
}

export type WorkspaceMember = { user_id: string; role: WorkspaceRole; full_name: string | null; created_at: string };

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) throw error;
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return (members ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role as WorkspaceRole,
    created_at: m.created_at,
    full_name: names.get(m.user_id) ?? null,
  }));
}
