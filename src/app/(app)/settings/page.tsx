import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateWorkspaceForm, RenameWorkspaceForm } from "@/components/settings/workspace-forms";
import { canAdmin } from "@/lib/domain/constants";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace, listMembers } from "@/server/services/workspaces";
import Link from "next/link";
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
    <div className="space-y-6">
      <PageHeader title="Settings" description={`Workspace settings for ${workspace.name}.`} />

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Projects, members and AI usage belong to a workspace. Agencies typically use one workspace per client.</CardDescription>
        </CardHeader>
        <CardContent>
          <RenameWorkspaceForm workspaceId={workspace.id} name={workspace.name} disabled={!canAdmin(workspace.role)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Roles: owners and admins manage the workspace, editors create and edit content, viewers have read-only access. Email
            invitations are on the roadmap.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <Avatar name={m.full_name || "?"} />
                <span className="flex-1">
                  {m.full_name || "Unnamed member"}
                  {m.user_id === user.id ? <span className="text-muted-foreground"> (you)</span> : null}
                </span>
                <Badge variant="secondary" className="capitalize">{m.role}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card id="workspaces">
        <CardHeader>
          <CardTitle>New workspace</CardTitle>
          <CardDescription>Create a separate workspace. You become its owner and can switch from the sidebar.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateWorkspaceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Server-side credentials. Keys are never sent to the browser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-[13px]">
          {(["gemini", "anthropic"] as const).map((p) => (
            <div key={p} className="flex items-center gap-2">
              {providerConfigured(p) ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-muted-foreground" />}
              <span className="flex-1">{PROVIDER_LABELS[p]} {p === "gemini" ? "(default AI engine)" : "(premium tasks, optional)"}</span>
              <span className="text-xs text-muted-foreground">{providerConfigured(p) ? "API key set" : `Set ${p === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"}`}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{ai ? <>Models per task and spend: <Link href="/ai-usage" className="text-primary hover:underline">AI usage</Link>.</> : "Add at least one AI key to enable AI features."}</p>
          <div className="flex items-center gap-2">
            <CircleDashed className="size-4 text-muted-foreground" />
            <span className="flex-1">Social media data (Meta, YouTube, LinkedIn, TikTok)</span>
            <span className="text-xs text-muted-foreground">Planned for competitor intelligence</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
