"use client";
import { AUDIENCES, isAudience, type Audience } from "@/lib/backlog/audience";
import { setAudienceTagAction } from "@/server/actions/backlog";
import * as React from "react";
import Link from "next/link";
import { CalendarDays, Check, CheckCircle2, FileText, HardDrive, Laptop, History, Loader2, MessageSquare, Paperclip, Save, Sparkles, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { MediaLightbox, MediaPreview, TileButton, Trash2, type TileAsset } from "@/components/calendar/media-tile";
import { DrivePicker, isDrivePickerOpen } from "@/components/calendar/drive-picker";
import { useMediaUpload } from "@/components/media/use-media-upload";
import { needsCompression } from "@/lib/media/compress-video";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { canAdmin, canEdit, FUNNEL_STAGES, LANGUAGES, PLATFORMS, type Language, type Platform, type WorkspaceRole } from "@/lib/domain/constants";
import { BOARD, canWriteItem, changedFields, columnOf, FORMATS, isRTL, writingOf, type ContentTemplate, type ProductionItem, type ProductionStage, type WorkflowSettings } from "@/lib/production/model";
import { AI_OPERATIONS, CAPTION_OPERATIONS, type CaptionOperation, type ProductionInput } from "@/lib/validation/production";
import { applyGenerated, AUTO_SETTINGS, COPY_PLATFORM_LABELS, COPY_PLATFORMS, effectiveSettings, readCaptions, type CopyPlatform, type CopySettings } from "@/lib/production/platform-copy";
import { CaptionDraftDialog, draftFrom, PlatformCaptionsSection, visiblePlatforms, type CaptionDraftState } from "@/components/production/platform-captions";
import { addMediaLinkAction, commentProductionAction, generateCaptionsAction, generateProductionAction, planProductionSlotAction, productionDetailsAction, removeMediaAction, restoreProductionAction, saveProductionAction, saveTemplateAction, scheduleProductionAction, transitionProductionAction } from "@/server/actions/production";
import type { ProductionDetails } from "@/server/services/production";
import type { ProductionDraft } from "@/server/ai/production";
import type { WorkspaceMember } from "@/server/services/workspaces";
import { TaskPanel, type Assignable } from "@/components/team/task-panel";
import { PRIORITIES, type Priority } from "@/lib/permissions";
import { setContentPriorityAction } from "@/server/actions/team";
import { useFormatter, useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";

type Props = { projectId: string; item: ProductionItem | null; template?: ContentTemplate; language: Language; tz: string; userId: string; role: WorkspaceRole; members: WorkspaceMember[]; pillars: { id: string; name: string }[]; workflow: WorkflowSettings; aiEnabled: boolean; onClose: () => void; onSaved: (item: ProductionItem) => void; perms: string[]; people: Assignable[]; today: string };
function formOf(item: Partial<ProductionItem> | null, language: Language, userId: string): ProductionInput {
  return { ...writingOf({ title: item?.title ?? "", hook: item?.hook ?? "", caption: item?.caption ?? "", main_content: item?.main_content ?? "", cta: item?.cta ?? "", hashtags: item?.hashtags ?? [], creative_brief: item?.creative_brief ?? "", visual_direction: item?.visual_direction ?? "" }),
    platform: item?.platform || "instagram", format: item?.format || "Social caption", language: item?.language || language,
    pillar_id: item?.pillar_id || null, funnel_stage: item?.funnel_stage || null, target_audience: item?.target_audience || null,
    assignee_id: item ? item.assignee_id ?? null : userId, due_date: item?.due_date || null, language_variants: item?.language_variants || {}, platform_captions: readCaptions(item?.platform_captions) };
}
/** The caption tab opened first: the item's own platform when it has one. */
function tabOf(platform: Platform | null | undefined, format: string | null | undefined): CopyPlatform {
  if (platform === "youtube") return /reel|short|story/i.test(format ?? "") ? "youtube_shorts" : "youtube";
  return platform && (COPY_PLATFORMS as readonly string[]).includes(platform) ? platform as CopyPlatform : "tiktok";
}
export function ProductionEditor(props: Props) {
  const { projectId, role, userId, members, tz, workflow } = props;
  const { upload: uploadMedia } = useMediaUpload(projectId);
  const t = useT("production"); const td = useT("domain");
  // domain.platform has an "other" key, which the key type reads as a plural leaf: look platform names up by string
  const platformName = (p: string) => (td as (key: string) => string)(`platform.${p}`); const tc = useT("common"); const fmt = useFormatter();
  const [item, setItem] = React.useState(props.item);
  const [form, setForm] = React.useState<ProductionInput>(() => formOf((props.item || props.template?.body || null) as Partial<ProductionItem> | null, props.language, userId));
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== baseline;
  const [tab, setTab] = React.useState("write");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [mediaTab, setMediaTab] = React.useState<"post" | "computer" | "drive">("post"); const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [details, setDetails] = React.useState<ProductionDetails | null>(null);
  const [detailsError, setDetailsError] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [mentions, setMentions] = React.useState<string[]>([]);
  const [reviewNote, setReviewNote] = React.useState("");
  const [versionId, setVersionId] = React.useState("");
  const [confirm, setConfirm] = React.useState<"close" | "restore" | null>(null);
  const [assetToRemove, setAssetToRemove] = React.useState<string | null>(null);
  const [zoomAt, setZoomAt] = React.useState<number | null>(null);
  const tiles: TileAsset[] = (details?.assets ?? []).map((a) => ({ id: a.id, name: a.body.name, mime: a.body.mime ?? (a.body.url ? "image/jpeg" : null), source: a.body.path ? "stored" : a.body.source_type === "google_drive" ? "google_drive" : "link", previewUrl: `/api/media/${a.id}?project=${projectId}&size=thumb`, fullUrl: `/api/media/${a.id}?project=${projectId}` }));
  const [mediaName, setMediaName] = React.useState(""); const [mediaUrl, setMediaUrl] = React.useState("");
  const [operation, setOperation] = React.useState<typeof AI_OPERATIONS[number] | `cap:${CaptionOperation}`>("generate");
  const [captionTab, setCaptionTab] = React.useState<CopyPlatform>(() => tabOf(form.platform, form.format));
  const [copySettings, setCopySettings] = React.useState<CopySettings>(AUTO_SETTINGS);
  const [captionDraft, setCaptionDraft] = React.useState<CaptionDraftState | null>(null);
  const [instruction, setInstruction] = React.useState("");
  const [targetLanguage, setTargetLanguage] = React.useState<Language>(form.language);
  const [targetPlatform, setTargetPlatform] = React.useState<Platform>(form.platform);
  const [draft, setDraft] = React.useState<{ result: ProductionDraft; operation: typeof AI_OPERATIONS[number]; language: Language; platform: Platform } | null>(null);
  const [date, setDate] = React.useState(item?.scheduled_date || ""); const [time, setTime] = React.useState(item?.scheduled_time?.slice(0, 5) || "");
  const [templateOpen, setTemplateOpen] = React.useState(false); const [templateName, setTemplateName] = React.useState("");
  const perms = React.useMemo(() => new Set(props.perms), [props.perms]);
  const collaborator = Boolean(details?.tasks.some((t) => t.user_id === userId && t.status !== "approved" && t.status !== "completed"));
  const readOnly = !canEdit(role) || (item ? !canWriteItem(role, userId, item, { editAny: perms.has("content.edit_any"), collaborator }) || item.status === "published" : !perms.has("content.create"));
  const [audience, setAudience] = React.useState<Audience | null>(props.item?.audience ?? null);
  const canAssign = perms.has("content.assign");
  const [priority, setPriority] = React.useState<Priority>(props.item?.priority ?? "medium");
  const rtl = isRTL(form.language);
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.full_name || (id ? t("people.teamMember") : t("people.system"));
  const stamp = (value: string) => fmt.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const set = <K extends keyof ProductionInput>(key: K, value: ProductionInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const accept = (next: ProductionItem) => { setItem(next); const f = formOf(next, props.language, userId); setForm(f); setBaseline(JSON.stringify(f)); props.onSaved(next); };
  const loadDetails = React.useCallback(async (id: string, refreshItem = false) => {
    const r = await productionDetailsAction(projectId, id);
    if (!r.ok || !r.data) { setDetailsError(r.ok ? t("editor.errors.loadDetails") : r.error); return; }
    setDetails(r.data); setDetailsError("");
    if (refreshItem) setItem(r.data.item);
  }, [projectId, t]);
  React.useEffect(() => {
    if (!item?.id) return;
    let active = true;
    productionDetailsAction(projectId, item.id).then((r) => {
      if (!active) return;
      if (r.ok && r.data) { setDetails(r.data); setDetailsError(""); }
      else setDetailsError(r.ok ? t("editor.errors.loadDetails") : r.error);
    }).catch(() => { if (active) setDetailsError(t("editor.errors.loadHistory")); });
    return () => { active = false; };
  }, [projectId, item?.id, item?.revision, t]);
  React.useEffect(() => { if (!dirty) return; const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  const run = async (kind: string, action: () => Promise<void>) => {
    setBusy(kind); setError(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : t("editor.errors.requestFailed")); } finally { setBusy(null); }
  };
  // the publication slot is saved with the content (it used to save only when scheduling approved content)
  const slotDirty = Boolean(item) && (date !== (item?.scheduled_date || "") || time !== (item?.scheduled_time?.slice(0, 5) || ""));
  const save = async () => {
    let current = item;
    if (dirty || !item) {
      const values = { ...form, language_variants: { ...form.language_variants, [form.language]: writingOf(form) } };
      const r = await saveProductionAction(projectId, item?.id ?? null, item?.revision ?? null, values);
      if (!r.ok) { setFieldErrors(r.fieldErrors || {}); throw new Error(r.error); }
      setFieldErrors({}); if (r.data) { accept(r.data); current = r.data; } toast.success(r.message);
    }
    if (current && slotDirty) {
      if (current.status === "scheduled") throw new Error(t("editor.errors.scheduledUseSlot"));
      const s = await planProductionSlotAction(projectId, current.id, current.revision, date || null, time || null);
      if (!s.ok) throw new Error(s.error);
      if (s.data) accept(s.data);
      toast.success(s.message);
    }
  };
  const switchLanguage = (language: Language) => {
    const variants = { ...form.language_variants, [form.language]: writingOf(form) };
    setForm({ ...form, ...writingOf(variants[language] || { title: form.title }), language, language_variants: variants });
  };
  const transition = (stage: ProductionStage, decision?: "approve" | "reject" | "changes") => run("workflow", async () => {
    if (!item) return; if (dirty) throw new Error(t("editor.errors.saveBeforeWorkflow"));
    const r = await transitionProductionAction(projectId, item.id, item.revision, stage, decision, reviewNote);
    if (!r.ok) throw new Error(r.error); if (r.data) accept(r.data); setReviewNote(""); toast.success(r.message);
  });
  const upload = (file: File) => {
    // videos over 50 MB are compressed in the browser first; that runs in the background (progress window) so the
    // editor stays usable and can even be closed meanwhile
    if (item && !dirty && needsCompression(file)) {
      const id = item.id;
      uploadMedia(id, file).then(() => loadDetails(id, true)).then(() => toast.success(t("actions.fileAttached")), (e) => toast.error(e instanceof Error ? e.message : t("editor.errors.requestFailed")));
      return;
    }
    return run("upload", async () => {
      if (!item || dirty) throw new Error(t("editor.errors.saveBeforeMedia"));
      await uploadMedia(item.id, file);
      await loadDetails(item.id, true); toast.success(t("actions.fileAttached"));
    });
  };
  const applyDraft = () => {
    if (!draft) return;
    const variants = { ...form.language_variants, [form.language]: writingOf(form) };
    const language = draft.operation === "translate" ? draft.language : form.language;
    setForm({ ...form, ...draft.result.content, language, platform: draft.operation === "adapt_platform" ? draft.platform : form.platform,
      format: draft.result.format || form.format, language_variants: { ...variants, [language]: draft.result.content } });
    setDraft(null); toast.success(t("editor.draftApplied"));
  };
  /** Asks the AI for platform copy; the result opens in a preview and is applied only on Apply (then saved with Save content). */
  const generateCaptions = (op: CaptionOperation) => run("captions", async () => {
    const captions = form.platform_captions;
    let current = captionTab;
    if (op === "youtube_title" && current !== "youtube" && current !== "youtube_shorts") { current = "youtube"; setCaptionTab(current); }
    const all = visiblePlatforms(captions, [current]);
    const kept = op === "generate_all" ? all.filter((p) => captions[p]?.status === "approved") : [];
    const platforms = op === "generate_all" ? all.filter((p) => !kept.includes(p)) : [current];
    if (!platforms.length) throw new Error(t("editor.errors.allFinal"));
    const settings = { default: copySettings, ...Object.fromEntries(platforms.map((p) => [p, effectiveSettings(copySettings, captions[p])])) };
    const r = await generateCaptionsAction(projectId, { operation: op, platforms, content: { ...form, title: form.title || "Untitled idea" }, instruction, settings });
    if (!r.ok || !r.data) { setFieldErrors(r.ok ? {} : r.fieldErrors || {}); throw new Error(r.ok ? t("editor.errors.aiEmpty") : r.error); }
    setCaptionDraft(draftFrom(r.data, op, platforms, kept, captions));
  });
  const applyCaptions = () => {
    if (!captionDraft) return;
    const d = captionDraft; const alt = d.operation === "alternatives";
    const platforms = alt ? d.platforms.slice(0, 1) : d.apply;
    const generated = alt ? { [platforms[0]]: d.alternatives[d.choice] } : d.edits;
    // only the chosen platforms change; every other platform's copy stays exactly as it is
    set("platform_captions", applyGenerated(form.platform_captions, generated, platforms, new Date().toISOString(), platforms));
    setCaptionDraft(null); toast.success(t("editor.captionsUpdated", { platforms: platforms.map((p) => COPY_PLATFORM_LABELS[p]).join(", ") }));
  };
  const selectedVersion = details?.versions.find((v) => v.id === versionId);
  const approver = canAdmin(role) || perms.has("content.approve");
  const reviewAllowed = item && canEdit(role) && ((item.production_stage === "internal_review" && (approver || perms.has("content.review"))) || (item.production_stage === "approval" && approver));
  return <Dialog open modal={!picking} onOpenChange={(open) => { if (!open && !busy && !picking && !isDrivePickerOpen()) { if (dirty) setConfirm("close"); else props.onClose(); } }}><DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl" onInteractOutside={(e) => e.preventDefault()}>
    <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12"><div className="flex flex-wrap items-center gap-3"><DialogTitle>{item ? t("editor.titleExisting") : t("editor.titleNew")}</DialogTitle>{item && <span className="rounded-md bg-muted px-2 py-1 text-xs">{workflow.labels[item.production_stage] || t(`stage.${item.production_stage}`)}</span>}{dirty && <span className="text-xs text-muted-foreground">{t("editor.unsaved")}</span>}</div><DialogDescription>{item ? t("editor.revisionOwner", { revision: item.revision, name: name(item.created_by) }) : t("editor.newDescription")}</DialogDescription></DialogHeader>
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
      <main className="min-w-0 flex-1 space-y-5 p-5">
        {error && <Alert variant="destructive">{error}</Alert>}
        <Field label={t("editor.fields.title")} htmlFor="production-title" error={fieldErrors.title}><Input id="production-title" dir="auto" value={form.title} disabled={readOnly || !!busy} onChange={(e) => set("title", e.target.value)} placeholder={t("editor.fields.titlePlaceholder")} className="h-11 text-base font-medium" /></Field>
        <div className="flex flex-wrap gap-1 border-b pb-2" role="tablist" aria-label={t("editor.sectionsLabel")}>{([{ id: "write", icon: FileText }, { id: "brief", icon: FileText }, { id: "media", icon: Paperclip }, { id: "team", icon: Users }, { id: "review", icon: MessageSquare }, { id: "history", icon: History }] as const).map(({ id, icon: Icon }) => <Button key={id} variant={tab === id ? "secondary" : "ghost"} size="sm" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon />{t(`editor.tabs.${id}`)}</Button>)}</div>
        <section role="tabpanel" aria-label={t(`editor.tabs.${tab as "write"}`)} className="space-y-4">
        {tab === "write" && <>
          <div className="grid gap-3 sm:grid-cols-3"><Field label={t("editor.fields.platform")} htmlFor="production-platform"><NativeSelect id="production-platform" value={form.platform} disabled={readOnly || !!busy} onChange={(e) => set("platform", e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p} value={p}>{platformName(p)}</option>)}</NativeSelect></Field><Field label={t("editor.fields.format")} htmlFor="production-format"><Input id="production-format" list="production-formats" value={form.format} disabled={readOnly || !!busy} onChange={(e) => set("format", e.target.value)} /><datalist id="production-formats">{FORMATS.map((f) => <option key={f}>{f}</option>)}</datalist></Field><Field label={t("editor.fields.languageVariant")} htmlFor="production-language"><NativeSelect id="production-language" value={form.language} disabled={readOnly || !!busy} onChange={(e) => switchLanguage(e.target.value as Language)}>{LANGUAGES.map((l) => <option key={l} value={l}>{td(`language.${l}`)}{form.language_variants[l] ? t("editor.fields.savedSuffix") : ""}</option>)}</NativeSelect></Field></div>
          <p className="text-xs text-muted-foreground">{t("editor.fields.variantsNote")}</p>
          <div dir={rtl ? "rtl" : "ltr"} lang={form.language === "ar_tn" ? "ar-TN" : form.language} className="space-y-4 rounded-xl border bg-card p-4">
            <WritingField label={t("editor.fields.hook")} value={form.hook} onChange={(v) => set("hook", v)} disabled={readOnly || !!busy} rows={2} hint={t("editor.fields.hookHint")} error={fieldErrors.hook} />
            <WritingField label={t("editor.fields.mainContent")} value={form.main_content} onChange={(v) => set("main_content", v)} disabled={readOnly || !!busy} rows={9} hint={t("editor.fields.mainContentHint")} error={fieldErrors.main_content} />
            <WritingField label={t("editor.fields.cta")} value={form.cta} onChange={(v) => set("cta", v)} disabled={readOnly || !!busy} rows={2} error={fieldErrors.cta} />
            <Field label={t("editor.fields.hashtags")} htmlFor="production-hashtags" error={fieldErrors.hashtags}><Input id="production-hashtags" value={form.hashtags.join(" ")} disabled={readOnly || !!busy} onChange={(e) => set("hashtags", e.target.value.split(/\s+/).filter(Boolean))} placeholder={t("editor.fields.hashtagsPlaceholder")} /></Field>
          </div>
          <PlatformCaptionsSection captions={form.platform_captions} onChange={(next) => set("platform_captions", next)} active={captionTab} onActive={setCaptionTab}
            legacy={form.caption} onLegacy={(v) => set("caption", v)} legacyError={fieldErrors.caption} settings={copySettings} onSettings={setCopySettings}
            disabled={readOnly} aiEnabled={props.aiEnabled} busy={busy} onGenerate={generateCaptions} />
        </>}
        {tab === "brief" && <><div className="grid gap-3 sm:grid-cols-2"><Field label={t("editor.fields.pillar")} htmlFor="production-pillar"><NativeSelect id="production-pillar" value={form.pillar_id || ""} disabled={readOnly || !!busy} onChange={(e) => set("pillar_id", e.target.value || null)}><option value="">{t("editor.fields.noPillar")}</option>{props.pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field><Field label={t("editor.fields.funnel")} htmlFor="production-funnel"><NativeSelect id="production-funnel" value={form.funnel_stage || ""} disabled={readOnly || !!busy} onChange={(e) => set("funnel_stage", (e.target.value || null) as ProductionInput["funnel_stage"])}><option value="">{t("editor.fields.notSpecified")}</option>{FUNNEL_STAGES.map((s) => <option key={s} value={s}>{td(`funnel.${s}`)}</option>)}</NativeSelect></Field></div><WritingField label={t("editor.fields.targetAudience")} value={form.target_audience || ""} onChange={(v) => set("target_audience", v)} disabled={readOnly || !!busy} rows={3} /><WritingField label={t("editor.fields.creativeBrief")} value={form.creative_brief} onChange={(v) => set("creative_brief", v)} disabled={readOnly || !!busy} rows={8} hint={t("editor.fields.creativeBriefHint")} /><WritingField label={t("editor.fields.visualDirection")} value={form.visual_direction} onChange={(v) => set("visual_direction", v)} disabled={readOnly || !!busy} rows={6} hint={t("editor.fields.visualDirectionHint")} />{item?.opportunity_id && <Button asChild variant="link"><Link href={`/p/${projectId}/opportunities`}>{t("editor.fields.sourceOpportunities")}</Link></Button>}</>}
        {tab === "media" && <><p className="text-sm text-muted-foreground">{t("editor.media.intro")}</p>{!item ? <p className="rounded-lg border p-4 text-sm">{t("editor.media.saveFirst")}</p> : <>{!readOnly && <div role="tablist" aria-label={t("editor.media.sourcesLabel")} className="inline-flex gap-0.5 rounded-md bg-secondary p-0.5">{([["post", t("editor.media.tabPost"), CheckCircle2], ["computer", t("editor.media.tabComputer"), Laptop], ["drive", t("editor.media.tabDrive"), HardDrive]] as const).map(([k, label, Icon]) => <button key={k} role="tab" type="button" aria-selected={mediaTab === k} onClick={() => setMediaTab(k)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium", mediaTab === k ? "bg-card shadow-xs" : "text-muted-foreground")}><Icon className="size-3.5" /> {label}</button>)}</div>}{(readOnly || mediaTab === "post") && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{tiles.map((a, i) => <div key={a.id} className="relative h-36 overflow-hidden rounded-lg border bg-muted"><button type="button" className="absolute inset-0" onClick={() => setZoomAt(i)} aria-label={t("editor.media.viewLarger", { name: a.name })}><MediaPreview asset={a} className="size-full" /></button>{!readOnly && <div className="absolute right-1 top-1 z-10"><TileButton label={t("editor.media.delete", { name: a.name })} danger onClick={() => setAssetToRemove(a.id)}><Trash2 className="size-3.5" /></TileButton></div>}<a href={a.fullUrl ?? undefined} target="_blank" rel="noreferrer" className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-2 py-0.5 text-[11px] hover:underline">{a.name}</a></div>)}</div>{details && !details.assets.length && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("editor.media.empty")}</p>}</>}{!readOnly && mediaTab === "computer" && <div className="space-y-4 rounded-xl border p-4"><label className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Upload className="size-4" />{t("editor.media.upload")}<input type="file" className="block max-w-full text-xs" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,application/pdf" disabled={!!busy || dirty} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} /></label><p className="text-xs text-muted-foreground">{t("editor.media.limits")}</p><p className="text-xs font-medium text-muted-foreground">{t("editor.media.orLink")}</p><div className="grid gap-2 sm:grid-cols-2"><Input aria-label={t("editor.media.nameLabel")} placeholder={t("editor.media.namePlaceholder")} value={mediaName} onChange={(e) => setMediaName(e.target.value)} /><Input aria-label={t("editor.media.urlLabel")} placeholder="https://…" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} /></div><Button variant="outline" disabled={!!busy || dirty || !mediaName || !mediaUrl} onClick={() => run("media", async () => { const r = await addMediaLinkAction(projectId, item.id, mediaName, mediaUrl); if (!r.ok) throw new Error(r.error); setMediaName(""); setMediaUrl(""); await loadDetails(item.id, true); })}><Paperclip /> {t("editor.media.attachLink")}</Button>{dirty && <p className="text-xs text-muted-foreground">{t("editor.media.saveBeforeFiles")}</p>}</div>}{!readOnly && mediaTab === "drive" && <div className="rounded-xl border p-4 text-sm"><DrivePicker back="production" projectId={projectId} itemId={item.id} onPicking={setPicking} onAttached={async () => { await loadDetails(item.id, true); setMediaTab("post"); }} /></div>}</>}</>}
        {tab === "team" && (!item ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("editor.team.saveFirst")}</p> : <TaskPanel projectId={projectId} itemId={item.id} tasks={details?.tasks ?? []} people={props.people} perms={props.perms} userId={userId} today={props.today} onChange={() => loadDetails(item.id)} />)}
        {tab === "review" && <>{!item ? <p>{t("editor.review.saveFirst")}</p> : <>
          {item.approved_at && <div className="rounded-lg border bg-muted/30 p-3 text-sm"><Check className="mr-2 inline size-4" />{t("editor.review.approvedBy", { name: name(item.approved_by), date: stamp(item.approved_at) })}</div>}
          {reviewAllowed && <div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">{item.production_stage === "internal_review" ? t("editor.review.internal") : t("editor.review.manager")}</h3><Textarea aria-label={t("editor.review.feedbackLabel")} placeholder={t("editor.review.feedbackPlaceholder")} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /><div className="flex flex-wrap gap-2"><Button disabled={!!busy || dirty} onClick={() => transition(item.production_stage, "approve")}><Check />{approver ? t("editor.review.approve") : t("editor.review.pass")}</Button><Button variant="outline" disabled={!!busy || dirty || !reviewNote.trim()} onClick={() => transition(item.production_stage, "changes")}>{t("editor.review.requestChanges")}</Button><Button variant="ghost" disabled={!!busy || dirty || !reviewNote.trim()} onClick={() => transition(item.production_stage, "reject")}>{t("editor.review.reject")}</Button></div></div>}
          {canEdit(role) && <div className="space-y-3"><Textarea aria-label={t("editor.review.commentLabel")} placeholder={t("editor.review.commentPlaceholder")} value={comment} onChange={(e) => setComment(e.target.value)} /><NativeSelect aria-label={t("editor.review.mentionLabel")} value="" onChange={(e) => { const id = e.target.value; if (id && !mentions.includes(id)) { setMentions([...mentions, id]); setComment((v) => `${v}${v ? " " : ""}@${name(id)} `); } }}><option value="">{t("editor.review.mentionOption")}</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{name(m.user_id)}</option>)}</NativeSelect>{mentions.length > 0 && <div className="flex flex-wrap gap-1">{mentions.map((id) => <Button key={id} size="sm" variant="secondary" onClick={() => setMentions(mentions.filter((m) => m !== id))}>@{name(id)} ×</Button>)}</div>}<Button disabled={!!busy || !comment.trim()} onClick={() => run("comment", async () => { const r = await commentProductionAction(projectId, item.id, comment, mentions); if (!r.ok) throw new Error(r.error); setComment(""); setMentions([]); toast.success(t("editor.review.commentAdded")); await loadDetails(item.id); })}><MessageSquare /> {t("editor.review.addComment")}</Button></div>}
          <EventList events={details?.events.filter((e) => !["edited", "created", "stage", "assigned", "attachment"].includes(e.kind)) || []} name={name} stamp={stamp} t={t} />
        </>}</>}
        {tab === "history" && <>{!item ? <p>{t("editor.history.saveFirst")}</p> : <><h3 className="text-sm font-semibold">{t("editor.history.compareTitle")}</h3><NativeSelect aria-label={t("editor.history.compareLabel")} value={versionId} onChange={(e) => setVersionId(e.target.value)}><option value="">{t("editor.history.choose")}</option>{details?.versions.map((v) => <option key={v.id} value={v.id}>{t("editor.history.option", { revision: v.revision, name: name(v.actor_id), date: stamp(v.created_at) })}</option>)}</NativeSelect>{selectedVersion && <><div className="space-y-3">{changedFields(selectedVersion.snapshot, item).map((key) => <div key={key} className="rounded-lg border p-3"><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide">{fieldName(t, key)}</h4><div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-1 text-xs text-muted-foreground">{t("editor.history.revision", { revision: selectedVersion.revision })}</p><p dir="auto" className="whitespace-pre-wrap break-words text-sm">{display(selectedVersion.snapshot[key as keyof ProductionItem])}</p></div><div><p className="mb-1 text-xs text-muted-foreground">{t("editor.history.current")}</p><p dir="auto" className="whitespace-pre-wrap break-words text-sm">{display(item[key as keyof ProductionItem])}</p></div></div></div>)}{!changedFields(selectedVersion.snapshot, item).length && <p className="text-sm text-muted-foreground">{t("editor.history.noDifferences")}</p>}</div>{!readOnly && <Button variant="outline" disabled={!!busy || dirty || selectedVersion.revision === item.revision} onClick={() => setConfirm("restore")}><History /> {t("editor.history.restore")}</Button>}</>}<h3 className="pt-4 text-sm font-semibold">{t("editor.history.timeline")}</h3><EventList events={details?.events || []} name={name} stamp={stamp} t={t} /></>}</>}
        {detailsError && item && <div role="alert" className="text-sm text-destructive">{detailsError}<Button variant="link" onClick={() => loadDetails(item.id)}>{t("editor.retry")}</Button></div>}
        </section>
      </main>
      <aside className="w-full shrink-0 space-y-5 border-t bg-muted/15 p-5 lg:w-80 lg:border-l lg:border-t-0">
        <section className="space-y-3"><h3 className="text-sm font-semibold">{t("editor.details.title")}</h3><Field label={t("editor.details.assignee")} htmlFor="production-assignee"><NativeSelect id="production-assignee" value={form.assignee_id || ""} disabled={readOnly || !!busy || !canAssign} onChange={(e) => set("assignee_id", e.target.value || null)}><option value="">{t("people.unassigned")}</option>{members.filter((m) => canEdit(m.role)).map((m) => { const p = props.people.find((x) => x.user_id === m.user_id); return <option key={m.user_id} value={m.user_id}>{name(m.user_id)}{p?.roleName ? ` — ${p.roleName}` : ""}</option>; })}</NativeSelect></Field>{item && <Field label={t("editor.details.priority")} htmlFor="production-priority"><NativeSelect id="production-priority" value={priority} disabled={!canAssign || !!busy} onChange={(e) => { const next = e.target.value as Priority; run("priority", async () => { const r = await setContentPriorityAction(projectId, item.id, next); if (!r.ok) throw new Error(r.error); setPriority(next); }); }}>{PRIORITIES.map((p) => <option key={p} value={p}>{td(`priority.${p}`)}</option>)}</NativeSelect></Field>}{item && <Field label={t("editor.details.audience")} htmlFor="production-audience"><NativeSelect id="production-audience" value={audience ?? ""} disabled={readOnly || !!busy} onChange={(e) => { const next = e.target.value; if (!isAudience(next)) return; run("audience", async () => { const r = await setAudienceTagAction(projectId, [item.id], next); if (!r.ok) throw new Error(r.error); setAudience(next); }); }}>{!audience && <option value="">{tc("audience.untagged")}</option>}{AUDIENCES.map((a) => <option key={a} value={a}>{td(`audience.${a}`)}</option>)}</NativeSelect></Field>}<Field label={t("editor.details.deadline")} htmlFor="production-deadline" error={fieldErrors.due_date}><Input id="production-deadline" type="date" value={form.due_date || ""} disabled={readOnly || !!busy} onChange={(e) => set("due_date", e.target.value || null)} /></Field>{item && <Field label={t("editor.details.workflowStage")} htmlFor="production-stage"><NativeSelect id="production-stage" value={columnOf(item.production_stage)} disabled={readOnly || !!busy || dirty || item.status === "published"} onChange={(e) => transition(e.target.value as ProductionStage)}>{BOARD.map((s) => <option key={s} value={s} disabled={s === "ready" && !approver}>{workflow.labels[s] || t(`stage.${s}`)}</option>)}</NativeSelect></Field>}{item && !readOnly && !["ready", "published", "internal_review", "approval"].includes(item.production_stage) && <Button className="w-full" variant="outline" disabled={!!busy || dirty} onClick={() => transition("internal_review")}>{t("editor.details.submitForReview")}</Button>}</section>
        <section className="space-y-3 border-t pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> {t("editor.ai.title")}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t("editor.ai.intro")}</p><NativeSelect aria-label={t("editor.ai.actionLabel")} value={operation} disabled={readOnly || !!busy} onChange={(e) => setOperation(e.target.value as typeof operation)}><optgroup label={t("editor.ai.contentGroup")}>{AI_OPERATIONS.map((o) => <option key={o} value={o}>{t(`editor.operations.${o}`)}</option>)}</optgroup><optgroup label={t("editor.ai.captionsGroup", { platform: COPY_PLATFORM_LABELS[captionTab] })}>{CAPTION_OPERATIONS.map((o) => <option key={o} value={`cap:${o}`}>{t(`editor.captionOperations.${o}`)}</option>)}</optgroup></NativeSelect>{operation === "translate" && <NativeSelect aria-label={t("editor.ai.translationLanguage")} value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value as Language)}>{LANGUAGES.map((l) => <option key={l} value={l}>{td(`language.${l}`)}</option>)}</NativeSelect>}{operation === "adapt_platform" && <NativeSelect aria-label={t("editor.ai.targetPlatform")} value={targetPlatform} onChange={(e) => setTargetPlatform(e.target.value as Platform)}>{PLATFORMS.map((p) => <option key={p} value={p}>{platformName(p)}</option>)}</NativeSelect>}<Textarea aria-label={t("editor.ai.instructionsLabel")} rows={3} placeholder={t("editor.ai.instructionsPlaceholder")} value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={readOnly || !!busy} /><Button className="w-full" disabled={readOnly || !!busy || !props.aiEnabled} onClick={() => operation.startsWith("cap:") ? generateCaptions(operation.slice(4) as CaptionOperation) : run("ai", async () => { const op = operation as typeof AI_OPERATIONS[number]; const r = await generateProductionAction(projectId, { operation: op, content: { ...form, title: form.title || "Untitled idea" }, instruction, target_language: targetLanguage, target_platform: targetPlatform }); if (!r.ok) { setFieldErrors(r.fieldErrors || {}); throw new Error(r.error); } if (r.data) setDraft({ result: r.data, operation: op, language: targetLanguage, platform: targetPlatform }); })}>{busy === "ai" || busy === "captions" ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy === "ai" || busy === "captions" ? t("editor.ai.writing") : t("editor.ai.generate")}</Button>{!props.aiEnabled && <p className="text-xs text-muted-foreground">{t("editor.ai.unavailable")}</p>}</section>
        {item && <section className="space-y-3 border-t pt-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4" /> {t("editor.slot.title")}</h3><p className="text-xs text-muted-foreground">{t("editor.slot.note", { tz })}</p><Input aria-label={t("editor.slot.dateLabel")} type="date" value={date} disabled={readOnly || !!busy} onChange={(e) => setDate(e.target.value)} /><Input aria-label={t("editor.slot.timeLabel")} type="time" value={time} disabled={readOnly || !!busy} onChange={(e) => setTime(e.target.value)} /><Button className="w-full" variant="outline" disabled={readOnly || !!busy || dirty || item.production_stage !== "ready" || !date || !time} onClick={() => run("schedule", async () => { const r = await scheduleProductionAction(projectId, item.id, item.revision, date, time); if (!r.ok) throw new Error(r.error); if (r.data) accept(r.data); toast.success(r.message); })}>{item.status === "scheduled" ? t("editor.slot.update") : t("editor.slot.schedule")}</Button>{item.production_stage !== "ready" && item.status !== "published" && <p className="text-xs text-muted-foreground">{t("editor.slot.approvalRequired")}</p>}<Button asChild variant="link" size="sm"><Link href={`/p/${projectId}/calendar?${item.scheduled_date ? `view=day&date=${item.scheduled_date}&` : ""}item=${item.id}`}>{t("editor.slot.openCalendar")}</Link></Button></section>}
      </aside>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-background px-5 py-3"><div className="flex gap-2"><Button variant="ghost" disabled={!!busy} onClick={() => dirty || slotDirty ? setConfirm("close") : props.onClose()}>{tc("actions.close")}</Button>{!readOnly && <Button variant="ghost" disabled={!!busy} onClick={() => { setTemplateName(form.title); setTemplateOpen(true); }}>{t("editor.footer.saveAsTemplate")}</Button>}</div>{!readOnly && <Button disabled={!!busy} onClick={() => run("save", save)}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}{t("editor.footer.save")}</Button>}</footer>
    {draft && <Dialog open onOpenChange={() => setDraft(null)}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{t("editor.suggestion.title")}</DialogTitle><DialogDescription>{draft.result.rationale}</DialogDescription></DialogHeader><div className="max-h-[60vh] space-y-4 overflow-y-auto">{draft.result.assumptions.length > 0 && <div className="rounded-lg bg-muted p-3 text-sm"><strong>{t("editor.suggestion.check")}</strong><ul className="mt-2 list-disc pl-5">{draft.result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}{draft.result.alternative_hooks.length > 0 && <div className="space-y-2"><h4 className="text-sm font-semibold">{t("editor.suggestion.alternativeHooks")}</h4>{draft.result.alternative_hooks.map((hook, i) => <button key={i} dir="auto" className="block w-full rounded border p-3 text-start text-sm hover:bg-muted" onClick={() => { set("hook", hook); setDraft(null); }}>{hook}</button>)}</div>}<div dir={isRTL(draft.operation === "translate" ? draft.language : form.language) ? "rtl" : "ltr"} className="space-y-3">{Object.entries(draft.result.content).map(([key, value]) => <div key={key}><p className="text-xs font-semibold text-muted-foreground">{fieldName(t, key)}</p><p className="whitespace-pre-wrap break-words text-sm">{display(value)}</p></div>)}</div></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDraft(null)}>{t("editor.suggestion.discard")}</Button><Button onClick={applyDraft}>{t("editor.suggestion.apply")}</Button></div></DialogContent></Dialog>}
    {captionDraft && <CaptionDraftDialog draft={captionDraft} current={form.platform_captions} onDraft={setCaptionDraft} onApply={applyCaptions} onCancel={() => setCaptionDraft(null)} busy={busy === "captions"} onRegenerate={() => generateCaptions(captionDraft.operation)} />}
    {confirm && <Dialog open onOpenChange={() => setConfirm(null)}><DialogContent><DialogHeader><DialogTitle>{confirm === "close" ? t("editor.confirm.closeTitle") : t("editor.confirm.restoreTitle")}</DialogTitle><DialogDescription>{confirm === "close" ? t("editor.confirm.closeDescription") : t("editor.confirm.restoreDescription")}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirm(null)}>{tc("actions.cancel")}</Button><Button disabled={!!busy} onClick={() => { if (confirm === "close") props.onClose(); else if (item && selectedVersion) void run("restore", async () => { const r = await restoreProductionAction(projectId, item.id, item.revision, selectedVersion.id); if (!r.ok) throw new Error(r.error); if (r.data) accept(r.data); setConfirm(null); toast.success(r.message); }); }}>{confirm === "close" ? t("editor.confirm.discard") : t("editor.confirm.restore")}</Button></div></DialogContent></Dialog>}
    {templateOpen && <Dialog open onOpenChange={() => setTemplateOpen(false)}><DialogContent><DialogHeader><DialogTitle>{t("editor.template.title")}</DialogTitle><DialogDescription>{t("editor.template.description")}</DialogDescription></DialogHeader><Input aria-label={t("editor.template.nameLabel")} value={templateName} onChange={(e) => setTemplateName(e.target.value)} /><Button disabled={!!busy || !templateName.trim()} onClick={() => run("template", async () => { const r = await saveTemplateAction(projectId, templateName, "", form); if (!r.ok) throw new Error(r.error); setTemplateOpen(false); toast.success(r.message); })}>{t("editor.template.save")}</Button></DialogContent></Dialog>}
    {zoomAt !== null && tiles[zoomAt] && <MediaLightbox assets={tiles} index={zoomAt} onIndex={setZoomAt} onClose={() => setZoomAt(null)} />}
    {assetToRemove && <Dialog open onOpenChange={() => setAssetToRemove(null)}><DialogContent><DialogHeader><DialogTitle>{t("editor.removeAsset.title")}</DialogTitle><DialogDescription>{t("editor.removeAsset.description")}</DialogDescription></DialogHeader><Button variant="destructive" disabled={!!busy} onClick={() => run("remove", async () => { if (!item) return; const r = await removeMediaAction(projectId, item.id, assetToRemove); if (!r.ok) throw new Error(r.error); toast.success(r.message ?? t("editor.removeAsset.deleted")); setAssetToRemove(null); await loadDetails(item.id, true); })}>{t("editor.removeAsset.confirm")}</Button></DialogContent></Dialog>}
  </DialogContent></Dialog>;
}
function WritingField({ label, value, onChange, disabled, rows, hint, error }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; rows: number; hint?: string; error?: string }) {
  const id = React.useId(); return <Field label={label} htmlFor={id} error={error}><Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="resize-y text-sm leading-7" />{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</Field>;
}
function EventList({ events, name, stamp, t }: { events: ProductionDetails["events"]; name: (id: string | null) => string; stamp: (date: string) => string; t: TFor<"production"> }) { return <div className="space-y-3">{events.map((e) => <article key={e.id} className="rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><strong>{name(e.actor_id)} · {t.has(`editor.eventKinds.${e.kind}`) ? t(`editor.eventKinds.${e.kind}` as "editor.eventKinds.created") : e.kind.replaceAll("_", " ")}</strong><time className="text-muted-foreground">{stamp(e.created_at)} · r{e.revision}</time></div><p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm">{e.body}</p>{e.mentions.length > 0 && <p className="mt-2 text-xs text-primary">{t("editor.review.mentioned", { names: e.mentions.map(name).join(", ") })}</p>}</article>)}</div>; }
/** Display name of a stored field (falls back to the column name for any field without a label). */
function fieldName(t: TFor<"production">, key: string) { return t.has(`editor.fieldNames.${key}`) ? t(`editor.fieldNames.${key}` as "editor.fieldNames.title") : key.replaceAll("_", " "); }
function display(value: unknown) { return value == null || value === "" ? "—" : Array.isArray(value) ? value.join(" ") : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value); }


