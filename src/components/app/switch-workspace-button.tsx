"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { switchWorkspaceAction } from "@/server/actions/workspaces";

export function SwitchWorkspaceButton({ workspaceId, label }: { workspaceId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await switchWorkspaceAction(workspaceId);
        router.push("/dashboard");
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
