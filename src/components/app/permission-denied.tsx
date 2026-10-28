import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";

/** Shown instead of a page the member's role doesn't give access to (direct URLs included). */
export function PermissionDenied({ what = "this page", backHref = "/tasks" }: { what?: string; backHref?: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access"
      description={`Your role doesn't include access to ${what}. Ask a workspace admin if you need it.`}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>Go to my tasks</Link>
        </Button>
      }
      className="mt-6"
    />
  );
}
