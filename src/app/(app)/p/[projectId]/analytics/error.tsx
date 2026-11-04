"use client";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useT("analytics");
  const tc = useT("common");
  return (
    <div role="alert" className="space-y-3 rounded-xl border p-8">
      <h2 className="text-lg font-semibold">{t("error.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("error.body")}</p>
      <Button onClick={reset}>{tc("actions.retry")}</Button>
    </div>
  );
}
