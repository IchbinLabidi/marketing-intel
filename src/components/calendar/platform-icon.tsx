import { Globe, Mail, Newspaper } from "lucide-react";
import { PLATFORM_LABELS, type Platform } from "@/lib/domain/constants";
import { cn } from "@/lib/utils";

/** Small platform glyphs (lucide has no brand icons). Unknown platforms fall back to a generic icon. */
export function PlatformIcon({ platform, className }: { platform: Platform | string | null; className?: string }) {
  const label = platform ? PLATFORM_LABELS[platform as Platform] ?? platform : "No platform";
  const cls = cn("size-3.5 shrink-0", className);
  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" className={cls} role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (platform === "facebook") {
    return (
      <svg viewBox="0 0 24 24" className={cls} role="img" aria-label={label} fill="currentColor">
        <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9z" />
      </svg>
    );
  }
  if (platform === "youtube") {
    return (
      <svg viewBox="0 0 24 24" className={cls} role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
        <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (platform === "tiktok") {
    return (
      <svg viewBox="0 0 24 24" className={cls} role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
        <path d="M14 3c.5 2.6 2.2 4.2 5 4.5" />
      </svg>
    );
  }
  if (platform === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" className={cls} role="img" aria-label={label} fill="currentColor">
        <path d="M4.5 9h3v11h-3zM6 3.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM10 9h2.9v1.5h.1c.4-.8 1.4-1.7 3-1.7 3.1 0 3.7 2 3.7 4.7V20h-3v-5.8c0-1.4 0-3.1-1.9-3.1s-2.2 1.5-2.2 3V20h-3z" />
      </svg>
    );
  }
  if (platform === "x") {
    return (
      <svg viewBox="0 0 24 24" className={cls} role="img" aria-label={label} fill="currentColor">
        <path d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.6z" />
      </svg>
    );
  }
  if (platform === "newsletter") return <Mail className={cls} aria-label={label} />;
  if (platform === "blog") return <Newspaper className={cls} aria-label={label} />;
  return <Globe className={cls} aria-label={label} />;
}
