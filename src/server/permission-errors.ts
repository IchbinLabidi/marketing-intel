import "server-only";
import { getT } from "@/i18n/server";
import type { Permission } from "@/lib/permissions";

/** Thrown when the current user's role lacks a permission; carries which one so the message can name it. */
export class PermissionError extends Error {
  constructor(message: string, readonly permission?: Permission) {
    super(message);
    this.name = "PermissionError";
  }
}

/** "You don't have permission to do this. You need the “X” permission." (X = the label shown in the roles editor). */
export async function permissionMessage(permission?: string | null): Promise<string> {
  const t = await getT("errors");
  if (!permission) return t("permission.missing");
  const td = await getT("domain");
  const label = td(`permission.${permission}` as Parameters<typeof td>[0]);
  // An unknown key comes back unchanged: fall back to the generic sentence rather than show a raw key.
  return label && label !== `permission.${permission}` ? t("permission.missingNamed", { permission: label }) : t("permission.missing");
}

/** Just the "You need the “X” permission." sentence, to follow a caller's own explanation. */
export async function permissionHint(permission: string): Promise<string> {
  const [t, td] = await Promise.all([getT("errors"), getT("domain")]);
  return t("permission.need", { permission: td(`permission.${permission}` as Parameters<typeof td>[0]) });
}

function rawText(e: unknown): string {
  return e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "";
}

/**
 * Database refusals worded for developers: RLS ("permission denied for table…", "new row violates row-level security
 * policy…") and the bare 'not allowed' / 'Not authorized' exceptions of our RPCs. Refusals already written as a
 * sentence for people (e.g. "Only members who can approve content can move it to Done") are kept as they are.
 */
export function isRawPermissionError(e: unknown): boolean {
  const message = rawText(e).trim();
  return /^(not allowed|not authorized)\.?$/i.test(message) || /permission denied|row-level security/i.test(message);
}

/**
 * The text to show for a failed action: a named-permission message for PermissionError, a readable permission
 * message for raw database refusals (naming `permission` when the caller knows which one is needed), the error's own
 * message otherwise (Supabase errors are plain objects, not Error instances), and `fallback` when there is none.
 */
export async function friendlyError(e: unknown, fallback: string, permission?: Permission): Promise<string> {
  if (e instanceof PermissionError) return e.message;
  if (isRawPermissionError(e)) return permissionMessage(permission);
  return rawText(e) || fallback;
}
