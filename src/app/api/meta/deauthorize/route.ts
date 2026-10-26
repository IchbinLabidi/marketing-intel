import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaConfig } from "@/server/meta/config";
import { parseSignedRequest } from "@/server/meta/crypto";

/** Meta calls this when a person removes the app from their Facebook settings: tokens are deleted immediately. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const data = parseSignedRequest(String(form.get("signed_request") ?? ""), metaConfig().appSecret);
  if (!data?.user_id) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "server not configured for Meta callbacks" }, { status: 501 });
  const { data: conns } = await admin.from("meta_connections").select("id").eq("fb_user_id", String(data.user_id));
  const ids = (conns ?? []).map((c) => c.id);
  if (ids.length) {
    await admin.from("meta_tokens").delete().in("connection_id", ids);
    await admin.from("meta_connections").update({ status: "disconnected", last_error: "Access removed from Facebook settings" }).in("id", ids);
  }
  return NextResponse.json({ ok: true });
}
