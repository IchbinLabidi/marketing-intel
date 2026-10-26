"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, FileText, Lightbulb, Loader2, Lock, LockOpen, PenLine, RefreshCcw, Sparkles, Trash2 } from "lucide-react";

const ICONS = { sparkles: Sparkles, file: FileText, lightbulb: Lightbulb, refresh: RefreshCcw, trash: Trash2, pen: PenLine, calendar: CalendarPlus, lock: Lock, unlock: LockOpen, check: CheckCircle2 };
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };

/**
 * A button running one (bound) server action, with loading state, toast and refresh. `href` navigates afterwards;
 * "{id}" in it is replaced by the result's id (data.id or data.ids[0]). Usable from server components.
 */
export function ActionButton({ label, busyLabel, icon, run, href, variant = "outline", disabled, title, confirm }: {
  label: string; busyLabel?: string; icon?: keyof typeof ICONS; run: () => Promise<Result>; href?: string;
  variant?: "default" | "outline" | "ghost" | "destructive"; disabled?: boolean; title?: string; confirm?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const Icon = icon ? ICONS[icon] : null;
  const go = async () => {
    setAsking(false);
    setBusy(true);
    const r = await run();
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    if (r.message) toast.success(r.message);
    const d = r.data as { id?: string; ids?: string[] } | undefined;
    const id = d?.id ?? d?.ids?.[0];
    if (href && (!href.includes("{id}") || id)) router.push(href.replace("{id}", id ?? "")); else router.refresh();
  };
  if (asking) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 text-xs" role="alert">
        {confirm}
        <Button size="sm" variant="destructive" onClick={go}>Confirm</Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
      </span>
    );
  }
  return (
    <Button size="sm" variant={variant} disabled={disabled || busy} title={title} onClick={() => (confirm ? setAsking(true) : go())}>
      {busy ? <Loader2 className="animate-spin" /> : Icon ? <Icon /> : null} {busy ? busyLabel ?? label : label}
    </Button>
  );
}
