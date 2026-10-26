"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { reschedulePostAction } from "@/server/actions/calendar";
import { recheckCalendarAction } from "@/server/actions/editorial";

/** Changes a post's publication date (same rules and conflict checks as the calendar), then re-runs the optimizer. */
export function PostDate({ projectId, calendarId, id, date, time, min, max, disabled }: {
  projectId: string; calendarId: string; id: string; date: string | null; time: string | null; min: string; max: string; disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const change = async (value: string) => {
    if (!value || value === date) return;
    setBusy(true);
    let r = await reschedulePostAction(projectId, id, value, time?.slice(0, 5) ?? null);
    if (r.ok && r.data?.conflicts?.length) {
      if (!window.confirm(`Another ${r.data.conflicts.length > 1 ? `${r.data.conflicts.length} posts are` : "post is"} scheduled within an hour on this platform (${r.data.conflicts.map((c) => c.title).join(", ")}). Keep both?`)) { setBusy(false); return; }
      r = await reschedulePostAction(projectId, id, value, time?.slice(0, 5) ?? null, true);
    }
    if (!r.ok) { setBusy(false); return toast.error(r.error); }
    await recheckCalendarAction(projectId, calendarId);
    setBusy(false);
    toast.success("Date changed; calendar re-checked");
    router.refresh();
  };
  return <Input type="date" aria-label="Publication date" className="h-8 w-40" defaultValue={date ?? ""} min={min} max={max} disabled={disabled || busy} onBlur={(e) => void change(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void change((e.target as HTMLInputElement).value); }} />;
}
