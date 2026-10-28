"use client";

import { Popover } from "radix-ui";
import { Info } from "lucide-react";
import type { Explanation } from "@/lib/analytics/ceo";
import { cn } from "@/lib/utils";

const TONE = {
  good: { label: "Good", className: "bg-success/10 text-success" },
  watch: { label: "Worth watching", className: "bg-warning/12 text-[color-mix(in_oklch,var(--warning)_72%,black)]" },
  attention: { label: "Needs attention", className: "bg-destructive/8 text-destructive" },
  neutral: { label: "For information", className: "bg-secondary text-muted-foreground" },
} as const;

/** The "i" next to a KPI or chart: plain definition, an example from the current figures, why it matters, how to read it, what to do. */
export function InfoTip({ info, expert = false, className }: { info: Explanation | undefined; expert?: boolean; className?: string }) {
  if (!info) return null;
  const tone = TONE[info.tone];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`What does “${info.title}” mean?`}
          className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 print:hidden", className)}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom" align="start" sideOffset={6} collisionPadding={12}
          className="z-50 w-[min(22rem,calc(100vw-24px))] space-y-2.5 rounded-xl border bg-popover p-4 text-[13px] leading-relaxed text-popover-foreground shadow-lg data-[state=open]:animate-fade-in"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{info.title}</p>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", tone.className)}>{tone.label}</span>
          </div>
          <Part label="What it means">{info.simple}</Part>
          <Part label="In your data">{info.example}</Part>
          <Part label="Why it matters">{info.why}</Part>
          <Part label="How to read it">{info.reading}</Part>
          {info.action ? <Part label="What to do">{info.action}</Part> : null}
          {expert && info.formula ? <Part label="Formula"><span className="font-mono text-[12px]">{info.formula}</span></Part> : null}
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p>{children}</p>
    </div>
  );
}
