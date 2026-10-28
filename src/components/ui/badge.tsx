import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1 rounded-[5px] border px-1.5 text-[11.5px] font-medium leading-none whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-primary/15 bg-primary-soft text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border-strong/70 bg-card text-muted-foreground",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/12 text-warning-foreground",
        destructive: "border-destructive/20 bg-destructive/8 text-destructive",
        info: "border-info/20 bg-info/10 text-info",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

/** `dot` adds a leading status dot in the badge's color. */
function Badge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
