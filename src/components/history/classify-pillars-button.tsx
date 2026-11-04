"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { classifyPillarsAction } from "@/server/actions/history-intelligence";
import { useT } from "@/i18n/client";

/** Assigns pillars with AI in batches until every post with text has been checked, showing progress. */
export function ClassifyPillarsButton({ projectId, aiEnabled }: { projectId: string; aiEnabled: boolean }) {
  const router = useRouter();
  const t = useT("history");
  const [progress, setProgress] = React.useState<{ assigned: number; unmatched: number; remaining: number } | null>(null);
  const [pending, setPending] = React.useState(false);

  const run = async () => {
    setPending(true);
    const total = { assigned: 0, unmatched: 0, remaining: 0 };
    let failed = false;
    for (let batch = 0; batch < 20; batch++) {
      const r = await classifyPillarsAction(projectId);
      if (!r.ok) {
        toast.error(total.assigned + total.unmatched ? t("classify.partialError", { error: r.error ?? "", count: total.assigned + total.unmatched }) : r.error);
        failed = true;
        break;
      }
      total.assigned += r.data?.assigned ?? 0;
      total.unmatched += r.data?.unmatched ?? 0;
      total.remaining = r.data?.remaining ?? 0;
      setProgress({ ...total });
      if (!total.remaining) break;
    }
    setPending(false);
    if (!failed) toast.success(total.remaining ? t("classify.doneRemaining", { assigned: total.assigned, unmatched: total.unmatched, remaining: total.remaining }) : t("classify.done", { assigned: total.assigned, unmatched: total.unmatched }));
    router.refresh();
  };

  return (
    <Button size="sm" variant="outline" disabled={pending || !aiEnabled} title={!aiEnabled ? t("common.aiDisabled") : undefined} onClick={run}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending
        ? progress
          ? t("classify.progress", { done: progress.assigned + progress.unmatched, remaining: progress.remaining })
          : t("classify.assigning")
        : t("classify.button")}
    </Button>
  );
}
