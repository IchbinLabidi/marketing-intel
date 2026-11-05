"use client";

import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import {
  notificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
  subscribeNotificationSound,
} from "@/lib/notifications/sound";

/** Per-browser switch for the notification chime (on by default). */
export function SoundToggle() {
  const t = useT("team");
  const on = React.useSyncExternalStore(subscribeNotificationSound, notificationSoundEnabled, () => true);
  const toggle = () => {
    const next = !on;
    setNotificationSoundEnabled(next);
    if (next) playNotificationSound({ force: true });
  };
  return (
    <Button size="sm" variant="outline" onClick={toggle} aria-pressed={on} title={t("live.soundLabel")}>
      {on ? <Volume2 /> : <VolumeX />} {on ? t("live.soundOn") : t("live.soundOff")}
    </Button>
  );
}
