import { CalendarDays, Lightbulb, Swords, Target } from "lucide-react";
import { BrandMark } from "@/components/app/brand";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { getT } from "@/i18n/server";

// What the product actually does, in the order the work happens. No invented numbers or testimonials.
const STAGES = [
  { icon: Target, key: "strategy" },
  { icon: Swords, key: "learn" },
  { icon: Lightbulb, key: "opportunities" },
  { icon: CalendarDays, key: "plan" },
] as const;

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getT("auth");
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between gap-3">
          <BrandMark size="md" />
          <LanguageSwitcher size="sm" />
        </div>
        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[360px]">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-16 xl:px-24">
        <div className="max-w-md">
          <p className="eyebrow">{t("panel.eyebrow")}</p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em]">{t("panel.title")}</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{t("panel.body")}</p>
          <ol className="mt-10 space-y-0">
            {STAGES.map((s, i) => (
              <li key={s.key} className="relative flex gap-4 pb-7 last:pb-0">
                {i < STAGES.length - 1 ? <span className="absolute left-[15px] top-9 bottom-1 w-px bg-border-strong/70" aria-hidden /> : null}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card shadow-xs">
                  <s.icon className="size-4 text-primary" aria-hidden />
                </span>
                <div className="pt-1">
                  <p className="text-[13.5px] font-medium">{t(`panel.stages.${s.key}.title`)}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t(`panel.stages.${s.key}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
