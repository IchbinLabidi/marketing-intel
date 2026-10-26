"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-3 rounded-xl border p-8"><h2 className="text-lg font-semibold">Content Production could not load</h2><p className="text-sm text-muted-foreground">Check your connection and try again. On a new deployment, make sure database migration 0007 has been applied.</p><Button onClick={reset}>Try again</Button></div>;
}
