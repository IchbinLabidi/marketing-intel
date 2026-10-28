"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border p-8">
      <h2 className="text-lg font-semibold">Analytics could not load</h2>
      <p className="text-sm text-muted-foreground">The data could not be read. Check your connection and try again; no figures are shown rather than incomplete ones.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
