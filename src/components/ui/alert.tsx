import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px] leading-relaxed", {
  variants: {
    variant: {
      info: "border-info/25 bg-info/6 [&>svg]:text-info",
      warning: "border-warning/35 bg-warning/8 [&>svg]:text-warning",
      success: "border-success/25 bg-success/6 [&>svg]:text-success",
      destructive: "border-destructive/25 bg-destructive/6 [&>svg]:text-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS = { info: Info, warning: AlertTriangle, success: CheckCircle2, destructive: XCircle } as const;

/** Inline, persistent message about the state of a page or section (use toasts for transient feedback). */
function Alert({
  className,
  variant = "info",
  title,
  action,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & VariantProps<typeof alertVariants> & { title?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div role={variant === "destructive" ? "alert" : "status"} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export { Alert };
