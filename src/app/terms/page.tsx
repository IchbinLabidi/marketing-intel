import { LanguageSwitcher } from "@/components/app/language-switcher";
import { siteConfig } from "@/config/site";
import { getT } from "@/i18n/server";
import { languageAlternates } from "@/i18n/seo";

const CONTACT = "elyes.lab@gmail.com";

export async function generateMetadata() {
  const t = await getT("legal");
  return { title: t("terms.metaTitle"), description: t("terms.metaDescription", { app: siteConfig.name }), alternates: languageAlternates("/terms") };
}

/** Public terms of service, linked from the TikTok, Google and Meta app settings. */
export default async function TermsOfService() {
  const t = await getT("legal");
  const v = { app: siteConfig.name, email: CONTACT };
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-16 text-[13px] leading-relaxed">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("terms.title", v)}</h1>
        <LanguageSwitcher size="sm" />
      </div>
      <p>{t("terms.intro", v)}</p>

      <h2 className="font-semibold">{t("terms.whoTitle", v)}</h2>
      <p>{t("terms.whoBody")}</p>

      <h2 className="font-semibold">{t("terms.publishingTitle")}</h2>
      <p>{t("terms.publishingBody", v)}</p>

      <h2 className="font-semibold">{t("terms.dataTitle")}</h2>
      <p>{t.rich("terms.dataBody", { ...v, link: (c) => <a className="underline" href="/privacy">{c}</a> })}</p>

      <h2 className="font-semibold">{t("terms.availabilityTitle")}</h2>
      <p>{t("terms.availabilityBody", v)}</p>

      <h2 className="font-semibold">{t("terms.changesTitle")}</h2>
      <p>{t("terms.changesBody")}</p>
    </main>
  );
}
