"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return <Button size="sm" onClick={() => window.print()}><Printer className="size-3.5" /> Print or save as PDF</Button>;
}
