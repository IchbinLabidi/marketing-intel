import type { WorkflowState } from "@/lib/domain/constants";

// Workflow state styles. Each state also carries a label and an icon in the UI, never colour alone.
export const STATE_STYLE: Record<WorkflowState, { dot: string; card: string; badge: "secondary" | "warning" | "default" | "success" | "destructive" | "outline" }> = {
  draft: { dot: "bg-muted-foreground/50", card: "border-l-muted-foreground/40", badge: "secondary" },
  pending: { dot: "bg-warning", card: "border-l-warning", badge: "warning" },
  approved: { dot: "bg-violet-500", card: "border-l-violet-500", badge: "outline" },
  scheduled: { dot: "bg-primary", card: "border-l-primary", badge: "default" },
  published: { dot: "bg-success", card: "border-l-success", badge: "success" },
  failed: { dot: "bg-destructive", card: "border-l-destructive", badge: "destructive" },
};

const PILLAR_COLORS: Record<string, string> = {
  indigo: "bg-indigo-500", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", sky: "bg-sky-500", violet: "bg-violet-500", slate: "bg-slate-500",
};
const FALLBACK_ORDER = ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"];

/** Same colour assignment as the strategy's pillar list: the chosen colour, else a stable one by position. */
export function pillarDotClass(pillars: { id: string; color: string | null }[], id: string | null) {
  if (!id) return null;
  const k = pillars.findIndex((p) => p.id === id);
  if (k < 0) return null;
  return PILLAR_COLORS[pillars[k].color ?? FALLBACK_ORDER[k % FALLBACK_ORDER.length]] ?? "bg-primary";
}
