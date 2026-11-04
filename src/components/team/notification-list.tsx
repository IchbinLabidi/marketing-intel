"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CheckCheck, CircleCheck, MessageSquareWarning, UserPlus, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/i18n/client";
import { markNotificationsReadAction } from "@/server/actions/team";
import type { Notification } from "@/server/services/team";

const ICONS: Record<string, typeof Bell> = {
  assigned: UserPlus, mention: AtSign, review_requested: Eye, changes_requested: MessageSquareWarning, approved: CircleCheck, invited: UserPlus,
};

export function NotificationList({ items }: { items: Notification[] }) {
  const router = useRouter();
  const t = useT("team");
  const fmt = useFormatter();
  const unread = items.filter((n) => !n.read_at).length;
  const markAll = async () => {
    const r = await markNotificationsReadAction();
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  };
  const open = (n: Notification) => {
    if (!n.read_at) void markNotificationsReadAction([n.id]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{unread ? t("notifications.unread", { count: unread }) : t("notifications.allCaughtUp")}</p>
        {unread ? <Button size="sm" variant="outline" onClick={markAll}><CheckCheck /> {t("notifications.markAllRead")}</Button> : null}
      </div>
      {items.length ? (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell;
            const href = n.project_id && n.content_item_id ? `/p/${n.project_id}/production?item=${n.content_item_id}` : "/tasks";
            return (
              <li key={n.id}>
                <Link href={href} onClick={() => open(n)} className={cn("flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40", !n.read_at && "bg-primary-soft/40")}>
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-card", !n.read_at ? "text-primary" : "text-muted-foreground")}>
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13px] leading-snug", !n.read_at && "font-medium")} dir="auto">{n.body}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{fmt.dateTime(n.created_at)}</span>
                  </span>
                  {!n.read_at ? <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label={t("notifications.unreadDot")} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">
          {t("notifications.empty")}
        </p>
      )}
    </div>
  );
}
