import { CalendarDays, Lightbulb, Swords, Target } from "lucide-react";
import { BrandMark } from "@/components/app/brand";

// What the product actually does, in the order the work happens. No invented numbers or testimonials.
const STAGES = [
  { icon: Target, title: "Define the strategy", body: "Brand identity, pillars, audiences and goals that your team and the AI share." },
  { icon: Swords, title: "Learn from the past and the market", body: "Import past calendars from Excel, CSV or PDF, track competitors and search results." },
  { icon: Lightbulb, title: "Find the opportunities", body: "Each one comes with a rationale, the evidence behind it and a confidence level." },
  { icon: CalendarDays, title: "Plan and produce", body: "An editorial calendar in French, English, Arabic or Tunisian Derja where every post has a reason." },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <BrandMark size="md" />
        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-[360px]">{children}</div>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-16 xl:px-24">
        <div className="max-w-md">
          <p className="eyebrow">Marketing intelligence</p>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.025em]">Stop publishing at random.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Turn your strategy, last year&apos;s calendars and what competitors are doing into a plan where every post has a reason to exist.
          </p>
          <ol className="mt-10 space-y-0">
            {STAGES.map((s, i) => (
              <li key={s.title} className="relative flex gap-4 pb-7 last:pb-0">
                {i < STAGES.length - 1 ? <span className="absolute left-[15px] top-9 bottom-1 w-px bg-border-strong/70" aria-hidden /> : null}
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card shadow-xs">
                  <s.icon className="size-4 text-primary" aria-hidden />
                </span>
                <div className="pt-1">
                  <p className="text-[13.5px] font-medium">{s.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
