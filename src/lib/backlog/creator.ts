/** Sources whose ideas are written by the AI (generation, strategy pillars, analysis opportunities). */
const AI_SOURCES = new Set(["ai", "pillar", "opportunity"]);

/**
 * Who created an idea: "ai" or the creating member's user id.
 * Older rows have no idea_source; everything saved into an editorial calendar back then was AI-generated
 * (calendar generation and the historical-insights draft), and rows without a creator were loaded by the AI.
 */
export function ideaCreator(idea: { idea_source?: string | null; calendar_id?: string | null; created_by?: string | null }): "ai" | { userId: string } {
  if (idea.idea_source && AI_SOURCES.has(idea.idea_source)) return "ai";
  if (!idea.idea_source && idea.calendar_id) return "ai";
  if (!idea.created_by) return "ai";
  return { userId: idea.created_by };
}
