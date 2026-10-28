import "server-only";
import type { SocialProvider } from "@/lib/social/normalize";
import type { SocialProviderClient } from "../types";
import { linkedin } from "./linkedin";
import { tiktok } from "./tiktok";
import { youtube } from "./youtube";

export const PROVIDERS: Record<SocialProvider, SocialProviderClient> = { youtube, linkedin, tiktok };
export const isSocialProvider = (p: string): p is SocialProvider => p === "youtube" || p === "linkedin" || p === "tiktok";
