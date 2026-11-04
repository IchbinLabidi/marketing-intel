import type en from "../en/settings";
import type { Translation } from "../../core";

const settings: Translation<typeof en> = {
  metaTitle: "Paramètres",
  title: "Paramètres",
  description: "Apparence, espace de travail, membres et intégrations.",
  appearance: { title: "Apparence", description: "Clair, sombre ou selon votre appareil. Enregistré dans ce navigateur et appliqué à toutes les pages." },
  language: {
    title: "Langue",
    description: "La langue de toute l’interface, des dates et des nombres. Enregistrée sur votre compte et appliquée sur tous les appareils où vous vous connectez.",
  },
  workspace: { title: "Espace de travail", description: "Les projets, les membres et l’utilisation de l’IA appartiennent à un espace de travail. Les agences utilisent généralement un espace par client." },
  members: {
    title: "Membres",
    description: "Les personnes de cet espace de travail. Invitez des membres et gérez les rôles et les autorisations depuis la page Équipe.",
    unnamed: "Membre sans nom",
    you: " · vous",
    manage: "Gérer l’équipe et les rôles →",
  },
  newWorkspace: {
    title: "Nouvel espace de travail",
    description: "Créez un espace de travail distinct. Vous en devenez propriétaire et pouvez passer d’un espace à l’autre depuis la barre latérale.",
  },
  integrations: {
    title: "Intégrations",
    description: "Identifiants côté serveur. Les clés ne sont jamais envoyées au navigateur.",
    geminiRole: "Moteur d’IA par défaut",
    anthropicRole: "Tâches premium, facultatif",
    connected: "Connecté",
    setKey: "Définir {key}",
    social: "Données des réseaux sociaux",
    socialDetail: "Meta, YouTube, LinkedIn, TikTok, connectés par projet",
    socialWhere: "Ouvrir un projet → Intégrations",
    aiUsageLink: "Les modèles par tâche et les dépenses figurent sur la page <link>Utilisation de l’IA</link>.",
    addKey: "Ajoutez au moins une clé d’IA pour activer les fonctionnalités d’IA.",
  },
};

export default settings;
