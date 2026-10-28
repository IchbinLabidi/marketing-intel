import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmHost } from "@/components/ui/confirm";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Signal — Marketing Intelligence", template: "%s · Signal" },
  description:
    "Turn your marketing strategy, content history and competitor insights into a performance-driven editorial calendar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme class is set on <html> by THEME_SCRIPT before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <ConfirmHost />
        <Toaster />
      </body>
    </html>
  );
}
