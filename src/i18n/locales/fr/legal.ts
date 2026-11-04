import type en from "../en/legal";
import type { Translation } from "../../core";

const legal: Translation<typeof en> = {
  privacy: {
    metaTitle: "Politique de confidentialité",
    metaDescription: "Les données que {app} traite lorsque vous connectez un compte, et comment les supprimer.",
    title: "{app} · Politique de confidentialité",
    intro: "{app} est un espace de travail marketing utilisé par des équipes invitées pour planifier, publier et analyser des contenus sur les réseaux sociaux. Cette page explique quelles données {app} traite lorsque vous connectez un compte et comment les supprimer. Contact : {email}.",
    accountsTitle: "Les comptes que vous connectez",
    accountsBody: "Lorsqu’un membre de l’équipe connecte Facebook, Instagram, YouTube, LinkedIn, TikTok ou Google Drive, {app} conserve les jetons d’accès chiffrés sur ses serveurs et ne les utilise que pour les actions déclenchées par l’équipe : lire les publications et les statistiques du projet, et publier les contenus que l’équipe a approuvés. Les jetons ne sont jamais affichés dans le navigateur ni écrits dans les journaux.",
    driveTitle: "Google Drive",
    driveBody: "{app} demande uniquement l’autorisation <code>drive.file</code> : l’application n’accède qu’aux fichiers que vous choisissez dans le sélecteur de fichiers de Google, jamais au reste de votre Drive. Pour un fichier choisi, {app} enregistre son identifiant, son nom, son type, sa taille et le lien de sa miniature, et ne télécharge son contenu qu’au moment où une publication qui l’utilise est publiée, afin de l’envoyer au réseau social choisi. {app} ne modifie jamais les paramètres de partage d’un fichier et ne le rend jamais public. Lorsqu’Instagram a besoin d’un lien vers le média, {app} en conserve une copie privée temporaire, au plus le temps qu’Instagram la récupère, puis la supprime. L’application lit également l’adresse e-mail de votre compte Google pour indiquer quel compte est connecté.",
    googlePolicy: "L’utilisation et le transfert par {app} des informations reçues des API Google respectent la <link>Google API Services User Data Policy</link>, y compris les exigences d’utilisation limitée (Limited Use). Les données Google ne sont ni vendues, ni utilisées à des fins publicitaires, ni utilisées pour entraîner des modèles d’IA.",
    sharingTitle: "Partage",
    sharingBody: "Les données ne sont visibles que par les membres de l’espace de travail auquel elles appartiennent. Elles ne sont transmises à des tiers que lors d’une publication sur le réseau social que vous avez choisi, ainsi qu’aux prestataires d’hébergement et de base de données qui font fonctionner {app}.",
    removingTitle: "Supprimer vos données",
    removingBody: "Déconnecter un compte depuis la page Intégrations d’un projet supprime ses jetons et révoque l’accès accordé à {app}. Vous pouvez aussi révoquer cet accès à tout moment depuis votre compte Google (Sécurité → Connexions tierces) ou depuis les paramètres de Facebook. Pour supprimer toutes les données conservées pour votre espace de travail, écrivez à l’adresse de contact ci-dessus.",
  },
  terms: {
    metaTitle: "Conditions d’utilisation",
    metaDescription: "Conditions d’utilisation de la plateforme {app}, l’espace de travail marketing accessible sur invitation.",
    title: "{app} · Conditions d’utilisation",
    intro: "{app} est un espace de travail marketing utilisé par des équipes invitées pour planifier, approuver, publier et analyser des contenus sur les réseaux sociaux pour leurs propres marques. En utilisant {app}, vous acceptez les présentes conditions. Contact : {email}.",
    whoTitle: "Qui peut utiliser {app}",
    whoBody: "L’accès se fait uniquement sur invitation. Vous êtes responsable des comptes que vous connectez et devez être autorisé à publier en leur nom.",
    publishingTitle: "Publication",
    publishingBody: "{app} ne publie que les contenus qu’un membre de l’équipe a approuvés et a explicitement choisi de publier, sur le compte et le réseau sélectionnés par ce membre. Vous restez responsable des contenus que vous publiez et du respect des règles de chaque réseau (Facebook, Instagram, TikTok, YouTube, LinkedIn), notamment de leurs règles communautaires et de leurs politiques relatives à la musique et aux contenus de marque.",
    dataTitle: "Vos données",
    dataBody: "Vos contenus et vos comptes connectés vous appartiennent. La manière dont {app} traite les données est décrite dans la <link>politique de confidentialité</link>. Vous pouvez déconnecter n’importe quel compte à tout moment depuis la page Intégrations d’un projet.",
    availabilityTitle: "Disponibilité",
    availabilityBody: "{app} est fourni en l’état. Les réseaux peuvent modifier ou limiter leurs API, ce qui peut interrompre temporairement une fonctionnalité comme la publication ou les statistiques. {app} n’est pas responsable des publications qu’un réseau refuse, retarde ou supprime.",
    changesTitle: "Modifications",
    changesBody: "Ces conditions peuvent être mises à jour ; la version en vigueur figure toujours sur cette page.",
  },
};

export default legal;
