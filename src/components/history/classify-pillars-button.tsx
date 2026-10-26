"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { classifyPillarsAction } from "@/server/actions/history-intelligence";

/** Assigns pillars with AI in batches until every post with text has been checked, showing progress. */
export function ClassifyPillarsButton({ projectId, aiEnabled }: { projectId: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = React.useState<{ assigned: number; unmatched: number; remaining: number } | null>(null);
  const [pending, setPending] = React.useState(false);

  const run = async () => {
    setPending(true);
    const total = { assigned: 0, unmatched: 0, remaining: 0 };
    let failed = false;
    for (let batch = 0; batch < 20; batch++) {
      const r = await classifyPillarsAction(projectId);
      if (!r.ok) {
        toast.error(total.assigned + total.unmatched ? `${r.error} (${total.assigned + total.unmatched} posts were saved before this)` : r.error);
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
    if (!failed) toast.success(`${total.assigned} posts assigned to a pillar (AI); ${total.unmatched} fit none${total.remaining ? `; ${total.remaining} left, click again to continue` : ""}`);
    router.refresh();
  };

  return (
    <Button size="sm" variant="outline" disabled={pending || !aiEnabled} title={!aiEnabled ? "Add GEMINI_API_KEY or ANTHROPIC_API_KEY to enable AI features" : undefined} onClick={run}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending
        ? progress
          ? `Assigning… ${progress.assigned + progress.unmatched} done, ${progress.remaining} left`
          : "Assigning…"
        : "Assign pillars with AI"}
    </Button>
  );
}
