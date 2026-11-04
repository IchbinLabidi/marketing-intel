import type en from "../en/setup";
import type { Translation } from "../../core";

const setup: Translation<typeof en> = {
  metaTitle: "Configuration requise",
  title: "{app} doit être configuré",
  noWorkspace: "Votre compte n’a aucun espace de travail. Cela signifie généralement que la migration de la base de données n’a pas été appliquée avant votre inscription.",
  configured: "Supabase est configuré.",
  notConfigured: "L’application ne peut pas encore joindre de base de données. Ajoutez ces variables dans .env.local (en local) ou chez votre hébergeur, puis redémarrez.",
  anonKey: "{anon} (ou {publishable})",
  aiKey: "{gemini} ou {anthropic} (nécessaire pour les fonctionnalités d’IA)",
  steps: {
    supabase: "Créez un projet sur supabase.com, puis copiez l’URL et la clé anon/publishable depuis Project Settings → API.",
    migration: "Exécutez <code>supabase/migrations/0001_init.sql</code> dans l’éditeur SQL de Supabase.",
    ai: "Créez une clé API Gemini sur aistudio.google.com (moteur d’IA par défaut) et, si vous le souhaitez, une clé Anthropic sur console.anthropic.com pour les tâches premium.",
    readme: "Consultez README.md pour le guide d’installation complet.",
  },
};

export default setup;
