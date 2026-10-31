"use client";

import * as React from "react";
import { Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/app/form";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { refreshSuggestionsAction, updateIdeaAction } from "@/server/actions/backlog";
import { PlatformIcon } from "./platform-icon";
import { savePostAction, updatePlanningAction } from "@/server/actions/calendar";
import type { ContentItem } from "@/types/domain";
import type { Person } from "./planning";

/** Platforms an idea can target (several at once). */
const IDEA_PLATFORMS = ["facebook", "instagram", "linkedin", "tiktok", "youtube"] as const;
const TYPES = ["Social caption", "Instagram Reel", "Carousel", "Story sequence", "Facebook video", "Article"];

/**
 * Fast "idea on this date": title, platform, type and (optionally) an owner and a deadline.
 * Creates a planned draft through the same action as the full editor, so validation and permissions are identical.
 */
export function QuickCreate({
  projectId, date, time, platform, people, canAssign, onClose, onCreated, onMore,
}: {
  projectId: string; date: string | null; time: string | null; platform: Platform; people: Person[]; canAssign: boolean;
  onClose: () => void; onCreated: (post: ContentItem) => void; onMore: (draft: { title: string; platform: Platform; format: string }) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [plats, setPlats] = React.useState<Platform[]>([platform]);
  const plat = plats[0] ?? platform;
  const togglePlat = (p: Platform) => setPlats((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const [format, setFormat] = React.useState(TYPES[0]);
  const [owner, setOwner] = React.useState("");
  const [deadline, setDeadline] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await savePostAction(projectId, null, { title, platform: plat, format, date, time, status: "planned" }, true);
    if (!r.ok || !r.data?.post) {
      setBusy(false);
      return setError(r.ok ? "Could not create the idea." : r.fieldErrors?.title ?? r.error);
    }
    let post = r.data.post;
    // every selected platform is kept on the idea (the first one is its main platform)
    const t = await updateIdeaAction(projectId, post.id, { target_platforms: plats });
    if (t.ok && t.data) post = t.data;
    if (!date) await refreshSuggestionsAction(projectId, [post.id]); // an undated idea goes to the Backlog with a suggested time
    if (owner || deadline) {
      const p = await updatePlanningAction(projectId, post.id, { ...(owner ? { assignee_id: owner } : {}), ...(deadline ? { due_date: deadline } : {}) });
      if (p.ok && p.data?.post) post = p.data.post;
      else if (!p.ok) toast.error(`Idea created, but: ${p.error}`);
    }
    setBusy(false);
    toast.success(`Idea added${date ? ` on ${date}${time ? ` ${time}` : ""}` : ""}`);
    onCreated(post);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-primary" /> New idea</DialogTitle>
          <DialogDescription>{date ? `Planned for ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}${time ? ` at ${time}` : ""}.` : "Not scheduled yet."} You can add the brief and collaborators next.</DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="grid gap-4">
          <Field label="Title" htmlFor="qc-title" required error={error ?? undefined}>
            <Input id="qc-title" autoFocus required maxLength={300} placeholder="What is this post about?" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Platforms <span className="font-normal text-muted-foreground">· one or several</span></legend>
            <div className="flex flex-wrap gap-2">
              {IDEA_PLATFORMS.map((p) => (
                <label key={p} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] ${plats.includes(p) ? "border-primary bg-primary-soft text-primary" : "hover:bg-muted"}`}>
                  <input type="checkbox" className="sr-only" checked={plats.includes(p)} onChange={() => togglePlat(p)} />
                  <PlatformIcon platform={p} /> {PLATFORM_LABELS[p]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="qc-type">
              <NativeSelect id="qc-type" value={format} onChange={(e) => setFormat(e.target.value)}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </NativeSelect>
            </Field>
            {canAssign ? (
              <Field label="Owner" htmlFor="qc-owner" optional>
                <NativeSelect id="qc-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">Unassigned</option>
                  {people.filter((p) => p.canEdit).map((p) => <option key={p.user_id} value={p.user_id}>{p.name || "Unnamed"}</option>)}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="Internal deadline" htmlFor="qc-deadline" optional>
              <Input id="qc-deadline" type="date" value={deadline} max={date ?? undefined} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => onMore({ title, platform: plat, format })}>More options</Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" loading={busy} disabled={!title.trim() || !plats.length}>Add idea</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
