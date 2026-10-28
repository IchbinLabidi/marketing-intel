import type { NormalizedPost, SocialProvider } from "@/lib/social/normalize";
import type { Counter } from "./http";

export type TokenSet = { access: string; refresh: string | null; expiresAt: string | null; refreshExpiresAt: string | null; scopes: string[] };
export type Account = { externalId: string; name: string | null; handle: string | null; url: string | null; avatar: string | null };
export type Profile = { followers: number | null; totalViews: number | null; totalPosts: number | null; raw: Record<string, unknown> };
/** Access for a sync: an OAuth access token, or none (YouTube public data with the server's API key). */
export type Access = { token: string | null; scopes: string[] };

export interface SocialProviderClient {
  provider: SocialProvider;
  label: string;
  authUrl(state: string, codeChallenge: string): string;
  exchange(code: string, codeVerifier: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  revoke(token: string): Promise<void>;
  accounts(token: string): Promise<Account[]>;
  profile(account: Account, access: Access, counter?: Counter): Promise<Profile>;
  /** Newest first, one page at a time; stops by itself once posts are older than `since`. */
  posts(account: Account, access: Access, opts: { since: Date | null; max: number; counter?: Counter }): AsyncGenerator<NormalizedPost[]>;
}

export const expiresAt = (seconds: unknown) => (typeof seconds === "number" && seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null);
