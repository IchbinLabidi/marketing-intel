import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readTikTokMediaName } from "@/server/publishing/tiktok-media";

export const dynamic = "force-dynamic";

/**
 * Photos TikTok downloads for a photo post (see tiktok-media.ts). Also serves the URL-prefix verification file TikTok
 * asks for (TIKTOK_URL_VERIFICATION = "<file name>:<content>"), so the prefix can be verified without a deploy.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const verification = process.env.TIKTOK_URL_VERIFICATION ?? "";
  const sep = verification.indexOf(":");
  if (sep > 0 && file === verification.slice(0, sep)) {
    return new NextResponse(verification.slice(sep + 1), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const path = readTikTokMediaName(file);
  if (!path) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  if (!admin) return new NextResponse("Unavailable", { status: 503 });
  const { data, error } = await admin.storage.from("production-media").download(path);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
