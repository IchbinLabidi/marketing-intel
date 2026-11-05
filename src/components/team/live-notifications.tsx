"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/i18n/client";
import { playNotificationSound, primeNotificationSound } from "@/lib/notifications/sound";
import { markNotificationsReadAction } from "@/server/actions/team";
import type { Notification } from "@/server/services/team";
import { notificationHref, notificationText } from "./notification-text";

const POLL_MS = 30_000;
const COLUMNS = "id, kind, project_id, content_item_id, actor_id, body, meta, read_at, created_at";

/**
 * Mounted once in the app layout: listens for the signed-in person's new notifications and announces each one
 * with a toast and a chime, then refreshes the server-rendered bell count and Notifications page.
 *
 * Realtime only delivers rows the "own read" RLS policy lets through, so the channel must carry the person's JWT:
 * without setAuth() it subscribes as anon and receives nothing. A 30 s poll (and a check on tab focus) catches
 * anything missed while the socket was down.
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
    let disposed = false;
    const db = createClient();
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let retries = 0;
    // id -> created_at (ms) last announced, so a folded edit (same id, newer created_at) is news again.
    // Times are compared as numbers: Realtime and the REST API format timestamps differently.
    const seen = new Map<string, number>();
    let since = 0;
    let ready = false;
    const ms = (iso: string) => Date.parse(iso) || 0;

    const unlock = () => primeNotificationSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    const refreshSoon = () => {
      if (refreshTimer || disposed) return;
      refreshTimer = setTimeout(() => { refreshTimer = null; latest.current.router.refresh(); }, 1000);
    };

    const announce = (n: Notification) => {
      if (!n?.id || n.read_at || disposed) return;
      const at = ms(n.created_at);
      if ((seen.get(n.id) ?? -1) >= at) return;
      seen.set(n.id, at);
      since = Math.max(since, at);
      const { t, field, production, router } = latest.current;
      const href = notificationHref(n);
      toast(notificationText(n, { t, field, production }), {
        id: n.id,
        duration: 8000,
        action: {
          label: t("live.open"),
          onClick: () => { void markNotificationsReadAction([n.id]).then(() => router.refresh()); router.push(href); },
        },
      });
      playNotificationSound();
      refreshSoon();
    };

    const poll = async () => {
      if (disposed || !ready) return;
      const { data } = await db.from("notifications").select(COLUMNS).eq("user_id", userId).is("read_at", null)
        .gte("created_at", new Date(since).toISOString()).order("created_at", { ascending: true }).limit(20);
      for (const n of (data ?? []) as Notification[]) announce(n);
    };

    const subscribe = () => {
      if (disposed) return;
      channel = db
        .channel(`notifications:${userId}:${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
          if (payload.eventType === "DELETE") return refreshSoon();
          const n = payload.new as Notification;
          // Marking as read (here or in another tab) is an update too: just resync the counts.
          if (n?.read_at) return refreshSoon();
          announce(n);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            retries = 0;
            void poll(); // anything that landed while (re)connecting
          } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !disposed) {
            const old = channel;
            channel = null;
            if (old) void db.removeChannel(old);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(subscribe, Math.min(30_000, 1000 * 2 ** retries++));
          }
        });
    };

    const { data: authListener } = db.auth.onAuthStateChange((event, session) => {
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session) void db.realtime.setAuth(session.access_token);
    });

    void (async () => {
      const { data: { session } } = await db.auth.getSession();
      if (disposed) return;
      if (session) await db.realtime.setAuth(session.access_token);
      // Seed with what's already there so opening a tab doesn't replay old notifications (server timestamps,
      // not this browser's clock).
      const { data } = await db.from("notifications").select("id, created_at").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(100);
      for (const row of (data ?? []) as { id: string; created_at: string }[]) {
        seen.set(row.id, ms(row.created_at));
        since = Math.max(since, ms(row.created_at));
      }
      if (disposed) return;
      ready = true;
      subscribe();
    })();

    const pollTimer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      authListener.subscription.unsubscribe();
      if (channel) void db.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
