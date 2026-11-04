"use client";

import * as React from "react";
import { ChevronDown, Users } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { AUDIENCES, isAudience, type Audience } from "@/lib/backlog/audience";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";

// The audience tag of an idea / content item (student, parent or teacher), shown the same way on every page.

export const AUDIENCE_TONE: Record<Audience, "info" | "success" | "warning"> = { student: "info", parent: "success", teacher: "warning" };
/** Filter order on every page: All / Teacher / Parent / Student (+ untagged). */
export const AUDIENCE_FILTER_ORDER: Audience[] = ["teacher", "parent", "student"];

/** Colored badge; "Untagged" for older items without a tag. */
export function AudienceBadge({ audience, className }: { audience: string | null | undefined; className?: string }) {
  const a = isAudience(audience) ? audience : null;
  const t = useT("common");
  const td = useT("domain");
  return (
    <span className={cn(badgeVariants({ variant: a ? AUDIENCE_TONE[a] : "outline" }), !a && "border-dashed", className)} title={a ? t("audience.named", { audience: td(`audience.${a}`) }) : t("audience.noTag")}>
      <Users aria-hidden />{a ? td(`audience.${a}`) : t("audience.untagged")}
    </span>
  );
}

/** One-letter badge for dense cells (month view); the full label is in the tooltip. */
export function AudienceMark({ audience }: { audience: string | null | undefined }) {
  const a = isAudience(audience) ? audience : null;
  const t = useT("common");
  const td = useT("domain");
  const named = a ? t("audience.named", { audience: td(`audience.${a}`) }) : null;
  return (
    <span className={cn(badgeVariants({ variant: a ? AUDIENCE_TONE[a] : "outline" }), "h-3.5 shrink-0 px-1 text-[9.5px]", !a && "border-dashed")} title={named ?? t("audience.noTag")} aria-label={named ?? t("audience.untagged")}>
      {a ? td(`audienceInitial.${a}`) : "?"}
    </span>
  );
}

/** The badge as a small dropdown: pick another audience (an existing tag can be changed, not removed). */
export function AudienceSelect({ value, onChange, disabled, className }: { value: string | null | undefined; onChange: (a: Audience) => void; disabled?: boolean; className?: string }) {
  const a = isAudience(value) ? value : null;
  const t = useT("common");
  const td = useT("domain");
  return (
    <span className={cn("relative inline-flex", className)} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <select
        aria-label={t("audience.label")}
        value={a ?? ""}
        disabled={disabled}
        onChange={(e) => isAudience(e.target.value) && onChange(e.target.value)}
        className={cn(badgeVariants({ variant: a ? AUDIENCE_TONE[a] : "outline" }), "cursor-pointer appearance-none pr-4 disabled:cursor-default", !a && "border-dashed")}
      >
        {!a ? <option value="">{t("audience.untagged")}</option> : null}
        {AUDIENCES.map((x) => <option key={x} value={x}>{td(`audience.${x}`)}</option>)}
      </select>
      {!disabled ? <ChevronDown aria-hidden className="pointer-events-none absolute right-1 top-1/2 size-2.5 -translate-y-1/2 opacity-70" /> : null}
    </span>
  );
}

/** List filter: "" = all, an audience, or "none" = untagged. */
export function AudienceFilter({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const t = useT("common");
  const td = useT("domain");
  return (
    <NativeSelect aria-label={t("audience.label")} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("audience.all")}</option>
      {AUDIENCE_FILTER_ORDER.map((x) => <option key={x} value={x}>{td(`audience.${x}`)}</option>)}
      <option value="none">{t("audience.untagged")}</option>
    </NativeSelect>
  );
}
