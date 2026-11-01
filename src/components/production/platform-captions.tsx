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
  COPY_LANGUAGE_LABELS, COPY_LANGUAGES, COPY_LIMITS, COPY_PLATFORM_LABELS, COPY_PLATFORMS, composePlatformText, emptyCopy, hasCopy, LENGTH_LABELS, LENGTHS,
  MAIN_COPY_PLATFORMS, OBJECTIVE_LABELS, OBJECTIVES, PLATFORM_FIELDS, POST_TYPES, tagsOf, TONE_LABELS, TONES,
  type CopyField, type CopyPlatform, type CopySettings, type PlatformCaptions, type PlatformCopy,
} from "@/lib/production/platform-copy";
import type { CaptionOperation } from "@/lib/validation/production";
import type { CaptionDraft } from "@/server/ai/captions";

/** Tabs shown for an item: the main platforms, plus any other platform that has copy or was added. */
export function visiblePlatforms(captions: PlatformCaptions, added: CopyPlatform[] = []): CopyPlatform[] {
  return COPY_PLATFORMS.filter((p) => (MAIN_COPY_PLATFORMS as readonly CopyPlatform[]).includes(p) || captions[p] || added.includes(p));
}
const FIELD_LABELS: Record<CopyField, string> = { title: "Title", caption: "Caption", hashtags: "Hashtags", cta: "Call to action", keywords: "Keywords", link: "Link", alt_text: "Alt text", chapters: "Chapter timestamps", links: "Links and resources", post_type: "Post type" };
function labelOf(p: CopyPlatform, f: CopyField) {
  if (p === "youtube" && f === "title") return "SEO title";
  if ((p === "youtube" || p === "youtube_shorts") && f === "title") return "Video title";
  if (p === "youtube" && f === "caption") return "Full description";
  if (p === "youtube_shorts" && f === "caption") return "Description";
  if (p === "pinterest" && f === "caption") return "Description";
  if (p === "facebook" && f === "caption") return "Caption / post text";
  if (p === "youtube" && f === "keywords") return "Tags / keywords";
  if (p === "youtube_shorts" && f === "keywords") return "SEO keywords";
  if (p === "tiktok" && f === "keywords") return "Keywords (optional)";
  if (f === "link" || f === "alt_text") return `${FIELD_LABELS[f]} (optional)`;
  if (f === "chapters") return "Chapter timestamps (optional)";
  return FIELD_LABELS[f];
}
const counter = (n: number, max?: number) => <span className={cn("tabular-nums", max && n > max && "font-medium text-destructive")}>{n.toLocaleString("en")}{max ? ` / ${max.toLocaleString("en")}` : ""}</span>;
export const copyText = (p: CopyPlatform, c: PlatformCopy) => [c.title.trim(), composePlatformText(c, p)].filter(Boolean).join("\n\n");
async function copyToClipboard(value: string) {
  try { await navigator.clipboard.writeText(value); toast.success("Copied"); } catch { toast.error("Your browser blocked copying. Select the text and copy it."); }
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
  const set = <K extends keyof PlatformCopy>(k: K, v: PlatformCopy[K]) => onChange({ ...value, [k]: v });
  const limits = COPY_LIMITS[platform];
  const id = (f: string) => `${idPrefix}-${platform}-${f}`;
  return <div className="space-y-3">{PLATFORM_FIELDS[platform].map((f) => {
    if (f === "post_type") return <Field key={f} label={labelOf(platform, f)} htmlFor={id(f)}><NativeSelect id={id(f)} value={value.post_type} disabled={disabled} onChange={(e) => set("post_type", e.target.value)} className="h-8 sm:max-w-56">{(POST_TYPES[platform] ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect></Field>;
    if (f === "hashtags" || f === "keywords") return <Field key={f} label={labelOf(platform, f)} htmlFor={id(f)} hint={f === "hashtags" && limits.hashtags ? `${value.hashtags.length} of ${limits.hashtags} allowed` : undefined}><TagInput id={id(f)} value={value[f]} disabled={disabled} onChange={(v) => set(f, v)} placeholder={f === "hashtags" ? "#topic #brand" : "keyword, another keyword"} /></Field>;
    if (f === "title" || f === "link" || f === "cta") return <Field key={f} label={labelOf(platform, f)} htmlFor={id(f)}><Input id={id(f)} dir="auto" value={value[f]} disabled={disabled} onChange={(e) => set(f, e.target.value)} placeholder={f === "link" ? "https://…" : undefined} />{f === "title" && <p className="text-xs text-muted-foreground">{counter(value.title.length, limits.title)} characters</p>}</Field>;
    const rows = f === "caption" ? (platform === "youtube" ? 8 : 5) : f === "alt_text" ? 2 : 3;
    return <Field key={f} label={labelOf(platform, f)} htmlFor={id(f)}><Textarea id={id(f)} dir="auto" rows={rows} value={value[f]} disabled={disabled} onChange={(e) => set(f, e.target.value)} className="resize-y text-sm leading-7" placeholder={f === "chapters" ? "0:00 Intro\n0:45 …  (only with the edited video's real timings)" : f === "links" ? "One link or resource per line" : undefined} />{f === "caption" && <p className="text-xs text-muted-foreground">{counter(value.caption.length, limits.caption)} characters</p>}</Field>;
  })}</div>;
}

export function CopySettingsControls({ global, onGlobal, platform, copy, onCopy, disabled }: { global: CopySettings; onGlobal: (s: CopySettings) => void; platform: CopyPlatform; copy: PlatformCopy | undefined; onCopy: (c: PlatformCopy) => void; disabled: boolean }) {
  const [scope, setScope] = React.useState<"all" | "platform">(copy && Object.values(copy.settings).some((v) => v && v !== "auto") ? "platform" : "all");
  const values: CopySettings = scope === "all" ? global : { ...global, ...copy?.settings } as CopySettings;
  const change = (k: keyof CopySettings, v: string) => {
    if (scope === "all") onGlobal({ ...global, [k]: v });
    else { const base = copy ?? emptyCopy(platform); onCopy({ ...base, settings: { ...base.settings, [k]: v } }); }
  };
  const selects: [keyof CopySettings, string, readonly string[], Record<string, string>][] = [["tone", "Tone", TONES, TONE_LABELS], ["language", "Language", COPY_LANGUAGES, COPY_LANGUAGE_LABELS], ["objective", "Objective", OBJECTIVES, OBJECTIVE_LABELS], ["length", "Length", LENGTHS, LENGTH_LABELS]];
  return <div className="space-y-2 rounded-lg border bg-muted/20 p-2.5">
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">AI settings for</span>{(["all", "platform"] as const).map((s) => <Button key={s} type="button" size="xs" variant={scope === s ? "secondary" : "ghost"} aria-pressed={scope === s} onClick={() => setScope(s)}>{s === "all" ? "All platforms" : `${COPY_PLATFORM_LABELS[platform]} only`}</Button>)}{scope === "platform" && copy && Object.values(copy.settings).some((v) => v && v !== "auto") && <Button type="button" size="xs" variant="link" disabled={disabled} onClick={() => onCopy({ ...copy, settings: {} })}>Clear override</Button>}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{selects.map(([k, label, options, labels]) => <label key={k} className="space-y-1 text-[11px] text-muted-foreground"><span>{label}</span><NativeSelect aria-label={`${label} (${scope === "all" ? "all platforms" : COPY_PLATFORM_LABELS[platform]})`} className="h-8 text-xs" value={values[k] ?? "auto"} disabled={disabled} onChange={(e) => change(k, e.target.value)}>{options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}</NativeSelect></label>)}</div>
  </div>;
}

type SectionProps = {
  captions: PlatformCaptions; onChange: (next: PlatformCaptions) => void; active: CopyPlatform; onActive: (p: CopyPlatform) => void;
  legacy: string; onLegacy: (v: string) => void; legacyError?: string; settings: CopySettings; onSettings: (s: CopySettings) => void;
  disabled: boolean; aiEnabled: boolean; busy: string | null; onGenerate: (operation: CaptionOperation) => void;
};
export function PlatformCaptionsSection(props: SectionProps) {
  const { captions, active, disabled } = props;
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
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id="platform-captions-title" className="text-sm font-semibold">Platform Captions &amp; Descriptions</h3><p className="text-xs text-muted-foreground">Each platform keeps its own copy. Publishing uses it; a platform left empty uses the general caption.</p></div>
      <Button type="button" size="sm" variant="soft" disabled={aiBlocked} onClick={() => props.onGenerate("generate_all")}>{generating ? <Loader2 className="animate-spin" /> : <Sparkles />}Generate all captions</Button></div>
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Platforms">
      {tabs.map((p) => { const c = captions[p]; return <Button key={p} type="button" role="tab" aria-selected={active === p} size="xs" variant={active === p ? "secondary" : "ghost"} className={cn(active === p && "ring-1 ring-primary/40")} onClick={() => props.onActive(p)}>{c?.status === "approved" ? <Lock className="size-3" /> : hasCopy(c) ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}{COPY_PLATFORM_LABELS[p]}<span className="sr-only">{c?.status === "approved" ? " (final)" : hasCopy(c) ? " (written)" : " (empty)"}</span></Button>; })}
      {extras.length > 0 && !disabled && <NativeSelect aria-label="Add another platform" className="h-7 w-auto text-xs" value="" onChange={(e) => { const p = e.target.value as CopyPlatform; if (!p) return; setAdded([...added, p]); props.onActive(p); }}><option value="">+ Other platform</option>{extras.map((p) => <option key={p} value={p}>{COPY_PLATFORM_LABELS[p]}</option>)}</NativeSelect>}
    </div>
    <div role="tabpanel" aria-label={COPY_PLATFORM_LABELS[active]} className="space-y-3">
      {approved && <p className="flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-1.5 text-xs text-success"><Lock className="size-3.5" />Marked final. &quot;Generate all captions&quot; leaves this platform unchanged.</p>}
      <CopyFields platform={active} value={copy} onChange={update} disabled={disabled || !!props.busy} idPrefix="studio" />
      <CopySettingsControls key={active} global={props.settings} onGlobal={props.onSettings} platform={active} copy={captions[active]} onCopy={update} disabled={disabled || !!props.busy} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={aiBlocked} onClick={() => props.onGenerate("generate_current")}>{generating ? <Loader2 className="animate-spin" /> : hasCopy(captions[active]) ? <RefreshCw /> : <Sparkles />}{hasCopy(captions[active]) ? `Regenerate ${COPY_PLATFORM_LABELS[active]}` : `Generate for ${COPY_PLATFORM_LABELS[active]}`}</Button>
        <Button type="button" size="sm" variant="outline" disabled={!hasCopy(captions[active])} onClick={() => copyToClipboard(copyText(active, copy))}><Copy />Copy</Button>
        {!disabled && <Button type="button" size="sm" variant="ghost" disabled={!!props.busy || (!approved && !hasCopy(captions[active]))} onClick={() => update({ ...copy, status: approved ? "draft" : "approved" })}>{approved ? <Unlock /> : <Check />}{approved ? "Unlock" : "Mark as final"}</Button>}
        {!disabled && props.legacy.trim() && !hasCopy(captions[active]) && <Button type="button" size="sm" variant="ghost" onClick={() => update({ ...copy, caption: props.legacy })}>Start from the general caption</Button>}
        {!disabled && !(MAIN_COPY_PLATFORMS as readonly CopyPlatform[]).includes(active) && <Button type="button" size="sm" variant="ghost" onClick={() => { const next = { ...captions }; delete next[active]; setAdded(added.filter((p) => p !== active)); props.onChange(next); props.onActive(MAIN_COPY_PLATFORMS[0]); }}><X />Remove {COPY_PLATFORM_LABELS[active]}</Button>}
      </div>
      {!props.aiEnabled && <p className="text-xs text-muted-foreground">AI is unavailable until the provider is configured.</p>}
      <p className="text-xs text-muted-foreground">AI uses this item&apos;s project, hook, script, pillar and audience, plus the instructions in the AI writing assistant. Nothing is saved until you apply it and click Save content.</p>
    </div>
    <div className="border-t pt-2">
      <Button type="button" size="xs" variant="ghost" aria-expanded={showLegacy} onClick={() => setShowLegacy(!showLegacy)}>{showLegacy ? "Hide" : "Show"} general caption{props.legacy.trim() ? " (legacy)" : ""}</Button>
      {showLegacy && <Field label="General caption (legacy)" htmlFor="production-caption" error={props.legacyError}><Textarea id="production-caption" dir="auto" rows={4} value={props.legacy} disabled={disabled || !!props.busy} onChange={(e) => props.onLegacy(e.target.value)} className="resize-y text-sm leading-7" /><p className="text-xs text-muted-foreground">The single caption used before per-platform captions. Kept as written; used for any platform without its own caption. {counter(props.legacy.length)} characters</p></Field>}
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
  const alt = draft.operation === "alternatives";
  const [view, setView] = React.useState<CopyPlatform>(draft.platforms[0]);
  const shown = alt ? draft.alternatives[draft.choice] : draft.edits[view];
  const setShown = (c: PlatformCopy) => alt ? onDraft({ ...draft, alternatives: draft.alternatives.map((a, i) => (i === draft.choice ? c : a)) }) : onDraft({ ...draft, edits: { ...draft.edits, [view]: c } });
  const toggle = (p: CopyPlatform) => onDraft({ ...draft, apply: draft.apply.includes(p) ? draft.apply.filter((x) => x !== p) : [...draft.apply, p] });
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}><DialogContent className="sm:max-w-3xl">
    <DialogHeader><DialogTitle>Review AI captions</DialogTitle><DialogDescription>{draft.result.rationale || "Edit anything before applying. Nothing is saved until you click Save content."}</DialogDescription></DialogHeader>
    <div className="max-h-[62vh] space-y-3 overflow-y-auto pe-1">
      {draft.result.assumptions.length > 0 && <div className="rounded-lg bg-muted p-3 text-sm"><strong>Check before publishing</strong><ul className="mt-2 list-disc ps-5">{draft.result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      {draft.kept.length > 0 && <p className="text-xs text-muted-foreground"><Lock className="me-1 inline size-3" />Kept unchanged (marked final): {draft.kept.map((p) => COPY_PLATFORM_LABELS[p]).join(", ")}</p>}
      {!alt && draft.platforms.length > 1 && <div className="space-y-1.5"><p className="text-xs font-medium">Apply to</p><div className="flex flex-wrap gap-1.5">{draft.platforms.map((p) => <label key={p} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", view === p && "border-primary/50 bg-primary-soft")}><input type="checkbox" checked={draft.apply.includes(p)} onChange={() => toggle(p)} aria-label={`Apply ${COPY_PLATFORM_LABELS[p]}`} /><button type="button" className="font-medium" onClick={() => setView(p)}>{COPY_PLATFORM_LABELS[p]}</button>{hasCopy(current[p]) && <Badge variant="warning">replaces current</Badge>}</label>)}</div><p className="text-[11px] text-muted-foreground">Platforms with existing copy are unticked so nothing is replaced unless you choose it. Click a platform name to review it.</p></div>}
      {!alt && draft.platforms.length === 1 && (hasCopy(current[view]) || current[view]?.status === "approved") && <p className="text-xs"><Badge variant="warning">{current[view]?.status === "approved" ? "Replaces copy marked final" : "Replaces current copy"}</Badge> Other platforms are not changed.</p>}
      {alt && <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Alternative versions">{draft.alternatives.map((_, i) => <Button key={i} type="button" size="xs" role="radio" aria-checked={draft.choice === i} variant={draft.choice === i ? "secondary" : "ghost"} onClick={() => onDraft({ ...draft, choice: i })}>Version {i + 1}</Button>)}</div>}
      <div className="rounded-lg border p-3"><p className="mb-2 text-xs font-semibold text-muted-foreground">{COPY_PLATFORM_LABELS[alt ? draft.platforms[0] : view]}{alt ? ` · version ${draft.choice + 1}` : ""}</p>{shown && <CopyFields key={`${view}-${draft.choice}`} platform={alt ? draft.platforms[0] : view} value={shown} onChange={setShown} disabled={busy} idPrefix="draft" />}</div>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button variant="outline" disabled={!shown} onClick={() => shown && copyToClipboard(copyText(alt ? draft.platforms[0] : view, shown))}><Copy />Copy</Button>
      <Button variant="outline" disabled={busy} onClick={onRegenerate}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Regenerate</Button>
      <Button disabled={busy || (!alt && !draft.apply.length)} onClick={onApply}><Check />Apply{!alt && draft.platforms.length > 1 ? ` (${draft.apply.length})` : ""}</Button>
    </div>
  </DialogContent></Dialog>;
}
