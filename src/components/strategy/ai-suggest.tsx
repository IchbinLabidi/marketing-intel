"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { suggestStrategyAction } from "@/server/actions/strategy";
import type { StrategySection } from "@/server/ai/strategy";

export type SuggestionNotes = { assumptions: string[]; questions: string[] };

/**
 * "Suggest with AI" flow: optional instruction → Claude call → review dialog.
 * Nothing is saved until the user explicitly applies the suggestion.
 */
export function AISuggest<T extends { notes: SuggestionNotes }>({
  projectId,
  section,
  label = "Suggest with AI",
  disabled,
  aiEnabled,
  renderPreview,
  onApply,
  applyLabel = "Apply to form",
}: {
  projectId: string;
  section: StrategySection;
  label?: string;
  disabled?: boolean;
  aiEnabled: boolean;
  renderPreview: (data: T, selection: { selected: Set<number>; toggle: (i: number) => void }) => React.ReactNode;
  onApply: (data: T, selected: Set<number>) => Promise<boolean | void> | boolean | void;
  applyLabel?: string;
}) {
  const [stage, setStage] = React.useState<"closed" | "ask" | "loading" | "review">("closed");
  const [instruction, setInstruction] = React.useState("");
  const [data, setData] = React.useState<T | null>(null);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [applying, setApplying] = React.useState(false);

  const run = async () => {
    setStage("loading");
    const result = await suggestStrategyAction(projectId, section, instruction || undefined);
    if (!result.ok) {
      toast.error(result.error);
      setStage("ask");
      return;
    }
    const d = result.data as T;
    setData(d);
    const items = (d as unknown as { items?: unknown[]; stages?: unknown[] }).items ?? (d as unknown as { stages?: unknown[] }).stages;
    setSelected(new Set(items ? items.map((_, i) => i) : []));
    setStage("review");
  };

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !aiEnabled}
        title={aiEnabled ? undefined : "Add GEMINI_API_KEY or ANTHROPIC_API_KEY to enable AI features"}
        onClick={() => setStage(data ? "review" : "ask")}
      >
        <Sparkles className="text-primary" /> {label}
      </Button>
      <Dialog open={stage !== "closed"} onOpenChange={(o) => !o && stage !== "loading" && setStage("closed")}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI suggestion</DialogTitle>
            <DialogDescription>
              Based only on what this project contains. Review and edit before saving; assumptions are listed below.
            </DialogDescription>
          </DialogHeader>
          {stage === "ask" || stage === "loading" ? (
            <div className="grid gap-3">
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Optional: steer the suggestion (e.g. “focus on B2B buyers”, “more premium positioning”)"
                rows={3}
                disabled={stage === "loading"}
              />
              <DialogFooter>
                <Button onClick={run} disabled={stage === "loading"}>
                  {stage === "loading" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {stage === "loading" ? "Thinking… this can take up to a minute" : "Generate"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
          {stage === "review" && data ? (
            <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
              {renderPreview(data, { selected, toggle })}
              {data.notes.assumptions.length || data.notes.questions.length ? (
                <div className="grid gap-3 rounded-lg border bg-muted/40 p-3 text-[13px]">
                  {data.notes.assumptions.length ? (
                    <div>
                      <p className="mb-1 font-medium">Assumptions made</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                        {data.notes.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {data.notes.questions.length ? (
                    <div>
                      <p className="mb-1 font-medium">Questions that would sharpen this</p>
                      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                        {data.notes.questions.map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {stage === "review" && data ? (
            <DialogFooter>
              <Button variant="outline" onClick={() => setStage("ask")}>
                Regenerate
              </Button>
              <Button
                disabled={applying}
                onClick={async () => {
                  setApplying(true);
                  const ok = await onApply(data, selected);
                  setApplying(false);
                  if (ok !== false) {
                    setStage("closed");
                    setData(null);
                  }
                }}
              >
                {applying ? <Loader2 className="animate-spin" /> : null}
                {applyLabel}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PreviewField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-[13px]">{value}</p>
    </div>
  );
}
