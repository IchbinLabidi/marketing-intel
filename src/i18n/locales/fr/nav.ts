import type en from "../en/nav";
import type { Translation } from "../../core";

const nav: Translation<typeof en> = {
  global: { dashboard: "Tableau de bord", tasks: "Mes tâches", projects: "Projets", team: "Équipe", aiUsage: "Utilisation de l’IA", settings: "Paramètres" },
  sections: { learn: "Apprendre", plan: "Planifier et produire", results: "Résultats" },
  project: {
    overview: { label: "Vue d’ensemble", hint: "Profil de marque, canaux et par où commencer" },
    strategy: { label: "Stratégie", hint: "Objectifs, publics, thèmes de contenu et cibles" },
    integrations: { label: "Intégrations", hint: "Connectez Facebook, Instagram, YouTube, LinkedIn et TikTok" },
    history: { label: "Historique des contenus", hint: "Les performances de vos publications passées" },
    competitors: { label: "Concurrents", hint: "Ce que publient vos concurrents et ce qui fonctionne" },
    seo: { label: "Recherche Google", hint: "Ce que les internautes recherchent sur Google" },
    opportunities: { label: "Opportunités", hint: "Idées classées pour vos prochains contenus" },
    backlog: { label: "Banque d’idées", hint: "Toutes les idées, notées et en attente d’une date" },
    calendar: { label: "Calendrier", hint: "Ce qui est publié, quand et où" },
    production: { label: "Production", hint: "Contenus en rédaction, en relecture et approuvés" },
    analytics: { label: "Analyses", hint: "Le plan est-il tenu, et qu’est-ce qui demande votre attention" },
  },
  workspaces: "Espaces de travail",
  newWorkspace: "Nouvel espace de travail",
  projectLabel: "Projet",
  selectProject: "Choisir un projet",
  noProjects: "Aucun projet pour l’instant",
  switchProject: "Changer de projet",
  newProject: "Nouveau projet",
  openProjectHint: "Ouvrez un projet pour travailler sur sa stratégie, sa veille et son calendrier.",
  account: "Compte",
  signOut: "Se déconnecter",
};

export default nav;
