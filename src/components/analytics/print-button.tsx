"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";

export function PrintButton() {
  const t = useT("analytics");
  return <Button size="sm" onClick={() => window.print()}><Printer className="size-3.5" /> {t("print.button")}</Button>;
}
