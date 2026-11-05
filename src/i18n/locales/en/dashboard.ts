// English messages for the "dashboard" namespace (source language: every other locale mirrors these keys).
// Covers the workspace dashboard and the workspace forms/actions.
const dashboard = {
  meta: {
    title: "Dashboard",
  },
  header: {
    greeting: "Hello, {name}",
    title: "Dashboard",
    description: {
      one: "{count} active project. Open a project's Analytics to see what needs your attention.",
      other: "{count} active projects. Open a project's Analytics to see what needs your attention.",
    },
  },
  aiAlert: {
    title: "AI features are not configured",
    body: "Add <code>GEMINI_API_KEY</code> (or <code>ANTHROPIC_API_KEY</code>) to the server environment to enable strategy suggestions, analysis and calendar generation. Everything else works without it.",
  },
  otherWorkspace: {
    title: "Your team's projects are in {workspace}",
    open: "Open {workspace}",
    body: {
      one: "You're a member of {workspace} ({count} project). The workspace you're in now has no projects.",
      other: "You're a member of {workspace} ({count} projects). The workspace you're in now has no projects.",
    },
  },
  empty: {
    title: "Set up your first project",
    description: "A project holds one brand's identity, strategy, past calendars, competitors and upcoming content.",
  },
  projects: {
    title: "Projects",
    description: "Strategy completeness and the next step for each project.",
    viewAll: "View all {count}",
  },
  card: {
    channels: { one: "{count} channel", other: "{count} channels" },
    pillars: { one: "{count} content pillar", other: "{count} content pillars" },
    open: "Open {name}",
    strategy: "Strategy",
    completeness: "{name} strategy completeness",
    done: "Done",
    toDo: "To do",
    next: "Next",
    missing: "{count} to do",
  },
  nextStep: {
    channels: "Add your social channels",
    strategy: "Complete the marketing strategy",
    history: "Import past editorial calendars",
  },
  workspace: {
    nameLabel: "Workspace name",
    rename: "Rename",
    newNamePlaceholder: "e.g. Client: Maison Jasmin",
    newNameLabel: "New workspace name",
    create: "Create workspace",
    created: "Workspace created",
    createFailed: "Could not create workspace",
    onlyAdminsRename: "Only owners and admins can rename the workspace.",
    renamed: "Workspace renamed",
    renameFailed: "Could not rename workspace",
  },
  storage: {
    title: "Storage",
    description: "How much of your Supabase Pro plan the platform uses. Visible to owners and admins.",
    database: "Database",
    databaseNote: "Strategy, content, history and settings of all workspaces",
    files: "Files",
    filesNote: "{count} uploaded files in total · {workspace} in this workspace",
    ofPlan: "of {limit} included · {percent}%",
    biggestTables: "Largest tables",
    byKind: "By kind",
    bucket: { media: "Content media", imports: "Imported calendars" },
    fileCount: { one: "{count} file", other: "{count} files" },
    noFiles: "No files yet",
    footnote: "Videos over 50 MB are compressed before upload, and the spend cap stops usage at the plan limits instead of billing extra.",
    units: { B: "B", KB: "KB", MB: "MB", GB: "GB" },
  },
};

export default dashboard;
