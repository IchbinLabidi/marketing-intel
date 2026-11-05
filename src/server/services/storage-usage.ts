import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingTeamSchema } from "@/server/services/team";

export type StorageUsage = {
  database_bytes: number;
  files_bytes: number;
  files_count: number;
  workspace_files_bytes: number;
  workspace_files_count: number;
  buckets: { id: string; bytes: number; count: number }[];
  tables: { name: string; bytes: number }[];
};

/** Included in the Supabase Pro plan (beyond this, usage is billed, or capped while the spend cap is on). */
export const PLAN_LIMITS = { databaseBytes: 8 * 1024 ** 3, filesBytes: 100 * 1024 ** 3 };

/** Database and file storage usage, for workspace owners/admins. null = migration 0030 missing or not allowed. */
export async function getStorageUsage(workspaceId: string): Promise<StorageUsage | null> {
  const db = await createClient();
  const { data, error } = await db.rpc("storage_usage", { p_workspace: workspaceId });
  if (error) {
    if (isMissingTeamSchema(error) || error.code === "42501") return null;
    throw error;
  }
  return data as StorageUsage;
}
