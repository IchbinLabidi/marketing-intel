"use client";

import { CalendarPlus, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentItem } from "@/types/domain";
import { useFormatter, useT } from "@/i18n/client";

type Entry = { post: ContentItem; time: string | null };

/** Phone-sized agenda: one list grouped by day (publications) with that day's internal deadlines. */
export function AgendaView({
  days, byDate, deadlinesByDate, today, card, onCreate, readOnly,
}: {
  days: string[]; byDate: Map<string, Entry[]>; deadlinesByDate: Map<string, ContentItem[]>; today: string;
  card: (e: Entry) => React.ReactNode; onCreate: (d: string) => void; readOnly: boolean;
}) {
  const t = useT("calendar");
  const tc = useT("common");
  const fmt = useFormatter();
  const label = (d: string) => fmt.day(d, { weekday: "short", day: "numeric", month: "short" });
  const shown = days.filter((d) => (byDate.get(d)?.length ?? 0) + (deadlinesByDate.get(d)?.length ?? 0) > 0 || d === today);
  return (
    <ol className="space-y-4">
      {shown.map((d) => (
        <li key={d} className="space-y-2">
          <div className="flex items-center justify-between">
            <p className={cn("text-[13px] font-semibold", d === today && "text-primary")}>{d === today ? t("agenda.today", { date: label(d) }) : label(d)}</p>
            {!readOnly ? (
              <button type="button" onClick={() => onCreate(d)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                <CalendarPlus className="size-3.5" /> {tc("actions.add")}
              </button>
            ) : null}
          </div>
          {(deadlinesByDate.get(d) ?? []).map((p) => (
            <p key={`dl-${p.id}`} className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
              <Flag className="size-3 text-warning" /> {t("agenda.deadline")} <span className="truncate font-medium text-foreground" dir="auto">{p.title}</span>
            </p>
          ))}
          <div className="space-y-1.5">{(byDate.get(d) ?? []).map((e) => card(e))}</div>
          {!(byDate.get(d)?.length) && !(deadlinesByDate.get(d)?.length) ? <p className="text-xs text-muted-foreground">{t("agenda.nothingToday")}</p> : null}
        </li>
      ))}
      {!shown.length ? <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">{t("empty.readOnly")}</p> : null}
    </ol>
  );
}
