"use client";

import * as React from "react";
import { CheckCircle2, Loader2, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS } from "@/lib/ai/models";
import { testAIAction, type AITestResult } from "@/server/actions/ai";
import { useFormatter, useT } from "@/i18n/client";

/**
 * Manual AI test: one tiny request per provider. "Working" is shown only for a valid answer. After any failure the
 * button becomes "Retry AI test".
 */
export function AITestPanel({ health, readOnly }: { health: { provider: string; label: string; until: string }[]; readOnly: boolean }) {
  const t = useT("errors");
  const fmt = useFormatter();
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<AITestResult[] | null>(null);
  const failed = results?.some((r) => !r.ok) ?? false;
  const run = async () => {
    setBusy(true);
    const r = await testAIAction();
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setResults(r.data!.results);
    (r.data!.results.some((x) => x.ok) ? toast.success : toast.error)(r.message ?? t("aiTest.finished"));
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium">{t("aiTest.title")} <span className="text-xs font-normal text-muted-foreground">{t("aiTest.subtitle")}</span></p>
        <Button size="sm" variant={failed ? "default" : "outline"} onClick={run} disabled={busy || readOnly}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCcw />} {busy ? t("aiTest.testing") : failed ? t("aiTest.retry") : t("aiTest.run")}
        </Button>
      </div>
      {!results && health.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">{health.map((h) => <li key={h.provider}>{t("aiTest.health", { provider: h.provider, label: h.label, until: h.until })}</li>)}</ul>
      ) : null}
      {results ? (
        <ul className="space-y-1 text-[13px]">
          {results.map((r) => (
            <li key={r.provider} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <span>
                <span className="font-medium">{PROVIDER_LABELS[r.provider]}</span> <span className="text-xs text-muted-foreground">({r.model})</span> — {r.ok ? t("aiTest.working") : r.label}
                <span className="block text-xs text-muted-foreground">{r.message}{r.attempts > 1 && !r.message.includes(t("aiTest.attemptsWord")) ? t("aiTest.attempts", { count: r.attempts }) : ""}{r.latencyMs ? t("aiTest.seconds", { seconds: fmt.number(r.latencyMs / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
