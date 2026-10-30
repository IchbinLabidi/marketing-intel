"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Gap } from "@/lib/backlog/planner";
import { PlannerDialog } from "./planner-dialog";

const KEY = "calendar.dismissedGaps";
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };

/** Non-intrusive calendar hints (empty days, overloads, streaks, conflicts), each dismissible, plus the Planner. */
export function GapsPanel({ projectId, gaps, today, tz, pillars, canEdit }: { projectId: string; gaps: Gap[]; today: string; tz: string; pillars: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [planning, setPlanning] = React.useState(false);
  // browser storage is read after mount (it isn't available while rendering on the server)
  React.useEffect(() => { const d = readDismissed(); if (d.length) queueMicrotask(() => setDismissed(d)); }, []);
  const visible = gaps.filter((g) => !dismissed.includes(g.key));
  const dismiss = (key: string) => { const next = [...dismissed, key].slice(-200); setDismissed(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  return (
    <aside className="space-y-2.5 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-semibold"><AlertTriangle className="size-4 text-warning" /> Calendar check</p>
        {canEdit ? <Button size="sm" variant="outline" onClick={() => setPlanning(true)}><Sparkles /> Planner</Button> : null}
      </div>
      {visible.length ? (
        <ul className="space-y-2">{visible.map((g) => (
          <li key={g.key} className="flex items-start gap-2 text-xs"><span className="flex-1">{g.message}</span><button type="button" aria-label="Dismiss" onClick={() => dismiss(g.key)} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button></li>
        ))}</ul>
      ) : <p className="text-xs text-muted-foreground">Nothing to flag in this period.</p>}
      {planning ? <PlannerDialog projectId={projectId} today={today} tz={tz} pillars={pillars} onClose={() => setPlanning(false)} onSaved={() => { setPlanning(false); router.refresh(); }} /> : null}
    </aside>
  );
}
