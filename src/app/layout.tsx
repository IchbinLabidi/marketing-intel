import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/ui/confirm";
import { THEME_SCRIPT } from "@/lib/theme";
import { I18nProvider } from "@/i18n/client";
import { LOCALE_META } from "@/i18n/config";
import { getLocale, getMessages, getT } from "@/i18n/server";
import { siteConfig } from "@/config/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getT("common")]);
  return {
    title: { default: `${siteConfig.name} — ${t("meta.titleSuffix")}`, template: `%s · ${siteConfig.name}` },
    description: t("meta.description"),
    openGraph: { locale: LOCALE_META[locale].og, siteName: siteConfig.name },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolved on the server (cookie → saved profile preference → Accept-Language → French), so the first paint
  // is already in the right language: no flash of the wrong one.
  const locale = await getLocale();
  return (
    // The theme class is set on <html> by THEME_SCRIPT before React hydrates, hence suppressHydrationWarning.
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          <TooltipProvider>{children}</TooltipProvider>
          <ConfirmHost />
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
