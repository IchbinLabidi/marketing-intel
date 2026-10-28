import type { ContentItem } from "@/types/domain";
import type { Task } from "@/server/services/team";

export type Person = { user_id: string; name: string; roleName: string | null; canEdit: boolean };

const DONE = new Set(["approved", "scheduled", "published"]);

/** Internal deadline passed and the content isn't approved, scheduled or published yet. */
export function isOverdue(p: Pick<ContentItem, "status"> & { due_date?: string | null }, today: string) {
  return Boolean(p.due_date && p.due_date < today && !DONE.has(p.status));
}

/** Content type shown on cards: the free-text format, simplified to a short label. */
export function contentType(format: string | null) {
  if (!format) return "Post";
  const f = format.toLowerCase();
  if (f.includes("reel")) return "Reel";
  if (f.includes("story")) return "Story";
  if (f.includes("carousel")) return "Carousel";
  if (f.includes("video") || f.includes("short")) return "Video";
  if (f.includes("article") || f.includes("blog")) return "Article";
  return format.length > 18 ? `${format.slice(0, 17)}…` : format;
}

export const initials = (name: string) =>
  name.split(/\s+|@/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

/** Who works on an item: lead assignee first, then collaborators with a task. */
export function participants(post: ContentItem, tasks: Task[], people: Map<string, Person>) {
  const ids = [post.assignee_id, ...tasks.filter((t) => t.content_item_id === post.id).map((t) => t.user_id)].filter(Boolean) as string[];
  return [...new Set(ids)].map((id) => people.get(id) ?? { user_id: id, name: "Former member", roleName: null, canEdit: false });
}

/**
 * Days where one person has several internal deadlines: a simple, honest workload signal.
 * Returns date → [{ person, count }] for counts above the threshold.
 */
export function deadlineConflicts(items: ContentItem[], tasks: Task[], threshold = 2) {
  const load = new Map<string, Map<string, number>>();
  const add = (date: string | null | undefined, user: string | null | undefined) => {
    if (!date || !user) return;
    const day = load.get(date) ?? new Map<string, number>();
    day.set(user, (day.get(user) ?? 0) + 1);
    load.set(date, day);
  };
  const seen = new Set<string>();
  for (const p of items) {
    if (seen.has(p.id) || DONE.has(p.status)) continue;
    seen.add(p.id);
    add(p.due_date, p.assignee_id);
  }
  for (const t of tasks) if (t.status !== "approved" && t.status !== "completed") add(t.due_date, t.user_id);
  const out = new Map<string, { userId: string; count: number }[]>();
  for (const [date, users] of load) {
    const busy = [...users].filter(([, n]) => n >= threshold).map(([userId, count]) => ({ userId, count }));
    if (busy.length) out.set(date, busy);
  }
  return out;
}
