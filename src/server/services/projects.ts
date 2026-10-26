import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BrandProfileInput, ChannelInput, ProjectInput } from "@/lib/validation/project";
import type { BrandProfile, Project, ProjectChannel } from "@/types/domain";
import type { WorkspaceRole } from "@/lib/domain/constants";
import { getWorkspaceRole } from "./workspaces";

export async function listProjects(workspaceId: string, { includeArchived = false } = {}): Promise<Project[]> {
  const supabase = await createClient();
  let query = supabase.from("projects").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Project[];
}

/** Loads a project the current user can access, plus their role in its workspace. 404s otherwise. */
export const getProjectContext = cache(async (projectId: string): Promise<{ project: Project; role: WorkspaceRole }> => {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  const role = await getWorkspaceRole(data.workspace_id);
  if (!role) notFound();
  return { project: data as Project, role };
});

export async function createProject(workspaceId: string, userId: string, input: ProjectInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...input, workspace_id: workspaceId, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  // Seed the 1:1 rows so later updates are simple upserts.
  await supabase.from("brand_profiles").insert({ project_id: data.id });
  await supabase.from("strategies").insert({ project_id: data.id, updated_by: userId });
  return data.id as string;
}

export async function updateProject(projectId: string, input: ProjectInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update(input).eq("id", projectId);
  if (error) throw error;
}

export async function setProjectArchived(projectId: string, archived: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", projectId);
  if (error) throw error;
}

export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  const { error, count } = await supabase.from("projects").delete({ count: "exact" }).eq("id", projectId);
  if (error) throw error;
  if (!count) throw new Error("You don't have permission to delete this project.");
}

export async function getBrandProfile(projectId: string): Promise<BrandProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("brand_profiles").select("*").eq("project_id", projectId).maybeSingle();
  if (error) throw error;
  return data as BrandProfile | null;
}

export async function saveBrandProfile(projectId: string, input: BrandProfileInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("brand_profiles").upsert({ project_id: projectId, ...input });
  if (error) throw error;
}

export async function listChannels(projectId: string): Promise<ProjectChannel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_channels").select("*").eq("project_id", projectId).order("created_at");
  if (error) throw error;
  return (data ?? []) as ProjectChannel[];
}

export async function addChannel(projectId: string, input: ChannelInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_channels").insert({ project_id: projectId, ...input });
  if (error) {
    if (error.code === "23505") throw new Error("This channel already exists.");
    throw error;
  }
}

export async function removeChannel(projectId: string, channelId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_channels").delete().eq("id", channelId).eq("project_id", projectId);
  if (error) throw error;
}
