import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDriveFile, driveAuthUrl, driveConfig, driveFileMeta, DRIVE_SCOPES } from "@/server/drive/google";

describe("Google Drive", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("asks only for drive.file (files the person picks), offline access and PKCE", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
    const u = new URL(driveAuthUrl("st", "ch"));
    expect(u.searchParams.get("scope")).toBe(DRIVE_SCOPES.join(" "));
    expect(u.searchParams.get("scope")).not.toMatch(/auth\/drive(\s|$)|drive\.readonly/);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("st");
  });

  it("lists exactly which settings are missing", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_NUMBER", "");
    expect(driveConfig().missing).toEqual(expect.arrayContaining(["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLOUD_PROJECT_NUMBER"]));
  });

  it("treats a project number that is not digits as missing (e.g. a secret pasted in the wrong field)", () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_NUMBER", "GOCSPX-abc");
    expect(driveConfig().missing).toContain("GOOGLE_CLOUD_PROJECT_NUMBER");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_NUMBER", "682897425313");
    expect(driveConfig().appId).toBe("682897425313");
  });

  it("refuses malformed file ids before calling Google", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(driveFileMeta("t", "../../etc/passwd")).rejects.toThrow(/Invalid Drive file id/);
    expect(f).not.toHaveBeenCalled();
  });

  it("downloads through the API with the bearer token and stops past the size limit", async () => {
    const big = new Uint8Array(2048);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("alt=media");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return new Response(big, { status: 200, headers: { "content-type": "image/jpeg" } });
    }));
    await expect(downloadDriveFile("tok", "abcdefghijk", 1024)).rejects.toThrow(/larger than/);
    const ok = await downloadDriveFile("tok", "abcdefghijk", 4096);
    expect(ok.size).toBe(2048);
    expect(ok.type).toBe("image/jpeg");
  });

  it("reports deleted files and expired access clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(downloadDriveFile("tok", "abcdefghijk", 1024)).rejects.toThrow(/no longer exists/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(downloadDriveFile("tok", "abcdefghijk", 1024)).rejects.toMatchObject({ kind: "auth" });
  });
});
