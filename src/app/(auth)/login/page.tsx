import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui/alert";
import { getT } from "@/i18n/server";
import { authErrorText } from "@/server/actions/auth-errors";

export async function generateMetadata() {
  const t = await getT("auth");
  return { title: t("login.metaTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const t = await getT("auth");
  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("login.title")}</h1>
        <p className="text-[13.5px] text-muted-foreground">{t("login.subtitle")}</p>
      </div>
      {error ? <Alert variant="destructive">{authErrorText(String(error), t)}</Alert> : null}
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <p className="border-t pt-5 text-[13px] text-muted-foreground">
        {t("login.noAccount")}{" "}
        <Link href={typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-foreground underline-offset-4 hover:underline">
          {t("login.createOne")}
        </Link>
      </p>
    </div>
  );
}
