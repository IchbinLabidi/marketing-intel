import type en from "../en/dashboard";
import type { Translation } from "../../core";

const dashboard: Translation<typeof en> = {
  meta: {
    title: "Tableau de bord",
  },
  header: {
    greeting: "Bonjour, {name}",
    title: "Tableau de bord",
    description: {
      one: "{count} projet actif. Ouvrez les analyses d’un projet pour voir ce qui demande votre attention.",
      other: "{count} projets actifs. Ouvrez les analyses d’un projet pour voir ce qui demande votre attention.",
    },
  },
  aiAlert: {
    title: "Les fonctionnalités d’IA ne sont pas configurées",
    body: "Ajoutez <code>GEMINI_API_KEY</code> (ou <code>ANTHROPIC_API_KEY</code>) à l’environnement du serveur pour activer les suggestions de stratégie, les analyses et la génération du calendrier. Tout le reste fonctionne sans.",
  },
  otherWorkspace: {
    title: "Les projets de votre équipe sont dans {workspace}",
    open: "Ouvrir {workspace}",
    body: {
      one: "Vous êtes membre de {workspace} ({count} projet). L’espace de travail actuel ne contient aucun projet.",
      other: "Vous êtes membre de {workspace} ({count} projets). L’espace de travail actuel ne contient aucun projet.",
    },
  },
  empty: {
    title: "Créez votre premier projet",
    description: "Un projet réunit l’identité d’une marque, sa stratégie, ses anciens calendriers, ses concurrents et ses contenus à venir.",
  },
  projects: {
    title: "Projets",
    description: "Avancement de la stratégie et prochaine étape pour chaque projet.",
    viewAll: "Voir les {count}",
  },
  card: {
    channels: { one: "{count} réseau", other: "{count} réseaux" },
    pillars: { one: "{count} pilier de contenu", other: "{count} piliers de contenu" },
    open: "Ouvrir {name}",
    strategy: "Stratégie",
    completeness: "Avancement de la stratégie de {name}",
    done: "Fait",
    toDo: "À faire",
    next: "Ensuite",
    missing: "{count} à faire",
  },
  nextStep: {
    channels: "Ajoutez vos réseaux sociaux",
    strategy: "Complétez la stratégie marketing",
    history: "Importez vos anciens calendriers éditoriaux",
  },
  workspace: {
    nameLabel: "Nom de l’espace de travail",
    rename: "Renommer",
    newNamePlaceholder: "ex. Client : Maison Jasmin",
    newNameLabel: "Nom du nouvel espace de travail",
    create: "Créer l’espace de travail",
    created: "Espace de travail créé",
    createFailed: "Impossible de créer l’espace de travail",
    onlyAdminsRename: "Seuls les propriétaires et les administrateurs peuvent renommer l’espace de travail.",
    renamed: "Espace de travail renommé",
    renameFailed: "Impossible de renommer l’espace de travail",
  },
  storage: {
    title: "Stockage",
    description: "La part de votre plan Supabase Pro utilisée par la plateforme. Visible par les propriétaires et administrateurs.",
    database: "Base de données",
    databaseNote: "Stratégie, contenus, historique et réglages de tous les espaces",
    files: "Fichiers",
    filesNote: "{count} fichiers envoyés au total · {workspace} dans cet espace",
    ofPlan: "sur {limit} inclus · {percent} %",
    biggestTables: "Tables les plus lourdes",
    byKind: "Par type",
    bucket: { media: "Médias des contenus", imports: "Calendriers importés" },
    fileCount: { one: "{count} fichier", other: "{count} fichiers" },
    noFiles: "Aucun fichier pour l’instant",
    footnote: "Les vidéos de plus de 50 Mo sont compressées avant l’envoi, et le plafond de dépenses arrête l’usage aux limites du plan au lieu de facturer en plus.",
    units: { B: "o", KB: "Ko", MB: "Mo", GB: "Go" },
  },
};

export default dashboard;
