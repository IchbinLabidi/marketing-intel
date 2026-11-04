"use client";
import * as React from "react";
import { Check, Copy, Loader2, Lock, RefreshCw, Sparkles, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { cn } from "@/lib/utils";
import {
  COPY_LANGUAGES, COPY_LIMITS, COPY_PLATFORM_LABELS, COPY_PLATFORMS, composePlatformText, emptyCopy, hasCopy, LENGTHS,
  MAIN_COPY_PLATFORMS, OBJECTIVES, PLATFORM_FIELDS, POST_TYPES, tagsOf, TONES,
  type CopyField, type CopyPlatform, type CopySettings, type PlatformCaptions, type PlatformCopy,
} from "@/lib/production/platform-copy";
import type { CaptionOperation } from "@/lib/validation/production";
import type { CaptionDraft } from "@/server/ai/captions";
import { useFormatter, useT } from "@/i18n/client";
import type { TFor } from "@/i18n/messages";
import type { Formatter } from "@/i18n/format";

type T = TFor<"production">;

/** Tabs shown for an item: the main platforms, plus any other platform that has copy or was added. */
export function visiblePlatforms(captions: PlatformCaptions, added: CopyPlatform[] = []): CopyPlatform[] {
  return COPY_PLATFORMS.filter((p) => (MAIN_COPY_PLATFORMS as readonly CopyPlatform[]).includes(p) || captions[p] || added.includes(p));
}
function labelOf(t: T, p: CopyPlatform, f: CopyField) {
  if (p === "youtube" && f === "title") return t("captions.special.seoTitle");
  if ((p === "youtube" || p === "youtube_shorts") && f === "title") return t("captions.special.videoTitle");
  if (p === "youtube" && f === "caption") return t("captions.special.fullDescription");
  if (p === "youtube_shorts" && f === "caption") return t("captions.special.description");
  if (p === "pinterest" && f === "caption") return t("captions.special.description");
  if (p === "facebook" && f === "caption") return t("captions.special.captionPostText");
  if (p === "youtube" && f === "keywords") return t("captions.special.tagsKeywords");
  if (p === "youtube_shorts" && f === "keywords") return t("captions.special.seoKeywords");
  if (p === "tiktok" && f === "keywords") return t("captions.special.keywordsOptional");
  if (f === "link" || f === "alt_text") return t("captions.special.optional", { label: t(`captions.fields.${f}`) });
  if (f === "chapters") return t("captions.special.chaptersOptional");
  return t(`captions.fields.${f}`);
}
const counter = (fmt: Formatter, n: number, max?: number) => <span className={cn("tabular-nums", max && n > max && "font-medium text-destructive")}>{fmt.number(n)}{max ? ` / ${fmt.number(max)}` : ""}</span>;
export const copyText = (p: CopyPlatform, c: PlatformCopy) => [c.title.trim(), composePlatformText(c, p)].filter(Boolean).join("\n\n");
async function copyToClipboard(value: string, messages: { copied: string; blocked: string }) {
  try { await navigator.clipboard.writeText(value); toast.success(messages.copied); } catch { toast.error(messages.blocked); }
}

/** Space-separated tags edited as text, so spaces can be typed; the list updates as you type. */
function TagInput({ id, value, onChange, disabled, placeholder }: { id: string; value: string[]; onChange: (v: string[]) => void; disabled: boolean; placeholder: string }) {
  const [raw, setRaw] = React.useState(value.join(" "));
  const [synced, setSynced] = React.useState(value);
  if (synced !== value) { setSynced(value); if (tagsOf(raw).join(" ") !== value.join(" ")) setRaw(value.join(" ")); }
  return <Input id={id} dir="auto" value={raw} disabled={disabled} placeholder={placeholder} onChange={(e) => { setRaw(e.target.value); onChange(tagsOf(e.target.value)); }} />;
}

/** The fields of one platform, used in the editor and in the AI preview. */
export function CopyFields({ platform, value, onChange, disabled, idPrefix }: { platform: CopyPlatform; value: PlatformCopy; onChange: (v: PlatformCopy) => void; disabled: boolean; idPrefix: string }) {
  const t = useT("production"); const fmt = useFormatter();
  const set = <K extends keyof PlatformCopy>(k: K, v: PlatformCopy[K]) => onChange({ ...value, [k]: v });
  const limits = COPY_LIMITS[platform];
  const id = (f: string) => `${idPrefix}-${platform}-${f}`;
  return <div className="space-y-3">{PLATFORM_FIELDS[platform].map((f) => {
    if (f === "post_type") return <Field key={f} label={labelOf(t, platform, f)} htmlFor={id(f)}><NativeSelect id={id(f)} value={value.post_type} disabled={disabled} onChange={(e) => set("post_type", e.target.value)} className="h-8 sm:max-w-56">{(POST_TYPES[platform] ?? []).map((o) => <option key={o.value} value={o.value}>{t(`captions.postType.${o.value as "reel"}`)}</option>)}</NativeSelect></Field>;
    if (f === "hashtags" || f === "keywords") return <Field key={f} label={labelOf(t, platform, f)} htmlFor={id(f)} hint={f === "hashtags" && limits.hashtags ? t("captions.hashtagsAllowed", { count: value.hashtags.length, max: limits.hashtags }) : undefined}><TagInput id={id(f)} value={value[f]} disabled={disabled} onChange={(v) => set(f, v)} placeholder={f === "hashtags" ? t("captions.placeholders.hashtags") : t("captions.placeholders.keywords")} /></Field>;
    if (f === "title" || f === "link" || f === "cta") return <Field key={f} label={labelOf(t, platform, f)} htmlFor={id(f)}><Input id={id(f)} dir="auto" value={value[f]} disabled={disabled} onChange={(e) => set(f, e.target.value)} placeholder={f === "link" ? "https://…" : undefined} />{f === "title" && <p className="text-xs text-muted-foreground">{t.rich("captions.characters", { count: () => counter(fmt, value.title.length, limits.title) })}</p>}</Field>;
    const rows = f === "caption" ? (platform === "youtube" ? 8 : 5) : f === "alt_text" ? 2 : 3;
    return <Field key={f} label={labelOf(t, platform, f)} htmlFor={id(f)}><Textarea id={id(f)} dir="auto" rows={rows} value={value[f]} disabled={disabled} onChange={(e) => set(f, e.target.value)} className="resize-y text-sm leading-7" placeholder={f === "chapters" ? t("captions.placeholders.chapters") : f === "links" ? t("captions.placeholders.links") : undefined} />{f === "caption" && <p className="text-xs text-muted-foreground">{t.rich("captions.characters", { count: () => counter(fmt, value.caption.length, limits.caption) })}</p>}</Field>;
  })}</div>;
}

export function CopySettingsControls({ global, onGlobal, platform, copy, onCopy, disabled }: { global: CopySettings; onGlobal: (s: CopySettings) => void; platform: CopyPlatform; copy: PlatformCopy | undefined; onCopy: (c: PlatformCopy) => void; disabled: boolean }) {
  const t = useT("production");
  const [scope, setScope] = React.useState<"all" | "platform">(copy && Object.values(copy.settings).some((v) => v && v !== "auto") ? "platform" : "all");
  const values: CopySettings = scope === "all" ? global : { ...global, ...copy?.settings } as CopySettings;
  const change = (k: keyof CopySettings, v: string) => {
    if (scope === "all") onGlobal({ ...global, [k]: v });
    else { const base = copy ?? emptyCopy(platform); onCopy({ ...base, settings: { ...base.settings, [k]: v } }); }
  };
  const option = (k: keyof CopySettings, o: string) => k === "tone" ? t(`captions.tone.${o as "auto"}`) : k === "language" ? t(`captions.copyLanguage.${o as "auto"}`) : k === "objective" ? t(`captions.objective.${o as "auto"}`) : t(`captions.length.${o as "auto"}`);
  const selects: [keyof CopySettings, string, readonly string[]][] = [["tone", t("captions.settings.tone"), TONES], ["language", t("captions.settings.language"), COPY_LANGUAGES], ["objective", t("captions.settings.objective"), OBJECTIVES], ["length", t("captions.settings.length"), LENGTHS]];
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{t("captions.settings.for")}</span>{(["all", "platform"] as const).map((s) => <Button key={s} type="button" size="xs" variant={scope === s ? "secondary" : "ghost"} aria-pressed={scope === s} onClick={() => setScope(s)}>{s === "all" ? t("captions.settings.allPlatforms") : t("captions.settings.platformOnly", { platform: COPY_PLATFORM_LABELS[platform] })}</Button>)}{scope === "platform" && copy && Object.values(copy.settings).some((v) => v && v !== "auto") && <Button type="button" size="xs" variant="link" disabled={disabled} onClick={() => onCopy({ ...copy, settings: {} })}>{t("captions.settings.clearOverride")}</Button>}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{selects.map(([k, label, options]) => <label key={k} className="space-y-1 text-[11px] text-muted-foreground"><span>{label}</span><NativeSelect aria-label={t("captions.settings.selectLabel", { label, scope: scope === "all" ? t("captions.settings.scopeAll") : COPY_PLATFORM_LABELS[platform] })} className="h-8 text-xs" value={values[k] ?? "auto"} disabled={disabled} onChange={(e) => change(k, e.target.value)}>{options.map((o) => <option key={o} value={o}>{option(k, o)}</option>)}</NativeSelect></label>)}</div>
  </div>;
}

type SectionProps = {
  captions: PlatformCaptions; onChange: (next: PlatformCaptions) => void; active: CopyPlatform; onActive: (p: CopyPlatform) => void;
  legacy: string; onLegacy: (v: string) => void; legacyError?: string; settings: CopySettings; onSettings: (s: CopySettings) => void;
  disabled: boolean; aiEnabled: boolean; busy: string | null; onGenerate: (operation: CaptionOperation) => void;
};
export function PlatformCaptionsSection(props: SectionProps) {
  const { captions, active, disabled } = props;
  const t = useT("production"); const tc = useT("common"); const fmt = useFormatter();
  const copyMessages = { copied: tc("actions.copied"), blocked: t("captions.copyBlocked") };
  const [added, setAdded] = React.useState<CopyPlatform[]>([]);
  const tabs = visiblePlatforms(captions, [...added, active]);
  const extras = COPY_PLATFORMS.filter((p) => !tabs.includes(p));
  const copy = captions[active] ?? emptyCopy(active);
  const approved = copy.status === "approved";
  const update = (next: PlatformCopy) => props.onChange({ ...captions, [active]: next });
  const generating = props.busy === "captions";
  const aiBlocked = disabled || !!props.busy || !props.aiEnabled;
  const [showLegacy, setShowLegacy] = React.useState(Boolean(props.legacy.trim()));
  return <section aria-labelledby="platform-captions-title" className="space-y-3 rounded-lg border bg-background/40 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id="platform-captions-title" className="text-sm font-semibold">{t("captions.section.title")}</h3><p className="text-xs text-muted-foreground">{t("captions.section.intro")}</p></div>
      <Button type="button" size="sm" variant="soft" disabled={aiBlocked} onClick={() => props.onGenerate("generate_all")}>{generating ? <Loader2 className="animate-spin" /> : <Sparkles />}{t("captions.section.generateAll")}</Button></div>
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("captions.section.platformsLabel")}>
      {tabs.map((p) => { const c = captions[p]; return <Button key={p} type="button" role="tab" aria-selected={active === p} size="xs" variant={active === p ? "secondary" : "ghost"} className={cn(active === p && "ring-1 ring-primary/40")} onClick={() => props.onActive(p)}>{c?.status === "approved" ? <Lock className="size-3" /> : hasCopy(c) ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}{COPY_PLATFORM_LABELS[p]}<span className="sr-only">{c?.status === "approved" ? t("captions.section.srFinal") : hasCopy(c) ? t("captions.section.srWritten") : t("captions.section.srEmpty")}</span></Button>; })}
      {extras.length > 0 && !disabled && <NativeSelect aria-label={t("captions.section.addPlatform")} className="h-7 w-auto text-xs" value="" onChange={(e) => { const p = e.target.value as CopyPlatform; if (!p) return; setAdded([...added, p]); props.onActive(p); }}><option value="">{t("captions.section.otherPlatform")}</option>{extras.map((p) => <option key={p} value={p}>{COPY_PLATFORM_LABELS[p]}</option>)}</NativeSelect>}
    </div>
    <div role="tabpanel" aria-label={COPY_PLATFORM_LABELS[active]} className="space-y-3">
      {approved && <p className="flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-1.5 text-xs text-success"><Lock className="size-3.5" />{t("captions.section.markedFinal")}</p>}
      <CopyFields platform={active} value={copy} onChange={update} disabled={disabled || !!props.busy} idPrefix="studio" />
      <CopySettingsControls key={active} global={props.settings} onGlobal={props.onSettings} platform={active} copy={captions[active]} onCopy={update} disabled={disabled || !!props.busy} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={aiBlocked} onClick={() => props.onGenerate("generate_current")}>{generating ? <Loader2 className="animate-spin" /> : hasCopy(captions[active]) ? <RefreshCw /> : <Sparkles />}{hasCopy(captions[active]) ? t("captions.section.regenerate", { platform: COPY_PLATFORM_LABELS[active] }) : t("captions.section.generateFor", { platform: COPY_PLATFORM_LABELS[active] })}</Button>
        <Button type="button" size="sm" variant="outline" disabled={!hasCopy(captions[active])} onClick={() => copyToClipboard(copyText(active, copy), copyMessages)}><Copy />{tc("actions.copy")}</Button>
        {!disabled && <Button type="button" size="sm" variant="ghost" disabled={!!props.busy || (!approved && !hasCopy(captions[active]))} onClick={() => update({ ...copy, status: approved ? "draft" : "approved" })}>{approved ? <Unlock /> : <Check />}{approved ? t("captions.section.unlock") : t("captions.section.markFinal")}</Button>}
        {!disabled && props.legacy.trim() && !hasCopy(captions[active]) && <Button type="button" size="sm" variant="ghost" onClick={() => update({ ...copy, caption: props.legacy })}>{t("captions.section.startFromGeneral")}</Button>}
        {!disabled && !(MAIN_COPY_PLATFORMS as readonly CopyPlatform[]).includes(active) && <Button type="button" size="sm" variant="ghost" onClick={() => { const next = { ...captions }; delete next[active]; setAdded(added.filter((p) => p !== active)); props.onChange(next); props.onActive(MAIN_COPY_PLATFORMS[0]); }}><X />{t("captions.section.remove", { platform: COPY_PLATFORM_LABELS[active] })}</Button>}
      </div>
      {!props.aiEnabled && <p className="text-xs text-muted-foreground">{t("captions.section.aiUnavailable")}</p>}
      <p className="text-xs text-muted-foreground">{t("captions.section.aiNote")}</p>
    </div>
    <div className="border-t pt-2">
      <Button type="button" size="xs" variant="ghost" aria-expanded={showLegacy} onClick={() => setShowLegacy(!showLegacy)}>{props.legacy.trim() ? (showLegacy ? t("captions.section.hideGeneralLegacy") : t("captions.section.showGeneralLegacy")) : (showLegacy ? t("captions.section.hideGeneral") : t("captions.section.showGeneral"))}</Button>
      {showLegacy && <Field label={t("captions.section.legacyLabel")} htmlFor="production-caption" error={props.legacyError}><Textarea id="production-caption" dir="auto" rows={4} value={props.legacy} disabled={disabled || !!props.busy} onChange={(e) => props.onLegacy(e.target.value)} className="resize-y text-sm leading-7" /><p className="text-xs text-muted-foreground">{t.rich("captions.section.legacyHint", { count: () => counter(fmt, props.legacy.length) })}</p></Field>}
    </div>
  </section>;
}

