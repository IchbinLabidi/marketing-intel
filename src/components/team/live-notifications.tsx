"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/i18n/client";
import { playNotificationSound, primeNotificationSound } from "@/lib/notifications/sound";
import { markNotificationsReadAction } from "@/server/actions/team";
import type { Notification } from "@/server/services/team";
import { notificationHref, notificationText } from "./notification-text";

/**
 * Mounted once in the app layout: listens for the signed-in person's new notifications (Supabase Realtime, which
 * only delivers their own rows) and announces each one with a toast and a chime, then refreshes the bell count.
 */
export function LiveNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useT("team");
  const field = useT("changeLog");
  const production = useT("production");
  const latest = React.useRef({ router, t, field, production });
  React.useEffect(() => {
    latest.current = { router, t, field, production };
  });

  React.useEffect(() => {
    const unlock = () => primeNotificationSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => { refreshTimer = null; latest.current.router.refresh(); }, 1500);
    };

    const db = createClient();
    const channel = db
      .channel(`notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const n = payload.new as Notification;
        // Marking as read is an update too; only unread rows (new, or a fresh edit folded into one) are news.
        if (!n?.id || n.read_at) return;
        const { t, field, production, router } = latest.current;
        const href = notificationHref(n);
        toast(notificationText(n, { t, field, production }), {
          id: n.id,
          duration: 8000,
          action: {
            label: t("live.open"),
            onClick: () => { void markNotificationsReadAction([n.id]); router.push(href); },
          },
        });
        playNotificationSound();
        refreshSoon();
      })
      .subscribe();

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (refreshTimer) clearTimeout(refreshTimer);
      void db.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
