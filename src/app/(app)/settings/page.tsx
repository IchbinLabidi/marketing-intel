import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { FormSection } from "@/components/app/form-section";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "@/components/app/theme-switcher";
import { CreateWorkspaceForm, RenameWorkspaceForm } from "@/components/settings/workspace-forms";
import { canAdmin } from "@/lib/domain/constants";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace, listMembers } from "@/server/services/workspaces";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { isAIConfigured } from "@/server/ai/client";
import { providerConfigured } from "@/server/ai/providers";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const workspace = (await getActiveWorkspace())!;
  const members = await listMembers(workspace.id);
  const ai = isAIConfigured();

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={workspace.name} title="Settings" description="Appearance, workspace details, members and integrations." />

      <div className="divide-y">
        <FormSection
          id="appearance"
          title="Appearance"
          description="Light, dark, or follow your device. Saved on this browser and applied on every page."
        >
          <ThemeSwitcher />
        </FormSection>

        <FormSection
          title="Workspace"
          description="Projects, members and AI usage belong to a workspace. Agencies typically use one workspace per client."
        >
          <RenameWorkspaceForm workspaceId={workspace.id} name={workspace.name} disabled={!canAdmin(workspace.role)} />
        </FormSection>

        <FormSection
          title="Members"
          description="Who is in this workspace. Invite people and manage roles and permissions on the Team page."
        >
          <ul className="-my-2 divide-y">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <Avatar name={m.full_name || "?"} className="size-8" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {m.full_name || "Unnamed member"}
                  {m.user_id === user.id ? <span className="font-normal text-muted-foreground"> · you</span> : null}
                </span>
                <Badge variant={m.role === "owner" || m.role === "admin" ? "default" : "outline"} className="capitalize">
                  {m.role}
                </Badge>
              </li>
            ))}
          </ul>
          <Link href="/team" className="mt-4 inline-flex text-[13px] font-medium text-primary hover:underline">Manage team and roles →</Link>
        </FormSection>

        <FormSection
          id="workspaces"
          title="New workspace"
          description="Create a separate workspace. You become its owner and can switch between workspaces from the sidebar."
        >
          <CreateWorkspaceForm />
        </FormSection>

        <FormSection title="Integrations" description="Server-side credentials. Keys are never sent to the browser.">
          <ul className="-my-2 divide-y text-[13px]">
            {(["gemini", "anthropic"] as const).map((p) => {
              const ok = providerConfigured(p);
              return (
                <li key={p} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleDashed className="size-4 text-subtle-foreground" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{PROVIDER_LABELS[p]}</span>{" "}
                    <span className="text-muted-foreground">{p === "gemini" ? "Default AI engine" : "Premium tasks, optional"}</span>
                  </span>
                  {ok ? (
                    <Badge variant="success" dot>
                      Connected
                    </Badge>
                  ) : (
                    <code className="font-mono text-xs text-muted-foreground">Set {p === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"}</code>
                  )}
                </li>
              );
            })}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <CircleDashed className="size-4 text-subtle-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">Social media data</span>{" "}
                <span className="text-muted-foreground">Meta, YouTube, LinkedIn, TikTok</span>
              </span>
              <Badge variant="outline">Planned</Badge>
            </li>
          </ul>
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            {ai ? (
              <>
                Models per task and spend are on the{" "}
                <Link href="/ai-usage" className="font-medium text-primary hover:underline">
                  AI usage
                </Link>{" "}
                page.
              </>
            ) : (
              "Add at least one AI key to enable AI features."
            )}
          </p>
        </FormSection>
      </div>
    </div>
  );
}
