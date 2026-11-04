"use client";

import { Sparkles, UserRound } from "lucide-react";
import { ideaCreator } from "@/lib/backlog/creator";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

/** "AI" or the team member who created an idea / content item. `name` resolves a user id to a display name. */
export function CreatedBy({ item, name, className }: { item: { idea_source?: string | null; calendar_id?: string | null; created_by?: string | null }; name: (userId: string) => string | null | undefined; className?: string }) {
  const t = useT("backlog");
  const c = ideaCreator(item);
  if (c === "ai") return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary", className)} title={t("row.creatorAiHint")}><Sparkles className="size-3" /> {t("row.creatorAi")}</span>;
  const who = name(c.userId) || t("row.creatorMember");
  return <span className={cn("inline-flex min-w-0 max-w-[50%] shrink items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground", className)} title={t("row.creatorHint", { name: who })}><UserRound className="size-3 shrink-0" /> <span className="truncate">{who}</span></span>;
}
