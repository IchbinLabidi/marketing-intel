import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="text-[13.5px] text-muted-foreground">Sign in to your workspace.</p>
      </div>
      {error ? <Alert variant="destructive">{String(error)}</Alert> : null}
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <p className="border-t pt-5 text-[13px] text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
