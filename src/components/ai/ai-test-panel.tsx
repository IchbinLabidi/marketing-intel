"use client";

import * as React from "react";
import { CheckCircle2, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { testAIAction, type AITestResult } from "@/server/actions/ai";

/**
 * Manual AI test: one tiny request per provider. "Working" is shown only for a valid answer. After any failure the
 * button becomes "Retry AI test".
 */
export function AITestPanel({ health, readOnly }: { health: { provider: string; label: string; until: string }[]; readOnly: boolean }) {
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<AITestResult[] | null>(null);
  const failed = results?.some((r) => !r.ok) ?? false;
  const run = async () => {
    setBusy(true);
    const r = await testAIAction();
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setResults(r.data!.results);
    (r.data!.results.some((x) => x.ok) ? toast.success : toast.error)(r.message ?? "Test finished");
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium">AI test <span className="text-xs font-normal text-muted-foreground">· one tiny request per provider (fractions of a cent); retries temporary errors twice</span></p>
        <Button size="sm" variant={failed ? "default" : "outline"} onClick={run} disabled={busy || readOnly}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {busy ? "Testing… (up to a few minutes if a provider is overloaded)" : failed ? "Retry AI test" : "Run AI test"}
        </Button>
      </div>
      {!results && health.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">{health.map((h) => <li key={h.provider}>{h.provider}: {h.label}; requests skip it until {h.until} unless the test passes.</li>)}</ul>
      ) : null}
      {results ? (
        <ul className="space-y-1 text-[13px]">
          {results.map((r) => (
            <li key={r.provider} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <span>
                <span className="font-medium">{PROVIDER_LABELS[r.provider]}</span> <span className="text-xs text-muted-foreground">({r.model})</span> — {r.ok ? "working" : r.label}
                <span className="block text-xs text-muted-foreground">{r.message}{r.attempts > 1 && !r.message.includes("attempts") ? ` ${r.attempts} attempts.` : ""}{r.latencyMs ? ` ${(r.latencyMs / 1000).toFixed(1)} s.` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
