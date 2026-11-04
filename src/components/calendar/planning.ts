import type { ContentItem } from "@/types/domain";
import type { Task } from "@/server/services/team";
import type { TFor } from "@/i18n/messages";

export type Person = { user_id: string; name: string; roleName: string | null; canEdit: boolean };

const DONE = new Set(["approved", "scheduled", "published"]);

/** Internal deadline passed and the content isn't approved, scheduled or published yet. */
export function isOverdue(p: Pick<ContentItem, "status"> & { due_date?: string | null }, today: string) {
  return Boolean(p.due_date && p.due_date < today && !DONE.has(p.status));
}

/** Content type shown on cards: the free-text format, simplified to a short label. */
export function contentType(format: string | null, t: TFor<"calendar">) {
  if (!format) return t("contentType.post");
  const f = format.toLowerCase();
  if (f.includes("reel")) return t("contentType.reel");
  if (f.includes("story")) return t("contentType.story");
  if (f.includes("carousel")) return t("contentType.carousel");
  if (f.includes("video") || f.includes("short")) return t("contentType.video");
  if (f.includes("article") || f.includes("blog")) return t("contentType.article");
  return format.length > 18 ? `${format.slice(0, 17)}…` : format;
}

/** Stored content-type values offered by the filters and quick create (the value is saved; the key names its label). */
export const CONTENT_TYPES = [
  { value: "Social caption", key: "socialCaption" }, { value: "Instagram Reel", key: "instagramReel" }, { value: "Carousel", key: "carousel" },
  { value: "Story sequence", key: "storySequence" }, { value: "Facebook video", key: "facebookVideo" }, { value: "Article", key: "article" },
] as const;

type DomainKey = Parameters<TFor<"domain">>[0];
/**
 * Label of a stored platform / task type from the "domain" namespace (falls back to the raw value). Those groups contain
 * an `other` key, which the key type reads as plural forms, so the dotted path is looked up as is.
 */
export const domainLabel = (td: TFor<"domain">, group: "platform" | "taskType", value: string) =>
  td.has(`${group}.${value}`) ? td(`${group}.${value}` as DomainKey) : value;

export const initials = (name: string) =>
  name.split(/\s+|@/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

/** Who works on an item: lead assignee first, then collaborators with a task. */
export function participants(post: ContentItem, tasks: Task[], people: Map<string, Person>, t: TFor<"calendar">) {
  const ids = [post.assignee_id, ...tasks.filter((t) => t.content_item_id === post.id).map((t) => t.user_id)].filter(Boolean) as string[];
  return [...new Set(ids)].map((id) => people.get(id) ?? { user_id: id, name: t("people.formerMember"), roleName: null, canEdit: false });
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
