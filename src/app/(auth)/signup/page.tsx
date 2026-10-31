import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next: raw } = await searchParams;
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;
  const joining = Boolean(next?.startsWith("/invite/"));
  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{joining ? "Create your account to join the team" : "Create your workspace"}</h1>
        <p className="text-[13.5px] text-muted-foreground">{joining ? "Use the email address the invitation was sent to. You'll join the team right after." : "Free while in beta. No credit card."}</p>
      </div>
      <SignupForm next={next} />
      <p className="border-t pt-5 text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
