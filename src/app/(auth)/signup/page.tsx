import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Create your workspace</h1>
        <p className="text-[13.5px] text-muted-foreground">Free while in beta. No credit card.</p>
      </div>
      <SignupForm />
      <p className="border-t pt-5 text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
