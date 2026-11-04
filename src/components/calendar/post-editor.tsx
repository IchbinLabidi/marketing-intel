"use client";

import { isDrivePickerOpen } from "./drive-picker";
import { PublishDialog } from "./publish-dialog";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Info, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/app/form";
import {
  CALENDAR_PLATFORMS, FUNNEL_STAGES, PLATFORMS,
  type ContentStatus, type FunnelStage, type Platform,
} from "@/lib/domain/constants";
import { windowLabel, type PlatformTiming } from "@/lib/calendar/insights";
import { todayInZone, utcToZoned, weekdayLabel, weekdayOf } from "@/lib/calendar/time";
import { useFormatter, useT } from "@/i18n/client";
import {
  confirmPublishedAction, deletePostAction, duplicatePostAction, generatePostAction, savePostAction, type Conflict,
} from "@/server/actions/calendar";
import type { ContentItem } from "@/types/domain";
import { stateOf, StatePill } from "./post-card";
import { domainLabel } from "./planning";

type Option = { id: string; name: string };
/** `prefill` seeds a new post (e.g. from a content opportunity); `opportunity_id` links the saved post to it. */
export type EditorDefaults = {
  date: string | null;
  time: string | null;
  platform: Platform;
  prefill?: Partial<Pick<Form, "title" | "format" | "pillar_id" | "funnel_stage" | "hook" | "caption" | "cta" | "creative_brief">>;
  opportunity_id?: string;
};

const FORMATS = [
  { value: "Carousel", key: "carousel" }, { value: "Reel", key: "reel" }, { value: "Image post", key: "imagePost" }, { value: "Story", key: "story" },
  { value: "Video", key: "video" }, { value: "Live", key: "live" }, { value: "Text post", key: "textPost" },
] as const;
const CAPTION_LIMIT: Partial<Record<Platform, number>> = { instagram: 2200, facebook: 63206 };
const DRAFT_STAGES: ContentStatus[] = ["idea", "planned", "brief_ready", "in_production"];

type Form = {
  title: string; platform: Platform; format: string; pillar_id: string; campaign_id: string; funnel_stage: string;
  date: string; time: string; hook: string; caption: string; cta: string; hashtags: string; creative_brief: string; media_url: string;
};

function toForm(post: ContentItem | null, d: EditorDefaults): Form {
  return {
    title: post?.title ?? "",
    platform: (post?.platform as Platform) ?? d.platform,
    format: post?.format ?? "",
    pillar_id: post?.pillar_id ?? "",
    campaign_id: post?.campaign_id ?? "",
    funnel_stage: post?.funnel_stage ?? "",
    date: post?.scheduled_date ?? d.date ?? "",
    time: post?.scheduled_time?.slice(0, 5) ?? d.time ?? "",
    hook: post?.hook ?? "",
    caption: post?.caption ?? "",
    cta: post?.cta ?? "",
    hashtags: (post?.hashtags ?? []).join(" "),
    creative_brief: post?.creative_brief ?? "",
    media_url: post?.media_url ?? "",
    ...(post ? {} : Object.fromEntries(Object.entries(d.prefill ?? {}).filter(([, v]) => v))),
  };
}

