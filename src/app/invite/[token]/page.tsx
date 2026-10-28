import Link from "next/link";
import { MailWarning } from "lucide-react";
import { BrandMark } from "@/components/app/brand";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AcceptInvitation } from "@/components/team/accept-invitation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/services/session";

export const metadata = { title: "Join workspace" };

type Preview = { workspace_name: string; role_name: string; email: string; status: "pending" | "accepted" | "revoked" | "expired" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
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
      <BrandMark size="md" />
      <div className="mt-12 w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
        {!preview ? (
          <Alert variant="destructive" title="This invitation link is not valid">Ask the person who invited you for a new link.</Alert>
        ) : preview.status !== "pending" ? (
          <Alert variant="warning" title={`This invitation has ${preview.status === "accepted" ? "already been used" : preview.status === "expired" ? "expired" : "been revoked"}`}>
            {preview.status === "accepted" ? <>If it was you, <Link className="font-medium text-primary hover:underline" href="/dashboard">open the app</Link>.</> : "Ask a workspace admin for a new invitation."}
          </Alert>
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <p className="eyebrow">Invitation</p>
              <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">Join {preview.workspace_name}</h1>
              <p className="text-[13.5px] text-muted-foreground">
                You&apos;ve been invited as <span className="font-medium text-foreground">{preview.role_name}</span>. The invitation is for <span className="font-medium text-foreground">{preview.email}</span>.
              </p>
            </div>
            {emailMatches ? (
              <AcceptInvitation token={token} workspaceName={preview.workspace_name} />
            ) : (
              <Alert variant="warning" title="Signed in with a different email">
                <span className="flex items-start gap-1.5"><MailWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />You&apos;re signed in as {user?.email}. Sign out, then sign in or create an account with {preview.email} and open this link again.</span>
              </Alert>
            )}
            {!emailMatches ? (
              <Button asChild variant="outline" className="w-full"><Link href="/signup">Create an account</Link></Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
