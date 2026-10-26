import "server-only";
import type { Platform } from "@/lib/domain/constants";

// One provider per data source. A provider only reports what the source actually returned: metrics it doesn't
// expose stay null (shown as "not available"), never zero.

export type CollectedProfile = {
  external_id: string | null;
  display_name: string | null;
  bio: string | null;
  followers_count: number | null;
  media_count: number | null;
  profile_image_url: string | null;
  website: string | null;
};

export type CollectedPost = {
  external_id: string;
  url: string | null;
  published_at: string | null;
  caption: string | null;
  format: string | null;
  media_type: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  saves: number | null;
  duration_seconds: number | null;
  metrics_raw: Record<string, number>;
};

export type CollectResult = {
  profile: CollectedProfile;
  posts: CollectedPost[];
  /** true when more posts existed in the window than were collected (max posts or a provider limit) */
  truncated: boolean;
  notes: string[];
  calls: number;
};

/** Credentials available to providers for one project (never sent to the browser). */
export type ProviderCredentials = {
  meta: { igUserId: string | null; pageToken: string } | null;
  youtubeKey: string | null;
  xBearer: string | null;
};

export type Availability = { ok: true } | { ok: false; status: "needs_config" | "unsupported"; reason: string };

export interface DataProvider {
  id: string;
  label: string;
  platform: Platform;
  /** data_source enum value stored on collected posts */
  source: "meta_api" | "youtube_api" | "x_api";
  availability(creds: ProviderCredentials): Availability;
  collect(channel: { handle: string; external_id: string | null }, opts: { since: Date; max: number }, creds: ProviderCredentials): Promise<CollectResult>;
}

/** Error with a status the UI can show (permission missing, account not found, rate limited…). */
export class ProviderError extends Error {
  constructor(message: string, readonly status: "failed" | "needs_config" = "failed", readonly retryable = false) {
    super(message);
  }
}

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
