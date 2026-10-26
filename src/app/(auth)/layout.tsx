import { Sparkles } from "lucide-react";
import { siteConfig } from "@/config/site";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </span>
            <span className="font-semibold">{siteConfig.name}</span>
          </div>
          {children}
        </div>
      </div>
      <div className="hidden border-l bg-sidebar lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="max-w-md space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">Stop publishing at random.</h2>
          <p className="text-muted-foreground">
            Turn your marketing strategy, last year&apos;s editorial calendars and competitor observations into a calendar where
            every post has a reason to exist.
          </p>
          <ul className="space-y-3 text-[13px]">
            {[
              "Strategy builder your whole team and the AI share",
              "Import past calendars from Excel, CSV or PDF and find gaps and repetition",
              "Opportunities with a rationale, evidence and confidence level",
              "Content in French, English, Arabic and Tunisian Derja",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
