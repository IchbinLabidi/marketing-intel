"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { reschedulePostAction } from "@/server/actions/calendar";
import { recheckCalendarAction } from "@/server/actions/editorial";
import { confirm } from "@/components/ui/confirm";
import { useT } from "@/i18n/client";

/** Changes a post's publication date (same rules and conflict checks as the calendar), then re-runs the optimizer. */
export function PostDate({ projectId, calendarId, id, date, time, min, max, disabled }: {
  projectId: string; calendarId: string; id: string; date: string | null; time: string | null; min: string; max: string; disabled?: boolean;
}) {
  const router = useRouter();
  const t = useT("editorial");
  const [busy, setBusy] = React.useState(false);
  const change = async (value: string) => {
    if (!value || value === date) return;
    setBusy(true);
    let r = await reschedulePostAction(projectId, id, value, time?.slice(0, 5) ?? null);
    if (r.ok && r.data?.conflicts?.length) {
      if (!(await confirm({ title: t("postDate.conflictTitle"), description: t("postDate.conflictDescription", { count: r.data.conflicts.length, titles: r.data.conflicts.map((c) => c.title).join(", ") }), confirmLabel: t("postDate.keepBoth") }))) { setBusy(false); return; }
      r = await reschedulePostAction(projectId, id, value, time?.slice(0, 5) ?? null, true);
    }
    if (!r.ok) { setBusy(false); return toast.error(r.error); }
    await recheckCalendarAction(projectId, calendarId);
    setBusy(false);
    toast.success(t("postDate.changed"));
    router.refresh();
  };
  return <Input type="date" aria-label={t("postDate.label")} className="h-8 w-40" defaultValue={date ?? ""} min={min} max={max} disabled={disabled || busy} onBlur={(e) => void change(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void change((e.target as HTMLInputElement).value); }} />;
}
