import * as React from "react";
import { cn } from "@/lib/utils";
import { fieldSurface } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("flex min-h-20 w-full rounded-md px-3 py-2 text-sm leading-relaxed", fieldSurface, className)}
      {...props}
    />
  );
}

export { Textarea };
