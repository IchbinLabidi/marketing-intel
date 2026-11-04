// Configuration page shown when the database or AI keys are missing.
const setup = {
  metaTitle: "Setup required",
  title: "{app} needs configuration",
  noWorkspace: "Your account has no workspace. This usually means the database migration was not applied before you signed up.",
  configured: "Supabase is configured.",
  notConfigured: "The app can’t reach a database yet. Add these variables to .env.local (local) or your hosting provider, then restart.",
  anonKey: "{anon} (or {publishable})",
  aiKey: "{gemini} or {anthropic} (needed for AI features)",
  steps: {
    supabase: "Create a project at supabase.com, then copy the URL and anon/publishable key from Project Settings → API.",
    migration: "Run <code>supabase/migrations/0001_init.sql</code> in the Supabase SQL editor.",
    ai: "Create a Gemini API key at aistudio.google.com (default AI engine) and, optionally, an Anthropic key at console.anthropic.com for premium tasks.",
    readme: "See README.md for the full setup guide.",
  },
};

export default setup;
