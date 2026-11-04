// App shell: sidebar navigation, workspace/project switchers and account menu.
const nav = {
  global: { dashboard: "Dashboard", tasks: "My tasks", projects: "Projects", team: "Team", aiUsage: "AI usage", settings: "Settings" },
  sections: { learn: "Learn", plan: "Plan & produce", results: "Results" },
  project: {
    overview: { label: "Overview", hint: "Brand profile, channels and where to start" },
    strategy: { label: "Strategy", hint: "Goals, audiences, content themes and targets" },
    integrations: { label: "Integrations", hint: "Connect Facebook, Instagram, YouTube, LinkedIn and TikTok" },
    history: { label: "Content history", hint: "How your past posts performed" },
    competitors: { label: "Competitors", hint: "What competitors publish and how it performs" },
    seo: { label: "Google search", hint: "What people search for on Google" },
    opportunities: { label: "Opportunities", hint: "Ranked ideas for what to create next" },
    backlog: { label: "Ideas Backlog", hint: "Every idea, scored and waiting for a date" },
    calendar: { label: "Calendar", hint: "What gets published, when and where" },
    production: { label: "Production", hint: "Content being written, reviewed and approved" },
    analytics: { label: "Analytics", hint: "Is the plan delivered, and what needs your attention" },
  },
  workspaces: "Workspaces",
  newWorkspace: "New workspace",
  projectLabel: "Project",
  selectProject: "Select a project",
  noProjects: "No projects yet",
  switchProject: "Switch project",
  newProject: "New project",
  openProjectHint: "Open a project to work on its strategy, intelligence and calendar.",
  account: "Account",
  signOut: "Sign out",
};

export default nav;
