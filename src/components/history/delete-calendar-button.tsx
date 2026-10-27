"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCalendarAction } from "@/server/actions/history-intelligence";
import { confirm } from "@/components/ui/confirm";

export function DeleteCalendarButton({ projectId, calendarId, name }: { projectId: string; calendarId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (!(await confirm({ title: `Delete “${name}”?`, description: "Its planned items are deleted too. This cannot be undone.", confirmLabel: "Delete calendar", destructive: true }))) return;
          const r = await deleteCalendarAction(projectId, calendarId);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          router.push(`/p/${projectId}/calendar`);
        })
      }
    >
      <Trash2 /> Delete calendar
    </Button>
  );
}
