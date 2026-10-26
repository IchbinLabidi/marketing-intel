"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";

type Result = { ok: boolean; error?: string; message?: string; data?: { contentItemId: string } };
type Option = { id: string; name: string };
const WEBSITE_PLATFORMS: Platform[] = ["blog", "newsletter", "linkedin", "facebook", "instagram"];

/** "Add to Editorial Calendar" for an SEO brief: date, campaign, pillar, channel and website format. */
export function AddToCalendarDialog({ run, projectId, campaigns, pillars, formats, defaultFormat }: {
  run: (input: { date: string | null; campaign_id: string; pillar_id: string; platform: Platform; format: string }) => Promise<Result>;
  projectId: string; campaigns: Option[]; pillars: Option[]; formats: readonly string[]; defaultFormat: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const r = await run({
      date: String(f.get("date") || "") || null, campaign_id: String(f.get("campaign_id") ?? ""), pillar_id: String(f.get("pillar_id") ?? ""),
      platform: String(f.get("platform")) as Platform, format: String(f.get("format")),
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message ?? "Added");
    setOpen(false);
    if (r.data) router.push(`/p/${projectId}/production?item=${r.data.contentItemId}`); else router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><CalendarPlus /> Add to Editorial Calendar</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Editorial Calendar</DialogTitle>
          <DialogDescription>Creates a planned item with this brief (and the draft, if written). Nothing is published.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="cal-date">Date</Label><Input id="cal-date" name="date" type="date" /></div>
          <div className="grid gap-1.5"><Label htmlFor="cal-platform">Channel</Label>
            <NativeSelect id="cal-platform" name="platform" defaultValue="blog">{WEBSITE_PLATFORMS.map((p) => <option key={p} value={p}>{p === "blog" ? "Website / blog" : PLATFORM_LABELS[p]}</option>)}</NativeSelect>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="cal-format">Format</Label>
            <NativeSelect id="cal-format" name="format" defaultValue={defaultFormat}>{formats.map((x) => <option key={x}>{x}</option>)}</NativeSelect>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="cal-pillar">Content pillar</Label>
            <NativeSelect id="cal-pillar" name="pillar_id" defaultValue=""><option value="">None</option>{pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
          </div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="cal-campaign">Campaign</Label>
            <NativeSelect id="cal-campaign" name="campaign_id" defaultValue=""><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null} Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
