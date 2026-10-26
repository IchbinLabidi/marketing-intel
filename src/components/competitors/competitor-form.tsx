"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/calendar/platform-icon";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { parseProfileUrl } from "@/lib/competitors/urls";
import { saveCompetitorAction } from "@/server/actions/competitors";
import type { Competitor } from "@/server/services/competitors";

export type ProviderStatus = Partial<Record<Platform, { ok: boolean; reason?: string; provider: string | null }>>;

export function CompetitorForm({ projectId, competitor, providers, onClose }: { projectId: string; competitor: Competitor | null; providers: ProviderStatus; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = React.useState({
    name: competitor?.name ?? "", website: competitor?.website ?? "", description: competitor?.description ?? "", industry: competitor?.industry ?? "",
    target_audience: competitor?.target_audience ?? "", monitoring: competitor?.monitoring ?? "weekly", history_days: String(competitor?.history_days ?? 90), max_posts: String(competitor?.max_posts ?? 200),
  });
  const [links, setLinks] = React.useState<string[]>(competitor ? [] : ["", ""]);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const existing = new Set(competitor?.competitor_channels.map((c) => `${c.platform}:${(c.handle ?? "").toLowerCase()}`) ?? []);

  const parsed = links.map((l) => (l.trim() ? parseProfileUrl(l) : null));
  const keys = parsed.map((p) => (p?.ok ? `${p.profile.platform}:${p.profile.handle}` : null));

  const save = async () => {
    setBusy(true);
    setErrors({});
    const r = await saveCompetitorAction(projectId, competitor?.id ?? null, { ...form, history_days: Number(form.history_days), max_posts: Number(form.max_posts), monitoring: form.monitoring as "manual", profiles: links.filter((l) => l.trim()) });
    setBusy(false);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return toast.error(r.error === "Please fix the highlighted fields." ? Object.values(r.fieldErrors ?? {})[0] ?? r.error : r.error); }
    toast.success(r.message);
    onClose();
    if (!competitor && r.data) router.push(`/p/${projectId}/competitors/${r.data.id}`);
    else router.refresh();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{competitor ? `Edit ${competitor.name}` : "Add a competitor"}</DialogTitle>
          <DialogDescription>Paste their profile links: the platform is detected automatically and public posts are collected right after saving.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium">Name<Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Takiacademy" aria-invalid={Boolean(errors.name)} /></label>
            <label className="grid gap-1 text-xs font-medium">Website<Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" aria-invalid={Boolean(errors.website)} /></label>
            <label className="grid gap-1 text-xs font-medium">Industry<Input value={form.industry} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. Online tutoring" /></label>
            <label className="grid gap-1 text-xs font-medium">Target audience<Input value={form.target_audience} onChange={(e) => set("target_audience", e.target.value)} placeholder="e.g. Bac students and parents" /></label>
            <label className="grid gap-1 text-xs font-medium sm:col-span-2">Description<Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What they offer and how they position themselves" /></label>
          </div>

          <section className="space-y-2">
            <p className="text-xs font-medium">Social profiles</p>
            {competitor?.competitor_channels.length ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {competitor.competitor_channels.map((c) => <li key={c.id} className="flex items-center gap-1.5"><PlatformIcon platform={c.platform} /> {c.url} <span className="text-[11px]">(already tracked; remove it from the competitor page)</span></li>)}
              </ul>
            ) : null}
            {links.map((l, k) => {
              const p = parsed[k];
              const dup = keys[k] && (existing.has(keys[k]!) || keys.indexOf(keys[k]) !== k);
              const prov = p?.ok ? providers[p.profile.platform] : undefined;
              return (
                <div key={k} className="space-y-1">
                  <div className="flex gap-2">
                    <Input value={l} onChange={(e) => setLinks(links.map((x, j) => (j === k ? e.target.value : x)))} placeholder="https://www.instagram.com/brand/" aria-label={`Profile link ${k + 1}`} />
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove this link" onClick={() => setLinks(links.filter((_, j) => j !== k))}><X /></Button>
                  </div>
                  {p ? (
                    <p className={`flex items-center gap-1.5 text-[11px] ${!p.ok || dup ? "text-destructive" : "text-muted-foreground"}`}>
                      {p.ok ? <><PlatformIcon platform={p.profile.platform} /> {PLATFORM_LABELS[p.profile.platform]} · @{p.profile.handle.replace(/^@/, "")}{dup ? " · already in the list" : ""}
                        {!dup ? <span className={prov?.ok ? "text-success" : "text-warning"}> · {prov?.ok ? `collected automatically (${prov.provider})` : prov?.reason ?? "manual only"}</span> : null}</> : p.error}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setLinks([...links, ""])}><Plus /> Add a profile link</Button>
          </section>

          <section className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium">Monitoring
              <NativeSelect value={form.monitoring} onChange={(e) => set("monitoring", e.target.value)}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual only</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs font-medium">Historical period
              <NativeSelect value={form.history_days} onChange={(e) => set("history_days", e.target.value)}>
                <option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs font-medium">Max posts per profile
              <NativeSelect value={form.max_posts} onChange={(e) => set("max_posts", e.target.value)}>
                {["50", "100", "200", "500", "1000"].map((n) => <option key={n}>{n}</option>)}
              </NativeSelect>
            </label>
            <p className="text-[11px] text-muted-foreground sm:col-span-3">Each collection reads the period chosen (up to the max) and refreshes metrics of posts already stored, keeping earlier values as snapshots. Platforms return only what they make public: the actual period covered is shown per profile.</p>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !form.name.trim() || parsed.some((p) => p && !p.ok)}>{busy ? <Loader2 className="animate-spin" /> : null} {competitor ? "Save" : "Save and analyze"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
