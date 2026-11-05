import type { Notification } from "@/server/services/team";
import type { TFor } from "@/i18n/messages";

type Translators = { t: TFor<"team">; field: TFor<"changeLog">; production: TFor<"production"> };
type Meta = { title?: string; actor?: string; fields?: string[]; stage?: string | null; excerpt?: string; action?: string };

/** Where a notification leads: the card on the Production board, or the task list. */
export function notificationHref(n: Pick<Notification, "project_id" | "content_item_id">) {
  return n.project_id && n.content_item_id ? `/p/${n.project_id}/production?item=${n.content_item_id}` : "/tasks";
}

/**
 * The notification in the reader's language. Notifications written before migration 0031 (or kinds without
 * details) fall back to the English text stored with them.
 */
export function notificationText(n: Pick<Notification, "kind" | "body" | "meta">, { t, field, production }: Translators): string {
  const meta = (n.meta ?? {}) as Meta;
  if (meta.title === undefined) return n.body;
  const say = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const values = { actor: meta.actor || t("live.someone"), title: meta.title, excerpt: meta.excerpt ?? "" };
  switch (n.kind) {
    case "assigned":
      return meta.actor ? say("live.assigned", values) : say("live.assignedNoActor", values);
    case "mention":
      return say("live.mentioned", values);
    case "card_comment":
      return say("live.commented", values);
    case "card_media":
      return say(meta.action === "removed" ? "live.mediaRemoved" : "live.mediaAdded", values);
    case "card_updated": {
      const fields = meta.fields ?? [];
      const stageName = meta.stage && production.has(`stage.${meta.stage}`) ? (production as unknown as (k: string) => string)(`stage.${meta.stage}`) : null;
      if (stageName && fields.length === 1) return say("live.moved", { ...values, stage: stageName });
      const labels = fields.map((f) => (field.has(`field.${f}`) ? (field as unknown as (k: string) => string)(`field.${f}`) : f.replace(/_/g, " ")));
      return say("live.changed", { ...values, fields: labels.join(", ") || t("live.theCard") });
    }
    default:
      return n.body;
  }
}
