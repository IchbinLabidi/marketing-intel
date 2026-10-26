"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{ classNames: { toast: "!rounded-lg !border !text-[13px]" } }}
      {...props}
    />
  );
}

export { Toaster };
