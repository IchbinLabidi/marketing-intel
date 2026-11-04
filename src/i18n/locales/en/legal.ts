// Public legal pages (linked from the Google, Meta and TikTok app settings). {app} is the product name, {email} the contact address.
const legal = {
  privacy: {
    metaTitle: "Privacy policy",
    metaDescription: "What data {app} handles when you connect an account, and how to remove it.",
    title: "{app} privacy policy",
    intro: "{app} is a marketing workspace used by invited teams to plan, publish and analyse social media content. This page explains what data {app} handles when you connect an account and how you can remove it. Contact: {email}.",
    accountsTitle: "Accounts you connect",
    accountsBody: "When a team member connects Facebook, Instagram, YouTube, LinkedIn, TikTok or Google Drive, {app} stores the access tokens encrypted on its servers and uses them only for the actions the team triggers: reading the project’s own posts and metrics, and publishing posts the team has approved. Tokens are never shown in the browser or written to logs.",
    driveTitle: "Google Drive",
    driveBody: "{app} asks only for the <code>drive.file</code> permission: it can access the individual files you pick in Google’s file picker, never the rest of your Drive. For a picked file {app} saves its id, name, type, size and thumbnail link, and downloads its content only when a post using it is published, to send it to the social network you chose. {app} never changes a file’s sharing settings or makes it public. When Instagram needs a link to the media, {app} keeps a temporary private copy for at most the time Instagram takes to fetch it, then deletes it. It also reads your Google account email to show which account is connected.",
    googlePolicy: "{app}’s use and transfer of information received from Google APIs adheres to the <link>Google API Services User Data Policy</link>, including the Limited Use requirements. Google data is not sold, not used for advertising and not used to train AI models.",
    sharingTitle: "Sharing",
    sharingBody: "Data is visible only to members of the workspace it belongs to. It is sent to third parties only when publishing to the social network you selected, and to the hosting and database providers that run {app}.",
    removingTitle: "Removing your data",
    removingBody: "Disconnecting an account in a project’s Integrations page deletes its tokens and revokes {app}’s access. You can also revoke access at any time from your Google Account (Security → Third-party connections) or Facebook settings. To delete everything stored for your workspace, write to the contact address above.",
  },
  terms: {
    metaTitle: "Terms of service",
    metaDescription: "The terms for using {app}, the invitation-only marketing workspace.",
    title: "{app} terms of service",
    intro: "{app} is a marketing workspace used by invited teams to plan, approve, publish and analyse social media content for their own brands. By using {app} you agree to these terms. Contact: {email}.",
    whoTitle: "Who can use {app}",
    whoBody: "Access is by invitation only. You are responsible for the accounts you connect and must be allowed to publish on behalf of them.",
    publishingTitle: "Publishing",
    publishingBody: "{app} publishes only content that a team member has approved and explicitly chosen to publish, to the account and network that member selected. You remain responsible for the content you publish and for following the rules of each network (Facebook, Instagram, TikTok, YouTube, LinkedIn), including their community guidelines and music and branded-content policies.",
    dataTitle: "Your data",
    dataBody: "Your content and connected accounts stay yours. How {app} handles data is described in the <link>privacy policy</link>. You can disconnect any account at any time from a project’s Integrations page.",
    availabilityTitle: "Availability",
    availabilityBody: "{app} is provided as is. Networks can change or limit their APIs, which can temporarily stop a feature such as publishing or statistics. {app} is not liable for posts a network rejects, delays or removes.",
    changesTitle: "Changes",
    changesBody: "These terms can be updated; the current version is always on this page.",
  },
};

export default legal;
