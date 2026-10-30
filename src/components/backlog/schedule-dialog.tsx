"use client";

import * as React from "react";
import { CalendarPlus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { confirm } from "@/components/ui/confirm";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { WEEKDAY_LABELS } from "@/lib/calendar/insights";
import type { SuggestedSlot } from "@/lib/backlog/slots";
import { placeIdeaAction } from "@/server/actions/backlog";
import { PlatformIcon } from "@/components/calendar/platform-icon";

const CHOICES = ["facebook", "instagram", "tiktok", "linkedin", "youtube"] as const;
export const slotLabel = (date: string, time: string) => `${WEEKDAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${date.slice(8)}/${date.slice(5, 7)}, ${time}`;

/**
 * Places an idea on the calendar (planning only). Shows the suggested time and alternatives, lets the person adjust
 * the date, time and platforms, and confirms. Publishing stays a separate, explicit step.
 */
export function ScheduleDialog({ projectId, idea, date: initialDate, tz, onClose, onPlaced }: {
  projectId: string; tz: string;
  idea: { id: string; title: string; platform: string | null; target_platforms: string[]; suggested_slot: SuggestedSlot | null };
  date?: string | null; onClose: () => void; onPlaced: () => void;
}) {
  const s = idea.suggested_slot;
  const sameDay = initialDate && s ? [s, ...s.alternatives].find((x) => x.date === initialDate) : null;
  const [date, setDate] = React.useState(initialDate ?? s?.date ?? "");
  const [time, setTime] = React.useState(sameDay?.time ?? s?.time ?? "19:00");
  const [platforms, setPlatforms] = React.useState<string[]>(idea.target_platforms?.length ? idea.target_platforms : idea.platform ? [idea.platform] : ["facebook"]);
  const [busy, setBusy] = React.useState(false);
  const options = s ? [{ date: s.date, time: s.time, best: true }, ...s.alternatives.map((a) => ({ ...a, best: false }))] : [];

  const save = async (force = false) => {
    setBusy(true);
    const r = await placeIdeaAction(projectId, idea.id, { date, time: time || null, platforms, force });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    if (r.data?.conflicts?.length) {
      const ok = await confirm({ title: "Another post is planned close to this time", description: r.data.conflicts.map((c) => `${c.time} · ${c.title}`).join("\n"), confirmLabel: "Plan anyway" });
      if (ok) return save(true);
      return;
    }
    toast.success(r.message ?? "Planned");
    onPlaced();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarPlus className="size-4" /> Add to calendar</DialogTitle>
          <DialogDescription className="line-clamp-2">“{idea.title}”. This only plans the post. Nothing is scheduled on a platform or published.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-[13px]">
          {options.length ? (
            <section className="space-y-2">
              <p className="flex items-center gap-1.5 font-medium"><Sparkles className="size-3.5 text-primary" /> Suggested times <span className="text-xs font-normal text-muted-foreground">({s!.source === "analytics" ? "from your posts" : "heuristic"}, confidence {s!.confidence})</span></p>
              <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                  <button key={`${o.date}${o.time}`} type="button" onClick={() => { setDate(o.date); setTime(o.time); }}
                    className={`rounded-md border px-2.5 py-1.5 text-xs ${date === o.date && time === o.time ? "border-primary bg-primary-soft text-primary" : "hover:bg-muted"}`}>
                    {o.best ? "★ " : ""}{slotLabel(o.date, o.time)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{s!.reason}</p>
            </section>
          ) : null}
          <section className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Date</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="space-y-1"><span className="text-xs text-muted-foreground">Time ({tz})</span><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </section>
          <section className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Platforms</p>
            <div className="flex flex-wrap gap-3">
              {CHOICES.map((p) => (
                <label key={p} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={platforms.includes(p)} onChange={() => setPlatforms((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]))} />
                  <PlatformIcon platform={p} /> {PLATFORM_LABELS[p as Platform]}
                </label>
              ))}
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => save()} disabled={busy || !date || !platforms.length}>{busy ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Confirm placement</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
