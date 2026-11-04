"use client";

import * as React from "react";
import { BarChart3, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import type { Platform } from "@/lib/domain/constants";
import type { Signal } from "@/lib/opportunities/signals";
import { cn } from "@/lib/utils";
import { GenerateDialog } from "./opportunity-dialogs";
import { useFormatter, useT } from "@/i18n/client";

const GROUPS = ["historical", "strategy", "competitor"] as const satisfies readonly Signal["category"][];

/** The calculated facts the engine may cite, shown as-is so anyone can check what ideas are built on. */
export function SignalsPanel({ projectId, signals, posts, pillars, canGenerate }: {
  projectId: string; signals: Signal[]; posts: number; pillars: { id: string; name: string }[]; canGenerate: boolean;
}) {
  const t = useT("opportunities");
  const fmt = useFormatter();
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState<Signal | null>(null);
  const shown = open ? signals : signals.slice(0, 0);
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[14px] font-semibold"><BarChart3 className="size-4" /> {t("signals.panel.title")}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {t("signals.panel.summary", { signals: t("signals.panel.signals", { count: signals.length }), posts: t("signals.panel.posts", { count: posts }) })}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-4 border-t p-4">
          {!signals.length ? <p className="text-[13px] text-muted-foreground">{t("signals.panel.empty")}</p> : null}
          {GROUPS.map((g) => {
            const list = shown.filter((s) => s.category === g);
            if (!list.length) return null;
            return (
              <div key={g}>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">{t(`signals.panel.groups.${g}`)}</p>
                <ul className="divide-y rounded-lg border">
                  {list.map((s) => (
                    <li key={s.key} className="flex items-start gap-3 p-2.5 text-[13px]">
                      {s.platform ? <PlatformIcon platform={s.platform} className="mt-0.5 text-muted-foreground" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
                      <span className="min-w-0 flex-1">
                        {s.statement}
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{s.method}</span>
                      </span>
                      {s.lift != null ? <span className={cn("shrink-0 text-xs tabular-nums", s.lift >= 1.25 ? "text-success" : s.lift <= 0.8 ? "text-warning" : "text-muted-foreground")}>×{fmt.number(s.lift)}</span> : null}
                      {canGenerate ? (
                        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setFrom(s)} title={t("signals.panel.ideasHelp")}><Sparkles /> {t("signals.panel.ideas")}</Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
      {from ? (
        <GenerateDialog
          projectId={projectId}
          pillars={pillars}
          initial={{ platform: (from.platform ?? undefined) as Platform | undefined, pillar_id: from.pillar_id ?? undefined, instruction: t("signals.panel.buildOn", { statement: from.statement }) }}
          onClose={() => setFrom(null)}
        />
      ) : null}
    </section>
  );
}
