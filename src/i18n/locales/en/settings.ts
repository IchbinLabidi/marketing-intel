// Settings page: appearance, language, workspace, members and server integrations.
const settings = {
  metaTitle: "Settings",
  title: "Settings",
  description: "Appearance, workspace details, members and integrations.",
  appearance: { title: "Appearance", description: "Light, dark, or follow your device. Saved on this browser and applied on every page." },
  language: {
    title: "Language",
    description: "The language of the whole interface, dates and numbers. Saved to your account and applied on every device you sign in on.",
  },
  workspace: { title: "Workspace", description: "Projects, members and AI usage belong to a workspace. Agencies typically use one workspace per client." },
  members: {
    title: "Members",
    description: "Who is in this workspace. Invite people and manage roles and permissions on the Team page.",
    unnamed: "Unnamed member",
    you: " · you",
    manage: "Manage team and roles →",
  },
  newWorkspace: {
    title: "New workspace",
    description: "Create a separate workspace. You become its owner and can switch between workspaces from the sidebar.",
  },
  integrations: {
    title: "Integrations",
    description: "Server-side credentials. Keys are never sent to the browser.",
    geminiRole: "Default AI engine",
    anthropicRole: "Premium tasks, optional",
    connected: "Connected",
    setKey: "Set {key}",
    social: "Social media data",
    socialDetail: "Meta, YouTube, LinkedIn, TikTok, connected per project",
    socialWhere: "Open a project → Integrations",
    aiUsageLink: "Models per task and spend are on the <link>AI usage</link> page.",
    addKey: "Add at least one AI key to enable AI features.",
  },
};

export default settings;
