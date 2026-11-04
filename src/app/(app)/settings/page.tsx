import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { FormSection } from "@/components/app/form-section";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "@/components/app/theme-switcher";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { getT } from "@/i18n/server";
import { CreateWorkspaceForm, RenameWorkspaceForm } from "@/components/settings/workspace-forms";
import { canAdmin } from "@/lib/domain/constants";
import { requireUser } from "@/server/services/session";
import { getActiveWorkspace, listMembers } from "@/server/services/workspaces";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { isAIConfigured } from "@/server/ai/client";
import { providerConfigured } from "@/server/ai/providers";

export async function generateMetadata() {
  const t = await getT("settings");
  return { title: t("metaTitle") };
}

export default async function SettingsPage() {
  const user = await requireUser();
  const workspace = (await getActiveWorkspace())!;
  const members = await listMembers(workspace.id);
  const ai = isAIConfigured();
  const [t, td] = await Promise.all([getT("settings"), getT("domain")]);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={workspace.name} title={t("title")} description={t("description")} />

      <div className="divide-y">
        <FormSection
          id="appearance"
          title={t("appearance.title")}
          description={t("appearance.description")}
        >
          <ThemeSwitcher />
        </FormSection>

        <FormSection id="language" title={t("language.title")} description={t("language.description")}>
          <LanguageSwitcher />
        </FormSection>

        <FormSection
          title={t("workspace.title")}
          description={t("workspace.description")}
        >
          <RenameWorkspaceForm workspaceId={workspace.id} name={workspace.name} disabled={!canAdmin(workspace.role)} />
        </FormSection>

        <FormSection
          title={t("members.title")}
          description={t("members.description")}
        >
          <ul className="-my-2 divide-y">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <Avatar name={m.full_name || "?"} className="size-8" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {m.full_name || t("members.unnamed")}
                  {m.user_id === user.id ? <span className="font-normal text-muted-foreground">{t("members.you")}</span> : null}
                </span>
                <Badge variant={m.role === "owner" || m.role === "admin" ? "default" : "outline"}>
                  {td(`role.${m.role}`)}
                </Badge>
              </li>
            ))}
          </ul>
          <Link href="/team" className="mt-4 inline-flex text-[13px] font-medium text-primary hover:underline">{t("members.manage")}</Link>
        </FormSection>

        <FormSection
          id="workspaces"
          title={t("newWorkspace.title")}
          description={t("newWorkspace.description")}
        >
          <CreateWorkspaceForm />
        </FormSection>

        <FormSection title={t("integrations.title")} description={t("integrations.description")}>
          <ul className="-my-2 divide-y text-[13px]">
            {(["gemini", "anthropic"] as const).map((p) => {
              const ok = providerConfigured(p);
              return (
                <li key={p} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                  {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleDashed className="size-4 text-subtle-foreground" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{PROVIDER_LABELS[p]}</span>{" "}
                    <span className="text-muted-foreground">{p === "gemini" ? t("integrations.geminiRole") : t("integrations.anthropicRole")}</span>
                  </span>
                  {ok ? (
                    <Badge variant="success" dot>
                      {t("integrations.connected")}
                    </Badge>
                  ) : (
                    <code className="font-mono text-xs text-muted-foreground">{t("integrations.setKey", { key: p === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY" })}</code>
                  )}
                </li>
              );
            })}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <CircleDashed className="size-4 text-subtle-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t("integrations.social")}</span>{" "}
                <span className="text-muted-foreground">{t("integrations.socialDetail")}</span>
              </span>
              <span className="text-xs text-muted-foreground">{t("integrations.socialWhere")}</span>
            </li>
          </ul>
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            {ai ? (
              t.rich("integrations.aiUsageLink", {
                link: (c) => (
                  <Link href="/ai-usage" className="font-medium text-primary hover:underline">
                    {c}
                  </Link>
                ),
              })
            ) : (
              t("integrations.addKey")
            )}
          </p>
        </FormSection>
      </div>
    </div>
  );
}
