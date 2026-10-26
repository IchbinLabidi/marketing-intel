import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-[13px] text-muted-foreground">Sign in to your workspace.</p>
      </div>
      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">{String(error)}</p> : null}
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <p className="text-[13px] text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
