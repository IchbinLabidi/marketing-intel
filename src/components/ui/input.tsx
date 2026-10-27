import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared surface for every text-like control (inputs, textareas, selects), so their states match. */
export const fieldSurface =
  "border border-input bg-card shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/15";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium",
        fieldSurface,
        className,
      )}
      {...props}
    />
  );
}

export { Input };
