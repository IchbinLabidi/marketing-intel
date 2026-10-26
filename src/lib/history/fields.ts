import { METRICS, METRIC_LABELS, type Metric } from "@/lib/domain/constants";
import { normalizeText } from "./text";

// Application fields an imported column can be mapped to. Aliases are compared after normalizeText()
// (lowercase, no accents, no punctuation), so "Date de publication" and "date_publication" both match.
export type TargetFieldKind = "date" | "text" | "longtext" | "platform" | "metric";
export type TargetField = { key: string; label: string; kind: TargetFieldKind; aliases: string[]; hint?: string };

const TEXT_FIELDS: TargetField[] = [
  {
    key: "publication_date", label: "Publication date", kind: "date",
    hint: "Planned or scheduled date from the calendar",
    aliases: ["date", "publication date", "date de publication", "date publication", "date pub", "jour", "day", "planned date", "date prevue",
      "scheduled date", "date planifiee", "date programmee", "posting date", "post date", "تاريخ", "تاريخ النشر", "التاريخ"],
  },
  {
    key: "actual_publication_date", label: "Actual publication date", kind: "date",
    hint: "Only if the file records when the post really went live",
    aliases: ["actual date", "actual publication date", "date reelle", "date de publication reelle", "published on", "published at",
      "date effective", "date de mise en ligne", "mise en ligne", "live date", "تاريخ النشر الفعلي"],
  },
  {
    key: "title", label: "Title", kind: "text",
    aliases: ["title", "titre", "post title", "titre du post", "nom", "name", "headline", "contenu", "content", "post", "publication", "العنوان"],
  },
  {
    key: "topic", label: "Topic", kind: "text",
    aliases: ["topic", "sujet", "theme", "thematique", "subject", "sujet du post", "الموضوع"],
  },
  {
    key: "description", label: "Description", kind: "longtext",
    aliases: ["description", "details", "detail", "brief", "idea", "idee", "concept", "resume", "summary", "notes", "remarques", "الوصف"],
  },
  {
    key: "platform", label: "Platform", kind: "platform",
    aliases: ["platform", "plateforme", "reseau", "reseau social", "reseaux sociaux", "channel", "canal", "network", "social network", "media", "المنصة"],
  },
  {
    key: "format", label: "Format", kind: "text",
    aliases: ["format", "type", "type de contenu", "content type", "type de post", "post type", "type de publication", "الشكل"],
  },
  {
    key: "content_pillar", label: "Content pillar", kind: "text",
    aliases: ["pillar", "content pillar", "pilier", "pilier de contenu", "pilier editorial", "rubrique", "category", "categorie", "ligne editoriale"],
  },
  {
    key: "campaign", label: "Campaign", kind: "text",
    aliases: ["campaign", "campagne", "operation", "temps fort", "الحملة"],
  },
  {
    key: "caption", label: "Caption / copy", kind: "longtext",
    aliases: ["caption", "legende", "copy", "texte", "text", "wording", "post copy", "texte du post", "message", "النص"],
  },
  {
    key: "cta", label: "Call to action", kind: "text",
    aliases: ["cta", "call to action", "appel a l action", "appel a action"],
  },
  {
    key: "publication_status", label: "Publication status", kind: "text",
    hint: "Imported as written. A planned item is never treated as published.",
    aliases: ["status", "statut", "etat", "state", "publication status", "statut de publication", "الحالة"],
  },
  {
    key: "marketing_objective", label: "Marketing objective", kind: "text",
    aliases: ["objective", "objectif", "goal", "but", "objectif marketing", "الهدف"],
  },
  {
    key: "product", label: "Product / offer", kind: "text",
    aliases: ["product", "produit", "offre", "offer", "service", "niveau", "matiere"],
  },
];

const METRIC_ALIASES: Record<Metric, string[]> = {
  views: ["views", "vues", "affichages", "media views"],
  impressions: ["impressions", "impr"],
  reach: ["reach", "portee", "couverture", "personnes atteintes"],
  engagements: ["engagements", "engagement", "interactions", "total engagement"],
  clicks: ["clicks", "clics", "link clicks", "clics sur le lien"],
  likes: ["likes", "j aime", "jaime", "reactions", "mentions j aime"],
  comments: ["comments", "commentaires"],
  shares: ["shares", "partages", "reposts"],
  saves: ["saves", "enregistrements", "sauvegardes"],
  video_views: ["video views", "vues video", "lectures", "plays"],
  leads: ["leads", "prospects", "demandes", "contacts", "inscriptions essai"],
  subscriptions: ["subscriptions", "abonnements", "inscriptions", "sign ups", "signups", "subscribers"],
  conversions: ["conversions", "ventes", "sales", "achats", "purchases"],
};

export const TARGET_FIELDS: TargetField[] = [
  ...TEXT_FIELDS,
  ...METRICS.map((m) => ({ key: m, label: METRIC_LABELS[m], kind: "metric" as const, aliases: METRIC_ALIASES[m] })),
];

export const TARGET_FIELD_KEYS = TARGET_FIELDS.map((f) => f.key);
export const fieldByKey = (key: string) => TARGET_FIELDS.find((f) => f.key === key);

/** Mapping is stored as { target_field: source_column }. */
export type ColumnMapping = Record<string, string>;

/**
 * Suggests a mapping for the given headers. Exact alias matches win over partial matches, and each
 * source column is used at most once, so "Date" doesn't get mapped to both publication fields.
 */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => ({ header: h, n: normalizeText(h) }));
  const mapping: ColumnMapping = {};
  const used = new Set<string>();

  const assign = (match: (n: string, alias: string) => boolean) => {
    for (const field of TARGET_FIELDS) {
      if (mapping[field.key]) continue;
      const hit = normalized.find((h) => !used.has(h.header) && field.aliases.some((a) => match(h.n, normalizeText(a))));
      if (hit) {
        mapping[field.key] = hit.header;
        used.add(hit.header);
      }
    }
  };
  assign((n, a) => n === a);
  // Partial pass: whole-word containment only, with aliases of 4+ chars to avoid "type" ⊂ "prototype"-style accidents.
  assign((n, a) => a.length >= 4 && ` ${n} `.includes(` ${a} `));
  return mapping;
}
