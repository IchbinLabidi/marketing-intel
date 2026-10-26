import { CheckCircle2, CircleDashed } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/env";
import { siteConfig } from "@/config/site";

export const metadata = { title: "Setup required" };

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { reason } = await searchParams;
  const checks = [
    { label: "NEXT_PUBLIC_SUPABASE_URL", ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
      ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    },
    { label: "GEMINI_API_KEY or ANTHROPIC_API_KEY (needed for AI features)", ok: Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) },
  ];
  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">{siteConfig.name} needs configuration</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {reason === "no-workspace"
          ? "Your account has no workspace. This usually means the database migration was not applied before you signed up."
          : isSupabaseConfigured()
            ? "Supabase is configured."
            : "The app can't reach a database yet. Add these variables to .env.local (local) or your hosting provider, then restart."}
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
        <li>Create a project at supabase.com, then copy the URL and anon/publishable key from Project Settings → API.</li>
        <li>Run <code className="font-mono text-xs">supabase/migrations/0001_init.sql</code> in the Supabase SQL editor.</li>
        <li>Create a Gemini API key at aistudio.google.com (default AI engine) and, optionally, an Anthropic key at console.anthropic.com for premium tasks.</li>
        <li>See README.md for the full setup guide.</li>
      </ol>
    </div>
  );
}