export function PostEditor({
  projectId, post, defaults, pillars, campaigns, tz, timing, aiEnabled, readOnly, onClose, onSaved, onDeleted,
}: {
  projectId: string;
  post: ContentItem | null;
  defaults: EditorDefaults;
  pillars: Option[];
  campaigns: Option[];
  tz: string;
  timing: PlatformTiming[];
  aiEnabled: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (post: ContentItem) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useT("calendar");
  const tc = useT("common");
  const td = useT("domain");
  const fmt = useFormatter();
  const [form, setForm] = React.useState<Form>(() => toForm(post, defaults));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [conflicts, setConflicts] = React.useState<{ list: Conflict[]; status: ContentStatus } | null>(null);
  const [instruction, setInstruction] = React.useState("");
  const [aiNotes, setAiNotes] = React.useState<{ rationale: string; assumptions: string[]; suggested: string | null } | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const state = post ? stateOf(post) : "draft";
  const locked = post?.status === "published" || post?.status === "failed";
  const platformTiming = timing.find((x) => x.platform === form.platform);
  const weekday = form.date ? weekdayOf(form.date) : null;
  const suggestions = platformTiming?.suggestions ?? [];
  const sameDay = weekday != null ? suggestions.filter((s) => s.weekday === weekday) : [];
  const limit = CAPTION_LIMIT[form.platform];

  const save = async (status: ContentStatus, force = false) => {
    setBusy(status);
    setErrors({});
    const r = await savePostAction(projectId, post?.id ?? null, { ...form, status, opportunity_id: post ? null : defaults.opportunity_id ?? null }, force);
    setBusy(null);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return toast.error(r.error);
    }
    if (r.data?.conflicts?.length) return setConflicts({ list: r.data.conflicts, status });
    setConflicts(null);
    toast.success(r.message);
    if (r.data?.post) onSaved(r.data.post);
  };

  const generate = async () => {
    setBusy("ai");
    const r = await generatePostAction(projectId, {
      platform: form.platform,
      pillar_id: form.pillar_id || null,
      funnel_stage: (form.funnel_stage || null) as FunnelStage | null,
      format: form.format || null,
      date: form.date || null,
      instruction: instruction || undefined,
      existing: post || form.caption ? { title: form.title || post?.title || "", caption: form.caption || null, hook: form.hook || null } : null,
    });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    const d = r.data!;
    setForm((f) => ({
      ...f,
      title: d.title, format: f.format || d.format, hook: d.hook, caption: d.caption, cta: d.cta,
      hashtags: d.hashtags.map((h) => `#${h}`).join(" "), creative_brief: d.creative_brief,
      pillar_id: f.pillar_id || d.pillar_id || "",
    }));
    setAiNotes({ rationale: d.rationale, assumptions: d.notes.assumptions, suggested: d.suggested_time });
    toast.success(t("editor.aiReady"));
  };

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const remove = async () => {
    if (!post) return;
    setBusy("delete");
    const r = await deletePostAction(projectId, post.id);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    onDeleted(post.id);
  };

  const duplicate = async () => {
    if (!post) return;
    setBusy("duplicate");
    const r = await duplicatePostAction(projectId, post.id);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.message);
    if (r.data?.post) onSaved(r.data.post);
  };

  const draftStatus: ContentStatus = post && DRAFT_STAGES.includes(post.status) ? post.status : "planned";

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && !isDrivePickerOpen() && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {post ? t("editor.titleEdit") : defaults.opportunity_id ? t("editor.titleAdd") : t("editor.titleNew")}
            {post ? <StatePill state={state} className="font-normal" /> : null}
          </DialogTitle>
          <DialogDescription>
            {!post && defaults.opportunity_id ? `${t("editor.prefilled")} ` : ""}
            {t("editor.timesIn", { tz })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[68vh] gap-5 overflow-y-auto px-0.5 pr-1">
          {post?.status === "published" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-3 text-[13px]">
              <CheckCircle2 className="size-4 text-success" /> {t("editor.published", { when: post.published_at ? utcToZoned(post.published_at, tz).date + " " + utcToZoned(post.published_at, tz).time : "" })}
              {post.published_url ? <a href={post.published_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{t("editor.openPost")} <ExternalLink className="size-3" /></a> : null}
            </div>
          ) : null}
          {post?.status === "failed" && post.publish_error ? (
            <Alert variant="destructive" title={t("editor.failed")}>{post.publish_error}</Alert>
          ) : null}

          <Field label={t("editor.title")} htmlFor="pe-title" error={errors.title}>
            <Input id="pe-title" value={form.title} onChange={(e) => set("title", e.target.value)} disabled={readOnly} placeholder={t("editor.titlePlaceholder")} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("editor.platform")} htmlFor="pe-platform" error={errors.platform}>
              <NativeSelect id="pe-platform" value={form.platform} onChange={(e) => set("platform", e.target.value as Platform)} disabled={readOnly || locked}>
                {CALENDAR_PLATFORMS.map((p) => <option key={p} value={p}>{domainLabel(td, "platform", p)}</option>)}
                <optgroup label={t("editor.otherPlatforms")}>
                  {PLATFORMS.filter((p) => !(CALENDAR_PLATFORMS as readonly string[]).includes(p)).map((p) => <option key={p} value={p}>{domainLabel(td, "platform", p)}</option>)}
                </optgroup>
              </NativeSelect>
            </Field>
            <Field label={t("editor.format")} htmlFor="pe-format">
              <Input id="pe-format" list="pe-formats" value={form.format} onChange={(e) => set("format", e.target.value)} disabled={readOnly} />
              <datalist id="pe-formats">{FORMATS.map((f) => <option key={f.value} value={f.value} label={t(`editorFormats.${f.key}`)} />)}</datalist>
            </Field>
            <Field label={t("editor.pillar")} htmlFor="pe-pillar">
              <NativeSelect id="pe-pillar" value={form.pillar_id} onChange={(e) => set("pillar_id", e.target.value)} disabled={readOnly}>
                <option value="">—</option>
                {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("editor.funnel")} htmlFor="pe-funnel">
              <NativeSelect id="pe-funnel" value={form.funnel_stage} onChange={(e) => set("funnel_stage", e.target.value)} disabled={readOnly}>
                <option value="">—</option>
                {FUNNEL_STAGES.map((f) => <option key={f} value={f}>{td(`funnel.${f}`)}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t("editor.campaign")} htmlFor="pe-campaign">
              <NativeSelect id="pe-campaign" value={form.campaign_id} onChange={(e) => set("campaign_id", e.target.value)} disabled={readOnly}>
                <option value="">—</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("editor.date")} htmlFor="pe-date" error={errors.date}>
                <Input id="pe-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} disabled={readOnly || locked} />
              </Field>
              <Field label={t("editor.time")} htmlFor="pe-time" error={errors.time}>
                <Input id="pe-time" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} disabled={readOnly || locked} />
              </Field>
            </div>
          </div>

          {!locked && suggestions.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{t("editor.bestTimes", { platform: domainLabel(td, "platform", form.platform) })}</span>
              {(sameDay.length ? sameDay : suggestions).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={readOnly}
                  onClick={() => set("time", `${String(s.window).padStart(2, "0")}:00`)}
                  className="rounded-md border px-1.5 py-0.5 hover:bg-accent"
                  title={t("editor.bestTimeHint", { lift: s.lift, count: s.n })}
                >
                  {t("insights.slot", { day: weekdayLabel(fmt, s.weekday), window: windowLabel(s.window) })} <span className="text-muted-foreground">×{s.lift != null ? fmt.number(s.lift) : s.lift}</span>
                </button>
              ))}
            </div>
          ) : null}

          {!readOnly ? (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={post || form.caption ? t("editor.rewritePlaceholder") : t("editor.topicPlaceholder")}
                  disabled={busy === "ai"}
                />
                <Button type="button" variant="outline" onClick={generate} disabled={!aiEnabled || busy !== null} title={!aiEnabled ? t("editor.noAi") : undefined} className="shrink-0">
                  {busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles className="text-primary" />}
                  {busy === "ai" ? t("editor.writing") : post || form.caption ? t("editor.regenerate") : t("editor.generate")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("editor.aiHint")}</p>
              {aiNotes ? (
                <div className="space-y-1 text-xs">
                  <p><span className="font-medium">{t("editor.why")}</span> {aiNotes.rationale}</p>
                  {aiNotes.suggested && !locked ? (
                    <p>
                      {t("editor.suggestedTime")} <button type="button" className="text-primary hover:underline" onClick={() => set("time", aiNotes.suggested!)}>{aiNotes.suggested}</button>
                    </p>
                  ) : null}
                  {aiNotes.assumptions.length ? <p className="text-warning">{t("editor.toComplete", { list: aiNotes.assumptions.join(" · ") })}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <Field label={t("editor.hook")} htmlFor="pe-hook"><Input id="pe-hook" value={form.hook} onChange={(e) => set("hook", e.target.value)} disabled={readOnly} /></Field>
          <Field label={t("editor.caption")} htmlFor="pe-caption" hint={limit ? tc("units.characters", { count: form.caption.length, max: limit }) : undefined} error={limit && form.caption.length > limit ? t("editor.tooLong") : errors.caption}>
            <Textarea id="pe-caption" rows={6} value={form.caption} onChange={(e) => set("caption", e.target.value)} disabled={readOnly} dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("editor.cta")} htmlFor="pe-cta"><Input id="pe-cta" value={form.cta} onChange={(e) => set("cta", e.target.value)} disabled={readOnly} /></Field>
            <Field label={t("editor.hashtags")} htmlFor="pe-tags" hint={t("editor.hashtagsHint")}><Input id="pe-tags" value={form.hashtags} onChange={(e) => set("hashtags", e.target.value)} disabled={readOnly} /></Field>
          </div>
          <Field label={t("editor.brief")} htmlFor="pe-brief"><Textarea id="pe-brief" rows={3} value={form.creative_brief} onChange={(e) => set("creative_brief", e.target.value)} disabled={readOnly} dir="auto" /></Field>
          <Field label={t("editor.media")} htmlFor="pe-media" error={errors.media_url} hint={t("editor.mediaHint")}>
            <div className="flex gap-3">
              <Input id="pe-media" value={form.media_url} onChange={(e) => set("media_url", e.target.value)} disabled={readOnly} placeholder="https://…" />
              {/^https:\/\//i.test(form.media_url) ? (
                // eslint-disable-next-line @next/next/no-img-element -- external user-provided preview
                <img src={form.media_url} alt="" className="size-9 shrink-0 rounded object-cover" />
              ) : null}
            </div>
          </Field>

          {!readOnly && !locked ? (
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t("editor.scheduleNote")}
            </p>
          ) : null}
        </div>

        {/* outside the scrolling body so the warning is always visible next to the buttons */}
        {conflicts ? (
          <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-[13px]">
            <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 text-warning" /> {t("editor.conflict", { platform: domainLabel(td, "platform", form.platform) })}</p>
            <ul className="mt-1 list-disc pl-5 text-xs">{conflicts.list.map((c) => <li key={c.id}>{c.time} · {c.title}</li>)}</ul>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setConflicts(null)}>{t("editor.changeTime")}</Button>
              <Button size="sm" onClick={() => save(conflicts.status, true)} disabled={busy !== null}>{t("editor.keepBoth")}</Button>
            </div>
          </div>
        ) : null}

        {!readOnly ? (
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-1">
              {post && confirmDelete ? (
                <span role="alert" className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 text-[13px]">
                  {t("editor.deleteConfirm")}
                  <Button variant="destructive" size="sm" onClick={remove} disabled={busy !== null}>{busy === "delete" ? <Loader2 className="animate-spin" /> : null} {tc("actions.delete")}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>{tc("actions.cancel")}</Button>
                </span>
              ) : post ? (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy !== null}><Trash2 /> {tc("actions.delete")}</Button>
              ) : null}
              {post ? <Button variant="ghost" size="sm" onClick={duplicate} disabled={busy !== null}><Copy /> {tc("actions.duplicate")}</Button> : null}
              {post && !locked && ["instagram", "facebook", "youtube", "linkedin", "tiktok"].includes(post.platform ?? "") ? <Button variant="ghost" size="sm" onClick={() => setPublishOpen(true)} disabled={busy !== null}><CheckCircle2 /> {t("editor.verify")}</Button> : null}
              {post && !locked && (post.status === "approved" || post.status === "scheduled") && ["instagram", "facebook"].includes(post.platform ?? "") ? <Button variant="outline" size="sm" onClick={() => setSendOpen(true)} disabled={busy !== null}><Send /> {t("editor.publish")}</Button> : null}
              {post ? <Button asChild variant="outline" size="sm"><Link href={`/p/${projectId}/production?item=${post.id}`}>{t("editor.openProduction")}</Link></Button> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {locked ? (
                // the server keeps a published/failed post's status and slot; only text fields change
                <span className="text-xs text-muted-foreground">{t("editor.locked")}</span>
              ) : (
                <>
                  <Button variant="outline" onClick={() => save(draftStatus)} disabled={busy !== null}>{busy === draftStatus ? <Loader2 className="animate-spin" /> : null} {t("editor.saveDraft")}</Button>
                  {post?.status === "in_review" ? (
                    <Button asChild variant="outline"><Link href={`/p/${projectId}/production?view=review&item=${post.id}`}>{t("editor.reviewInProduction")}</Link></Button>
                  ) : post?.status !== "approved" && post?.status !== "scheduled" ? (
                    <Button variant="outline" onClick={() => save("in_review")} disabled={busy !== null}>{busy === "in_review" ? <Loader2 className="animate-spin" /> : <Send />} {t("editor.submit")}</Button>
                  ) : null}
                  <Button onClick={() => save("scheduled")} disabled={busy !== null || !form.date || !form.time || (post?.status !== "approved" && post?.status !== "scheduled")} title={t("editor.scheduleRequirement")}>
                    {busy === "scheduled" ? <Loader2 className="animate-spin" /> : null} {post?.status === "scheduled" ? t("editor.updateSchedule") : t("editor.schedule")}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        ) : null}

        {sendOpen && post ? <PublishDialog projectId={projectId} post={post} tz={tz} onClose={() => setSendOpen(false)} onPublished={() => undefined} /> : null}
        {publishOpen && post ? (
          <ConfirmPublished projectId={projectId} post={post} tz={tz} onClose={() => setPublishOpen(false)} onDone={(p) => { setPublishOpen(false); onSaved(p); }} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmPublished({ projectId, post, tz, onClose, onDone }: { projectId: string; post: ContentItem; tz: string; onClose: () => void; onDone: (p: ContentItem) => void }) {
  // Defaults: the planned slot if it has passed, otherwise now (computed once, in the state initialisers).
  const [initial] = React.useState(() => {
    const nowIso = new Date().toISOString();
    const planned = post.scheduled_at && post.scheduled_at <= nowIso ? utcToZoned(post.scheduled_at, tz) : null;
    return planned ?? { date: todayInZone(tz), time: utcToZoned(nowIso, tz).time };
  });
  const [date, setDate] = React.useState(initial.date);
  const [time, setTime] = React.useState(initial.time);
  const t = useT("calendar");
  const tc = useT("common");
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("confirmPublished.title")}</DialogTitle>
          <DialogDescription>
            {t("confirmPublished.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("confirmPublished.publishedOn")} htmlFor="cp-date"><Input id="cp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t("confirmPublished.at")} htmlFor="cp-time"><Input id="cp-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label={t("confirmPublished.link")} htmlFor="cp-url" className="sm:col-span-2"><Input id="cp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/p/…" /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tc("actions.cancel")}</Button>
          <Button
            disabled={busy || !url.trim()}
            onClick={async () => {
              setBusy(true);
              const r = await confirmPublishedAction(projectId, post.id, { date, time, url: url.trim() || null });
              setBusy(false);
              if (!r.ok) return toast.error(r.error);
              toast.success(r.message);
              if (r.data?.post) onDone(r.data.post);
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t("confirmPublished.verify")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowLegend() {
  const t = useT("calendar");
  const td = useT("domain");
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {(["draft", "pending", "approved", "scheduled", "published", "failed"] as const).map((s) => <StatePill key={s} state={s} />)}
      <Badge variant="outline" className="font-normal">{t("editor.legendBooked", { label: td("workflow.scheduled") })}</Badge>
    </div>
  );
}
