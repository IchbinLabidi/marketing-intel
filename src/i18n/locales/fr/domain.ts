import type en from "../en/domain";
import type { Translation } from "../../core";

const domain: Translation<typeof en> = {
  platform: {
    instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X",
    pinterest: "Pinterest", snapchat: "Snapchat", threads: "Threads", blog: "Blog", newsletter: "Newsletter", other: "Autre",
  },
  funnel: { awareness: "Notoriété", engagement: "Engagement", trust: "Confiance", acquisition: "Acquisition", conversion: "Conversion", loyalty: "Fidélisation" },
  language: { fr: "Français", en: "Anglais", ar: "Arabe (standard)", ar_tn: "Arabe tunisien (Derja)" },
  contentStatus: {
    idea: "Idée", planned: "Planifié", brief_ready: "Brief prêt", in_production: "En production",
    in_review: "En relecture", approved: "Approuvé", scheduled: "Programmé", published: "Publié", failed: "Échec",
  },
  workflow: { draft: "Brouillon", pending: "En attente d’approbation", approved: "Approuvé", scheduled: "Programmé", published: "Publié", failed: "Échec" },
  metric: {
    views: "Vues", impressions: "Impressions", reach: "Portée", engagements: "Interactions", clicks: "Clics", likes: "J’aime", comments: "Commentaires",
    shares: "Partages", saves: "Enregistrements", video_views: "Vues vidéo", leads: "Prospects", subscriptions: "Abonnements", conversions: "Conversions",
  },
  insight: { data_supported: "Fait historique", hypothesis: "Hypothèse de l’IA", experiment: "Test suggéré" },
  role: { owner: "Propriétaire", admin: "Administrateur", editor: "Éditeur", viewer: "Lecteur" },
  audience: { student: "Élève", parent: "Parent", teacher: "Professeur" },
  audienceInitial: { student: "É", parent: "P", teacher: "Pr" },
  segment: { students: "Élèves", parents: "Parents", teachers: "Professeurs", both: "Tous / Général" },
  side: { students_parents: "Élèves et parents", teachers: "Professeurs", both: "Les deux publics" },
  conversion: {
    forum_participation: "Participation au forum",
    teacher_profile_visits: "Visites de profils de professeurs",
    lesson_requests: "Demandes de cours",
    completed_bookings: "Réservations effectuées",
    teacher_registration: "Inscriptions de professeurs",
    profile_completion: "Profils complétés",
    teacher_activation: "Activation des professeurs",
    lesson_requests_received: "Demandes de cours reçues",
    completed_sessions: "Séances de cours effectuées",
  },
  taskType: { copywriting: "Rédaction", design: "Design", video: "Montage vidéo", seo: "SEO", approval: "Approbation", other: "Autre" },
  taskStatus: {
    backlog: "À faire", assigned: "Assignée", in_progress: "En cours", in_review: "En relecture",
    changes_requested: "Modifications demandées", approved: "Approuvée", completed: "Terminée",
  },
  priority: { low: "Basse", medium: "Moyenne", high: "Haute", urgent: "Urgente" },
  permissionGroup: { workspace: "Espace de travail", modules: "Modules", content: "Idées, briefs et contenus" },
  permission: {
    team: { manage: "Gérer les membres et les invitations" },
    roles: { manage: "Créer et modifier les rôles" },
    settings: { manage: "Paramètres de l’espace de travail" },
    projects: { manage: "Créer et modifier les projets" },
    ai_usage: { view: "Voir l’utilisation et les coûts de l’IA" },
    strategy: { view: "Voir la stratégie et la marque", edit: "Modifier la stratégie et la marque" },
    intelligence: { view: "Voir l’historique des contenus et les concurrents", edit: "Importer, synchroniser et gérer les concurrents" },
    seo: { view: "Voir les recherches Google et les briefs SEO", edit: "Lancer des analyses Google et rédiger des briefs" },
    opportunities: { view: "Voir les opportunités de contenu", edit: "Générer et gérer les opportunités" },
    calendar: { view: "Voir le calendrier éditorial", edit: "Planifier et programmer le calendrier" },
    content: { view_all: "Voir tous les contenus (pas seulement ceux assignés)", create: "Créer des idées et des briefs", edit_any: "Modifier n’importe quel contenu", assign: "Assigner des tâches et des collaborateurs", review: "Relecture interne", approve: "Approbation finale", approve_own: "Approuver son propre travail", delete: "Supprimer des contenus", export: "Exporter des contenus" },
  },
};

export default domain;