export type CaptionDraftState = { operation: CaptionOperation; platforms: CopyPlatform[]; kept: CopyPlatform[]; result: CaptionDraft; edits: Partial<Record<CopyPlatform, PlatformCopy>>; alternatives: PlatformCopy[]; choice: number; apply: CopyPlatform[] };

/** Turns AI variants into editable copies on top of the current ones (settings and status preserved). */
export function draftFrom(result: CaptionDraft, operation: CaptionOperation, platforms: CopyPlatform[], kept: CopyPlatform[], current: PlatformCaptions): CaptionDraftState {
  const toCopy = (p: CopyPlatform, v: CaptionDraft["variants"][number]): PlatformCopy => {
    const base = current[p] ?? emptyCopy(p);
    const next: PlatformCopy = { ...base };
    for (const f of PLATFORM_FIELDS[p]) (next as Record<string, unknown>)[f] = f === "post_type" ? (v.post_type || base.post_type) : v[f];
    return next;
  };
  const edits: CaptionDraftState["edits"] = {};
  for (const v of result.variants) if (!edits[v.platform]) edits[v.platform] = toCopy(v.platform, v);
  const alternatives = operation === "alternatives" ? result.variants.map((v) => toCopy(v.platform, v)) : [];
  const got = platforms.filter((p) => edits[p]);
  // "all platforms" proposes to fill empty platforms; replacing written copy is opt-in per platform
  const apply = operation === "generate_all" ? got.filter((p) => !hasCopy(current[p])) : got;
  return { operation, platforms: got, kept, result, edits, alternatives, choice: 0, apply };
}

