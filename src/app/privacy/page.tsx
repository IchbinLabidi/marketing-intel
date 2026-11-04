import { LanguageSwitcher } from "@/components/app/language-switcher";
import { siteConfig } from "@/config/site";
import { getT } from "@/i18n/server";
import { languageAlternates } from "@/i18n/seo";

const CONTACT = "elyes.lab@gmail.com";

export async function generateMetadata() {
  const t = await getT("legal");
  return { title: t("privacy.metaTitle"), description: t("privacy.metaDescription", { app: siteConfig.name }), alternates: languageAlternates("/privacy") };
}

/** Public privacy policy, linked from the Google and Meta consent screens. */
export default async function PrivacyPolicy() {
  const t = await getT("legal");
  const v = { app: siteConfig.name, email: CONTACT };
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-16 text-[13px] leading-relaxed">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("privacy.title", v)}</h1>
        <LanguageSwitcher size="sm" />
      </div>
      <p>{t("privacy.intro", v)}</p>

      <h2 className="font-semibold">{t("privacy.accountsTitle")}</h2>
      <p>{t("privacy.accountsBody", v)}</p>

      <h2 className="font-semibold">{t("privacy.driveTitle")}</h2>
      <p>{t.rich("privacy.driveBody", { ...v, code: (c) => <span className="font-mono">{c}</span> })}</p>
      <p>
        {t.rich("privacy.googlePolicy", {
          ...v,
          link: (c) => <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">{c}</a>,
        })}
      </p>

      <h2 className="font-semibold">{t("privacy.sharingTitle")}</h2>
      <p>{t("privacy.sharingBody", v)}</p>

      <h2 className="font-semibold">{t("privacy.removingTitle")}</h2>
      <p>{t("privacy.removingBody", v)}</p>
    </main>
  );
}
