import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { getT } from "@/i18n/server";

export async function generateMetadata() {
  const t = await getT("auth");
  return { title: t("signup.metaTitle") };
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next: raw } = await searchParams;
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : undefined;
  const joining = Boolean(next?.startsWith("/invite/"));
  const t = await getT("auth");
  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{joining ? t("signup.titleJoining") : t("signup.title")}</h1>
        <p className="text-[13.5px] text-muted-foreground">{joining ? t("signup.subtitleJoining") : t("signup.subtitle")}</p>
      </div>
      <SignupForm next={next} />
      <p className="border-t pt-5 text-[13px] text-muted-foreground">
        {t("signup.haveAccount")}{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-foreground underline-offset-4 hover:underline">
          {t("signup.signIn")}
        </Link>
      </p>
    </div>
  );
}
