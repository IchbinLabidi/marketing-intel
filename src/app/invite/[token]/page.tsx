import Link from "next/link";
import { MailWarning } from "lucide-react";
import { BrandMark } from "@/components/app/brand";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AcceptInvitation } from "@/components/team/accept-invitation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/services/session";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("auth");
  return { title: t("invite.metaTitle") };
}

type Preview = { workspace_name: string; role_name: string; email: string; status: "pending" | "accepted" | "revoked" | "expired" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getT("auth");
  const b = (c: React.ReactNode) => <span className="font-medium text-foreground">{c}</span>;
  const user = await getCurrentUser();
  let preview: Preview | null = null;
  if (/^[0-9a-f]{64}$/.test(token)) {
    const db = await createClient();
    const { data } = await db.rpc("invitation_preview", { p_token: token });
    preview = ((data as Preview[] | null) ?? [])[0] ?? null;
  }
  const emailMatches = preview && user && user.email.toLowerCase() === preview.email;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-background px-4 py-10">
      <div className="flex w-full max-w-md items-center justify-between gap-3">
        <BrandMark size="md" />
        <LanguageSwitcher size="sm" />
      </div>
      <div className="mt-12 w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
        {!preview ? (
          <Alert variant="destructive" title={t("invite.invalidTitle")}>{t("invite.invalidBody")}</Alert>
        ) : preview.status !== "pending" ? (
          <Alert variant="warning" title={preview.status === "accepted" ? t("invite.usedTitle") : preview.status === "expired" ? t("invite.expiredTitle") : t("invite.revokedTitle")}>
            {preview.status === "accepted" ? t.rich("invite.usedBody", { link: (c) => <Link className="font-medium text-primary hover:underline" href="/dashboard">{c}</Link> }) : t("invite.askAdmin")}
          </Alert>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <p className="eyebrow">{t("invite.eyebrow")}</p>
              <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">{t("invite.join", { workspace: preview.workspace_name })}</h1>
              <p className="text-[13.5px] text-muted-foreground">
                {t.rich("invite.invitedAs", { role: preview.role_name, email: preview.email, b })}
              </p>
            </div>
            {emailMatches ? (
              <AcceptInvitation token={token} workspaceName={preview.workspace_name} />
            ) : (
              <Alert variant="warning" title={t("invite.otherEmailTitle")}>
                <span className="flex items-start gap-1.5"><MailWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("invite.otherEmailBody", { current: user?.email ?? "", email: preview.email })}</span>
              </Alert>
            )}
            {!emailMatches ? (
              <div className="grid gap-2">
                <Button asChild className="w-full"><Link href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}>{t("invite.createAccount")}</Link></Button>
                {!user ? <Button asChild variant="outline" className="w-full"><Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>{t("invite.haveAccount")}</Link></Button> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
