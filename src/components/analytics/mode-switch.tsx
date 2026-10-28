"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Briefcase, SlidersHorizontal } from "lucide-react";
import { MODE_COOKIE } from "@/lib/analytics/mode";
import { cn } from "@/lib/utils";

function remember(mode: string) {
  document.cookie = `${MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
}

/** CEO / Expert switch. Only changes the presentation: filters stay in the URL and the data and permissions are the same. */
export function ModeSwitch({ mode }: { mode: "ceo" | "expert" }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const set = (m: "ceo" | "expert") => {
    if (m === mode) return;
    remember(m);
    const next = new URLSearchParams(sp.toString());
    next.set("mode", m);
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const item = (m: "ceo" | "expert", label: string, Icon: typeof Briefcase) => (
    <button
      type="button" role="radio" aria-checked={mode === m} onClick={() => set(m)}
      className={cn("inline-flex h-7 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[13px] font-medium transition-colors", mode === m ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
    >
      <Icon className="size-3.5" aria-hidden /> {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="View" aria-busy={pending} className="inline-flex items-center gap-0.5 rounded-md bg-secondary p-0.5 print:hidden max-sm:basis-full">
      {item("ceo", "CEO view", Briefcase)}
      {item("expert", "Expert view", SlidersHorizontal)}
    </div>
  );
}
