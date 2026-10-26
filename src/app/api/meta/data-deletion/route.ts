import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, metaConfig } from "@/server/meta/config";
import { parseSignedRequest } from "@/server/meta/crypto";

/**
 * Meta Data Deletion Request callback (required for App Review). Deletes tokens, connections and every post
 * synced through that Facebook user, then returns a status URL and confirmation code as Meta specifies.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const data = parseSignedRequest(String(form.get("signed_request") ?? ""), metaConfig().appSecret);
  if (!data?.user_id) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured for Meta callbacks" }, { status: 501 });

  const { data: conns } = await admin.from("meta_connections").select("id, project_id").eq("fb_user_id", String(data.user_id));
  for (const c of conns ?? []) {
    await admin.from("historical_content_items").delete().eq("meta_connection_id", c.id);
    await admin.from("meta_connections").delete().eq("id", c.id); // cascades tokens and sync runs
  }
  const code = randomBytes(8).toString("hex");
  return NextResponse.json({ url: `${appUrl()}/meta/data-deletion?code=${code}&n=${conns?.length ?? 0}`, confirmation_code: code });
}
