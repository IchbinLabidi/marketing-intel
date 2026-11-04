"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "@/server/actions/team";
import { useT } from "@/i18n/client";

export function AcceptInvitation({ token, workspaceName }: { token: string; workspaceName: string }) {
  const router = useRouter();
  const t = useT("team");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    const r = await acceptInvitationAction(token);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    toast.success(t("accept.joined", { workspace: workspaceName }));
    router.push("/tasks");
  };
  return (
    <div className="space-y-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button size="lg" className="w-full" loading={busy} onClick={accept}>{t("accept.button")}</Button>
    </div>
  );
}
