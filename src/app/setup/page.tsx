import { CheckCircle2, CircleDashed } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";
import { siteConfig } from "@/config/site";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("setup");
  return { title: t("metaTitle") };
}

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { reason } = await searchParams;
  const t = await getT("setup");
  const code = (c: React.ReactNode) => <code className="font-mono text-xs">{c}</code>;
  const checks = [
    { label: "NEXT_PUBLIC_SUPABASE_URL", ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    {
      label: t("anonKey", { anon: "NEXT_PUBLIC_SUPABASE_ANON_KEY", publishable: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" }),
      ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    },
    { label: t("aiKey", { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" }), ok: Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) },
  ];
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">{t("title", { app: siteConfig.name })}</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {reason === "no-workspace"
          ? t("noWorkspace")
          : isSupabaseConfigured()
            ? t("configured")
            : t("notConfigured")}
      </p>
      <ul className="mt-6 space-y-2 rounded-xl border bg-card p-4">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-[13px]">
            {c.ok ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-muted-foreground" />}
            <code className="font-mono text-xs">{c.label}</code>
          </li>
        ))}
      </ul>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-[13px] text-muted-foreground">
        <li>{t("steps.supabase")}</li>
        <li>{t.rich("steps.migration", { code })}</li>
        <li>{t("steps.ai")}</li>
        <li>{t("steps.readme")}</li>
      </ol>
    </div>
  );
}