export function CaptionDraftDialog({ draft, current, onDraft, onApply, onRegenerate, onCancel, busy }: { draft: CaptionDraftState; current: PlatformCaptions; onDraft: (d: CaptionDraftState) => void; onApply: () => void; onRegenerate: () => void; onCancel: () => void; busy: boolean }) {
  const t = useT("production"); const tc = useT("common");
  const copyMessages = { copied: tc("actions.copied"), blocked: t("captions.copyBlocked") };
  const alt = draft.operation === "alternatives";
  const [view, setView] = React.useState<CopyPlatform>(draft.platforms[0]);
  const shown = alt ? draft.alternatives[draft.choice] : draft.edits[view];
  const setShown = (c: PlatformCopy) => alt ? onDraft({ ...draft, alternatives: draft.alternatives.map((a, i) => (i === draft.choice ? c : a)) }) : onDraft({ ...draft, edits: { ...draft.edits, [view]: c } });
  const toggle = (p: CopyPlatform) => onDraft({ ...draft, apply: draft.apply.includes(p) ? draft.apply.filter((x) => x !== p) : [...draft.apply, p] });
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}><DialogContent className="sm:max-w-3xl">
    <DialogHeader><DialogTitle>{t("captions.draft.title")}</DialogTitle><DialogDescription>{draft.result.rationale || t("captions.draft.fallbackDescription")}</DialogDescription></DialogHeader>
    <div className="max-h-[62vh] space-y-3 overflow-y-auto pe-1">
      {draft.result.assumptions.length > 0 && <div className="rounded-lg bg-muted p-3 text-sm"><strong>{t("captions.draft.check")}</strong><ul className="mt-2 list-disc ps-5">{draft.result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      {draft.kept.length > 0 && <p className="text-xs text-muted-foreground"><Lock className="me-1 inline size-3" />{t("captions.draft.kept", { platforms: draft.kept.map((p) => COPY_PLATFORM_LABELS[p]).join(", ") })}</p>}
      {!alt && draft.platforms.length > 1 && <div className="space-y-1.5"><p className="text-xs font-medium">{t("captions.draft.applyTo")}</p><div className="flex flex-wrap gap-1.5">{draft.platforms.map((p) => <label key={p} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", view === p && "border-primary/50 bg-primary-soft")}><input type="checkbox" checked={draft.apply.includes(p)} onChange={() => toggle(p)} aria-label={t("captions.draft.applyPlatform", { platform: COPY_PLATFORM_LABELS[p] })} /><button type="button" className="font-medium" onClick={() => setView(p)}>{COPY_PLATFORM_LABELS[p]}</button>{hasCopy(current[p]) && <Badge variant="warning">{t("captions.draft.replacesCurrent")}</Badge>}</label>)}</div><p className="text-[11px] text-muted-foreground">{t("captions.draft.untickedNote")}</p></div>}
      {!alt && draft.platforms.length === 1 && (hasCopy(current[view]) || current[view]?.status === "approved") && <p className="text-xs"><Badge variant="warning">{current[view]?.status === "approved" ? t("captions.draft.replacesFinal") : t("captions.draft.replacesCopy")}</Badge> {t("captions.draft.othersUnchanged")}</p>}
      {alt && <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("captions.draft.alternativesLabel")}>{draft.alternatives.map((_, i) => <Button key={i} type="button" size="xs" role="radio" aria-checked={draft.choice === i} variant={draft.choice === i ? "secondary" : "ghost"} onClick={() => onDraft({ ...draft, choice: i })}>{t("captions.draft.version", { n: i + 1 })}</Button>)}</div>}
      <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold text-muted-foreground">{alt ? t("captions.draft.platformVersion", { platform: COPY_PLATFORM_LABELS[draft.platforms[0]], n: draft.choice + 1 }) : COPY_PLATFORM_LABELS[view]}</p>{shown && <CopyFields key={`${view}-${draft.choice}`} platform={alt ? draft.platforms[0] : view} value={shown} onChange={setShown} disabled={busy} idPrefix="draft" />}</div>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={busy} onClick={onCancel}>{tc("actions.cancel")}</Button>
      <Button variant="outline" disabled={!shown} onClick={() => shown && copyToClipboard(copyText(alt ? draft.platforms[0] : view, shown), copyMessages)}><Copy />{tc("actions.copy")}</Button>
      <Button variant="outline" disabled={busy} onClick={onRegenerate}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t("captions.draft.regenerate")}</Button>
      <Button disabled={busy || (!alt && !draft.apply.length)} onClick={onApply}><Check />{!alt && draft.platforms.length > 1 ? t("captions.draft.applyCount", { count: draft.apply.length }) : t("captions.draft.apply")}</Button>
    </div>
  </DialogContent></Dialog>;
}
