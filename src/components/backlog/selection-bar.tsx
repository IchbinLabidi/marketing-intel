"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm";
import { unplanIdeasAction } from "@/server/actions/backlog";

/** Multi-select state shared by lists: toggle one, select or clear all of the given ids. */
export function useSelection() {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggle = React.useCallback((id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setAll = React.useCallback((ids: string[], on: boolean) => setSelected((s) => { const n = new Set(s); for (const id of ids) if (on) n.add(id); else n.delete(id); return n; }), []);
  const clear = React.useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, setAll, clear };
}

/** Header checkbox: checked when every id is selected, mixed when some are. */
export function SelectAllBox({ ids, selected, onChange, label = "Select all" }: { ids: string[]; selected: Set<string>; onChange: (on: boolean) => void; label?: string }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const n = ids.filter((id) => selected.has(id)).length;
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = n > 0 && n < ids.length; }, [n, ids.length]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={ids.length > 0 && n === ids.length} onChange={(e) => onChange(e.target.checked)} onClick={(e) => e.stopPropagation()} />;
}

/** Sticky bar for a selection: "Back to Backlog" clears the calendar dates of ideas and briefs (their content, production
 *  stage and approvals stay); scheduled and published posts are skipped. */
export function BackToBacklogBar({ projectId, ids, onClear, onDone, children }: { projectId: string; ids: string[]; onClear: () => void; onDone?: () => void; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  if (!ids.length) return null;
  const run = async () => {
    if (ids.length > 20 && !(await confirm({ title: `Move ${ids.length} items back to the Backlog?`, description: "Their calendar dates are cleared. Ideas and briefs keep their content, production stage and approvals. Scheduled and published posts are left as they are.", confirmLabel: "Back to Backlog" }))) return;
    setBusy(true);
    const r = await unplanIdeasAction(projectId, ids);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Moved back to the Backlog");
    onClear();
    onDone?.();
    router.refresh();
  };
  return (
    <div className="sticky top-2 z-20 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2 shadow-sm">
      <span className="px-1 text-[13px] font-medium">{ids.length} selected</span>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <Undo2 />} Back to Backlog</Button>
      {children}
      <Button size="sm" variant="ghost" onClick={onClear}><X /> Clear</Button>
    </div>
  );
}
