import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { EmptyState } from "./empty-state";

/** Shown instead of a page the member's role doesn't give access to (direct URLs included). `what` is already translated. */
export async function PermissionDenied({ what, backHref = "/tasks" }: { what?: string; backHref?: string }) {
  const t = await getT("common");
  return (
    <EmptyState
      icon={Lock}
      title={t("permissionDenied.title")}
      description={t("permissionDenied.description", { what: what ?? t("permissionDenied.thisPage") })}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>{t("actions.goToMyTasks")}</Link>
        </Button>
      }
      className="mt-6"
    />
  );
}
