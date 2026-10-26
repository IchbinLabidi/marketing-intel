"use client";

import * as React from "react";
import { useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveJourneyAction } from "@/server/actions/strategy";
import type { JourneyStage } from "@/types/domain";
import { AISuggest, type SuggestionNotes } from "./ai-suggest";

const blank = (): JourneyStage => ({ stage: "", goal: "", touchpoints: "", content_needs: "" });

export function JourneyEditor({
  projectId,
  initial,
  readOnly,
  aiEnabled,
}: {
  projectId: string;
  initial: JourneyStage[];
  readOnly: boolean;
  aiEnabled: boolean;
}) {
  const [stages, setStages] = React.useState<JourneyStage[]>(initial.length ? initial : []);
  const [dirty, setDirty] = React.useState(false);
  const [pending, startTransition] = useTransition();

  const update = (i: number, patch: Partial<JourneyStage>) => {
    setStages((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    setStages((s) => {
      const next = [...s];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      return next;
    });
    setDirty(true);
  };
  const save = () =>
    startTransition(async () => {
      const r = await saveJourneyAction(projectId, stages);
      if (r.ok) {
        toast.success(r.message);
        setDirty(false);
      } else toast.error(r.fieldErrors ? "Each stage needs a name." : r.error);
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : " "}</p>
        {!readOnly ? (
          <AISuggest<{ stages: JourneyStage[]; notes: SuggestionNotes }>
            projectId={projectId}
            section="customer_journey"
            aiEnabled={aiEnabled}
            label={stages.length ? "Improve with AI" : "Draft with AI"}
            applyLabel="Replace journey in editor"
            renderPreview={(d) => (
              <ol className="grid gap-2">
                {d.stages.map((s, i) => (
                  <li key={i} className="rounded-lg border p-3 text-[13px]">
                    <p className="font-medium">{i + 1}. {s.stage}</p>
                    <p className="text-muted-foreground">{s.goal}</p>
                    <p className="mt-1 text-xs"><span className="text-muted-foreground">Touchpoints:</span> {s.touchpoints}</p>
                    <p className="text-xs"><span className="text-muted-foreground">Content needs:</span> {s.content_needs}</p>
                  </li>
                ))}
              </ol>
            )}
            onApply={(d) => {
              setStages(d.stages);
              setDirty(true);
            }}
          />
        ) : null}
      </div>

      {stages.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
          No journey stages yet. Map how a customer goes from discovering the brand to buying again.
        </p>
      ) : (
        <ol className="grid gap-3">
          {stages.map((s, i) => (
            <li key={i} className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                <Input value={s.stage} onChange={(e) => update(i, { stage: e.target.value })} placeholder="Stage name (e.g. Discovery)" disabled={readOnly} className="font-medium" />
                {!readOnly ? (
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></Button>
                    <Button variant="ghost" size="icon-sm" disabled={i === stages.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => { setStages((st) => st.filter((_, j) => j !== i)); setDirty(true); }} aria-label="Remove stage"><Trash2 /></Button>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Textarea rows={2} value={s.goal ?? ""} onChange={(e) => update(i, { goal: e.target.value })} placeholder="Customer goal" disabled={readOnly} />
                <Textarea rows={2} value={s.touchpoints ?? ""} onChange={(e) => update(i, { touchpoints: e.target.value })} placeholder="Touchpoints" disabled={readOnly} />
                <Textarea rows={2} value={s.content_needs ?? ""} onChange={(e) => update(i, { content_needs: e.target.value })} placeholder="Content needs" disabled={readOnly} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {!readOnly ? (
        <div className="flex justify-between">
          <Button variant="outline" size="sm" onClick={() => { setStages((s) => [...s, blank()]); setDirty(true); }} disabled={stages.length >= 12}>
            <Plus /> Add stage
          </Button>
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save journey
          </Button>
        </div>
      ) : null}
    </div>
  );
}
