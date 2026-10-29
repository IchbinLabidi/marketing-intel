import "server-only";
import { appUrl } from "@/server/meta/config";
import { socialTokenKey } from "@/server/social/config";
import { form, requestJson, SocialApiError } from "@/server/social/http";
import { expiresAt, type TokenSet } from "@/server/social/types";

// Google Drive (official Drive API v3 + Google Picker). Scope drive.file: the app only ever sees files the person
// picks with the Picker (or that the app created). No access to the rest of the Drive, no public sharing.
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const API = "https://www.googleapis.com/drive/v3";

export function driveConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  // The Picker needs an API key and the Cloud project number ("app id"); the YouTube key works if the Picker API is enabled on its project.
  const apiKey = process.env.GOOGLE_PICKER_API_KEY?.trim() || process.env.YOUTUBE_API_KEY?.trim() || "";
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER?.trim() ?? "";
  const missing = [
    !clientId && "GOOGLE_OAUTH_CLIENT_ID", !clientSecret && "GOOGLE_OAUTH_CLIENT_SECRET", !apiKey && "GOOGLE_PICKER_API_KEY",
    !appId && "GOOGLE_CLOUD_PROJECT_NUMBER", !socialTokenKey() && "SOCIAL_TOKEN_ENCRYPTION_KEY",
  ].filter((x): x is string => Boolean(x));
  return { clientId, clientSecret, apiKey, appId, missing, redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || `${appUrl()}/api/drive/callback` };
}

export function driveAuthUrl(state: string, codeChallenge: string) {
  const c = driveConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = form({
    client_id: c.clientId, redirect_uri: c.redirectUri, response_type: "code", scope: DRIVE_SCOPES.join(" "), access_type: "offline", prompt: "consent",
    include_granted_scopes: "true", state, code_challenge: codeChallenge, code_challenge_method: "S256",
  });
  return url.toString();
}

async function token(data: Record<string, string>): Promise<TokenSet & { idToken?: string }> {
  const b = await requestJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string }>(
    "Google", "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(data) },
  );
  return { access: b.access_token, refresh: b.refresh_token ?? null, expiresAt: expiresAt(b.expires_in), refreshExpiresAt: null, scopes: b.scope?.split(" ") ?? [], idToken: b.id_token };
}

export function exchangeDriveCode(code: string, verifier: string) {
  const c = driveConfig();
  return token({ grant_type: "authorization_code", code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, code_verifier: verifier });
}

export function refreshDriveToken(refreshToken: string) {
  const c = driveConfig();
  return token({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
}

export async function revokeDriveToken(t: string) {
  await requestJson("Google", "https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token: t }) }).catch(() => undefined);
}

/** The Google account behind a token (email shown on the Integrations page). */
export async function driveAccount(accessToken: string) {
  const me = await requestJson<{ sub: string; email?: string }>("Google", "https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  return { id: me.sub, email: me.email ?? null };
}

export type DriveFile = {
  id: string; name: string; mimeType: string; size?: string; thumbnailLink?: string; webViewLink?: string; modifiedTime?: string; trashed?: boolean;
  capabilities?: { canDownload?: boolean };
};

/** Metadata through an authorized call: confirms the file exists, isn't trashed and can be downloaded with this access. */
export async function driveFileMeta(accessToken: string, fileId: string): Promise<DriveFile> {
  if (!/^[\w-]{10,200}$/.test(fileId)) throw new SocialApiError("Invalid Drive file id.", 400, "Google Drive", "other");
  return requestJson<DriveFile>("Google Drive", `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,thumbnailLink,webViewLink,modifiedTime,trashed,capabilities(canDownload)&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Downloads a picked file's bytes through the Drive API (never through a sharing link). Refuses files larger than
 * `maxBytes` before and while reading, so a wrong file can't exhaust memory.
 */
export async function downloadDriveFile(accessToken: string, fileId: string, maxBytes: number): Promise<Blob> {
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (res.status === 401) throw new SocialApiError("Google Drive access expired. Reconnect Google Drive.", 401, "Google Drive", "auth");
  if (res.status === 403) throw new SocialApiError("Google Drive refused the download (permission or quota).", 403, "Google Drive", "permission");
  if (res.status === 404) throw new SocialApiError("The Drive file no longer exists or isn't shared with this app anymore.", 404, "Google Drive", "not_found");
  if (!res.ok || !res.body) throw new SocialApiError(`Google Drive download failed (${res.status}).`, res.status, "Google Drive", res.status >= 500 ? "server" : "other");
  const declared = Number(res.headers.get("content-length"));
  if (declared && declared > maxBytes) throw new SocialApiError(`The Drive file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413, "Google Drive", "other");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new SocialApiError(`The Drive file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413, "Google Drive", "other"); }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: res.headers.get("content-type") ?? "application/octet-stream" });
}
