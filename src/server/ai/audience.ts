import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AUDIENCE_GUIDE, audienceOfSegment, fallbackAudience, goalFits, parseAudience, segmentForAudience, type Audience } from "@/lib/backlog/audience";
import { isAIConfigured } from "./client";
import { runStructured } from "./run";

// Audience tag (student | parent | teacher) for new content items. Generators ask the model for it; whatever arrives
// without a valid tag is classified here in one cheap call, with a keyword fallback, so no new item is saved untagged.

type Row = {
  audience?: unknown; audience_segment?: string | null; conversion_goal?: string | null; pillar_id?: string | null;
  title?: string | null; description?: string | null; hook?: string | null; caption?: string | null; creative_brief?: string | null;
  topic?: string | null; content_angle?: string | null; target_audience?: string | null;
};

const classifySchema = z.object({ items: z.array(z.object({ key: z.string(), audience: z.string().describe("student, parent or teacher") })) });
const MAX_PER_CALL = 40;

/**
 * Returns the rows with a valid `audience` (and a segment kept in step). Order of preference: the value given, the
 * idea's single-side segment, one low-effort AI classification for the rest, then the keyword/pillar fallback.
 * Never throws for the AI part: a failed call falls back.
 */
export async function withAudience<T extends Row>(projectId: string, userId: string, rows: T[]): Promise<(T & { audience: Audience; audience_segment: string })[]> {
  const tags: (Audience | null)[] = rows.map((r) => parseAudience(r.audience) ?? audienceOfSegment(r.audience_segment));
  const missing = tags.flatMap((t, k) => (t ? [] : [k]));
  if (missing.length) {
    const db = await createClient();
    const pillarIds = [...new Set(missing.map((k) => rows[k].pillar_id).filter((x): x is string => Boolean(x)))];
    const [{ data: project }, { data: pillars }] = await Promise.all([
      db.from("projects").select("name, workspace_id").eq("id", projectId).maybeSingle(),
      pillarIds.length ? db.from("content_pillars").select("id, name, audience_segment").in("id", pillarIds) : Promise.resolve({ data: [] as { id: string; name: string; audience_segment: string | null }[] }),
    ]);
    const pillarOf = (id: string | null | undefined) => (pillars ?? []).find((p) => p.id === id);
    if (project && isAIConfigured()) {
      for (let s = 0; s < missing.length; s += MAX_PER_CALL) {
        const batch = missing.slice(s, s + MAX_PER_CALL);
        try {
          const out = await runStructured({
            feature: "backlog.audience", workspaceId: project.workspace_id, projectId, userId, schema: classifySchema, effort: "low",
            system: `You tag social media content ideas of ${project.name}, an educational brand, with the ONE audience each post targets: ${AUDIENCE_GUIDE}. Answer with exactly one of student, parent, teacher for every key given.`,
            prompt: JSON.stringify(batch.map((k) => {
              const r = rows[k];
              return { key: String(k), title: r.title, text: (r.description ?? r.hook ?? r.caption ?? r.creative_brief ?? r.content_angle ?? "").slice(0, 400), audience_text: r.target_audience ?? null, pillar: pillarOf(r.pillar_id)?.name ?? null };
            })),
          });
          for (const o of out.items) { const k = Number(o.key); if (batch.includes(k)) tags[k] = parseAudience(o.audience); }
        } catch { /* keyword fallback below */ }
      }
    }
    for (const k of missing) {
      const r = rows[k];
      tags[k] ??= fallbackAudience({ segment: r.audience_segment, texts: [r.target_audience, r.title, r.description ?? r.hook ?? r.caption], pillarSegment: pillarOf(r.pillar_id)?.audience_segment });
    }
  }
  return rows.map((r, k) => {
    const audience_segment = segmentForAudience(tags[k]!, r.audience_segment);
    // a conversion goal from the other side of the marketplace is dropped (sides are never mixed)
    return { ...r, audience: tags[k]!, audience_segment, ...(r.conversion_goal && !goalFits(audience_segment, r.conversion_goal) ? { conversion_goal: null } : {}) };
  });
}

/** AI backfill: tags up to `limit` untagged items of the brand (all of them, or only `ids`). Returns how many were tagged. */
export async function tagUntagged(projectId: string, userId: string, ids?: string[], limit = 120) {
  const db = await createClient();
  let q = db.from("content_items").select("id, audience_segment, conversion_goal, pillar_id, title, description, hook, caption, creative_brief, target_audience").eq("project_id", projectId).is("audience", null);
  if (ids) q = q.in("id", ids.slice(0, limit));
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  const tagged = await withAudience(projectId, userId, data ?? []);
  let n = 0;
  for (const r of tagged) {
    const { error: e } = await db.from("content_items").update({ audience: r.audience, audience_segment: r.audience_segment, conversion_goal: r.conversion_goal ?? null }).eq("project_id", projectId).eq("id", r.id).is("audience", null);
    if (!e) n++;
  }
  return { tagged: n, remaining: (data ?? []).length === limit };
}
