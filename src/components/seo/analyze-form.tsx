"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { analyzeKeywordAction } from "@/server/actions/serp";
import { cn } from "@/lib/utils";

/** Keyword × country × languages × devices; one live SERP request per language and device. */
export function AnalyzeForm({ projectId, countries, languages, configured, setupHint, readOnly, initial }: {
  projectId: string; countries: { code: string; label: string }[]; languages: { code: string; label: string }[];
  configured: boolean; setupHint: string; readOnly: boolean; initial?: { keyword?: string; country?: string; language?: string };
}) {
  const router = useRouter();
  const [keyword, setKeyword] = React.useState(initial?.keyword ?? "");
  const [country, setCountry] = React.useState(initial?.country ?? "tn");
  const [langs, setLangs] = React.useState<string[]>(initial?.language ? [initial.language] : ["fr"]);
  const [devices, setDevices] = React.useState<("desktop" | "mobile")[]>(["desktop", "mobile"]);
  const [busy, setBusy] = React.useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const requests = langs.length * devices.length;

  const run = async () => {
    setBusy(true);
    const ids: string[] = [];
    for (const language of langs) {
      const r = await analyzeKeywordAction(projectId, { keyword, country, language, devices });
      if (!r.ok) { toast.error(r.error); break; }
      ids.push(...(r.data?.ids ?? []));
    }
    setBusy(false);
    if (ids.length) {
      toast.success(`${ids.length} SERP snapshot${ids.length > 1 ? "s" : ""} saved`);
      router.push(`/p/${projectId}/seo/${ids[0]}`);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_10rem_auto_auto_auto]">
        <label className="grid gap-1 text-xs font-medium">Keyword
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. cours informatique bac tunisien" dir="auto" onKeyDown={(e) => { if (e.key === "Enter" && keyword.trim() && configured && !busy) void run(); }} />
        </label>
        <label className="grid gap-1 text-xs font-medium">Country
          <NativeSelect value={country} onChange={(e) => setCountry(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</NativeSelect>
        </label>
        <fieldset className="grid gap-1 text-xs font-medium"><legend className="mb-1">Language</legend>
          <span className="flex gap-1">{languages.map((l) => <Chip key={l.code} on={langs.includes(l.code)} onClick={() => setLangs(toggle(langs, l.code))}>{l.label}</Chip>)}</span>
        </fieldset>
        <fieldset className="grid gap-1 text-xs font-medium"><legend className="mb-1">Device</legend>
          <span className="flex gap-1">{(["desktop", "mobile"] as const).map((d) => <Chip key={d} on={devices.includes(d)} onClick={() => setDevices(toggle(devices, d))}>{d === "desktop" ? "Desktop" : "Mobile"}</Chip>)}</span>
        </fieldset>
        <div className="flex items-end">
          <Button onClick={run} disabled={readOnly || busy || !configured || keyword.trim().length < 2 || !langs.length || !devices.length} className="w-full">
            {busy ? <Loader2 className="animate-spin" /> : <Search />} {busy ? "Analysing…" : "Analyze SERP"}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Search engine: Google, through SerpApi (official API, no scraping). {requests} request{requests > 1 ? "s" : ""} per analysis; the top 8 ranking pages are then read (robots.txt respected) for their structure. Each run is saved as a dated snapshot.
      </p>
      {!configured ? <p className="rounded-lg bg-warning/10 p-2 text-xs text-warning">Requires configuration: {setupHint}</p> : null}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("h-9 rounded-md border px-3 text-[13px]", on ? "border-primary/50 bg-primary/10 font-medium" : "text-muted-foreground hover:bg-accent")}>{children}</button>;
}
