"use client";

import { CalendarPlus, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentItem } from "@/types/domain";

type Entry = { post: ContentItem; time: string | null };

const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Phone-sized agenda: one list grouped by day (publications) with that day's internal deadlines. */
export function AgendaView({
  days, byDate, deadlinesByDate, today, card, onCreate, readOnly,
}: {
  days: string[]; byDate: Map<string, Entry[]>; deadlinesByDate: Map<string, ContentItem[]>; today: string;
  card: (e: Entry) => React.ReactNode; onCreate: (d: string) => void; readOnly: boolean;
}) {
  const shown = days.filter((d) => (byDate.get(d)?.length ?? 0) + (deadlinesByDate.get(d)?.length ?? 0) > 0 || d === today);
  return (
    <ol className="space-y-4">
      {shown.map((d) => (
        <li key={d} className="space-y-2">
          <div className="flex items-center justify-between">
            <p className={cn("text-[13px] font-semibold", d === today && "text-primary")}>{label(d)}{d === today ? " · Today" : ""}</p>
            {!readOnly ? (
              <button type="button" onClick={() => onCreate(d)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                <CalendarPlus className="size-3.5" /> Add
              </button>
            ) : null}
          </div>
          {(deadlinesByDate.get(d) ?? []).map((p) => (
            <p key={`dl-${p.id}`} className="flex items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
              <Flag className="size-3 text-warning" /> Deadline: <span className="truncate font-medium text-foreground" dir="auto">{p.title}</span>
            </p>
          ))}
          <div className="space-y-1.5">{(byDate.get(d) ?? []).map((e) => card(e))}</div>
          {!(byDate.get(d)?.length) && !(deadlinesByDate.get(d)?.length) ? <p className="text-xs text-muted-foreground">Nothing planned today.</p> : null}
        </li>
      ))}
      {!shown.length ? <p className="rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">Nothing planned in this period.</p> : null}
    </ol>
  );
}
