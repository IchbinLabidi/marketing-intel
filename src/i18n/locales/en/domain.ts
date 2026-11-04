// Labels for the app's fixed vocabularies (database enums). Keys are the stored values, never translated.
const domain = {
  platform: {
    instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", x: "X",
    pinterest: "Pinterest", snapchat: "Snapchat", threads: "Threads", blog: "Blog", newsletter: "Newsletter", other: "Other",
  },
  funnel: { awareness: "Awareness", engagement: "Engagement", trust: "Trust", acquisition: "Acquisition", conversion: "Conversion", loyalty: "Loyalty" },
  language: { fr: "French", en: "English", ar: "Arabic (MSA)", ar_tn: "Tunisian Arabic (Derja)" },
  contentStatus: {
    idea: "Idea", planned: "Planned", brief_ready: "Brief ready", in_production: "In production",
    in_review: "In review", approved: "Approved", scheduled: "Scheduled", published: "Published", failed: "Failed",
  },
  workflow: { draft: "Draft", pending: "Pending approval", approved: "Approved", scheduled: "Scheduled", published: "Published", failed: "Failed" },
  metric: {
    views: "Views", impressions: "Impressions", reach: "Reach", engagements: "Engagements", clicks: "Clicks", likes: "Likes", comments: "Comments",
    shares: "Shares", saves: "Saves", video_views: "Video views", leads: "Leads", subscriptions: "Subscriptions", conversions: "Conversions",
  },
  insight: { data_supported: "Historical fact", hypothesis: "AI hypothesis", experiment: "Suggested experiment" },
  role: { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" },
  audience: { student: "Student", parent: "Parent", teacher: "Teacher" },
  audienceInitial: { student: "S", parent: "P", teacher: "T" },
  segment: { students: "Students", parents: "Parents", teachers: "Teachers", both: "Both / General" },
  side: { students_parents: "Students & Parents", teachers: "Teachers", both: "Both audiences" },
  conversion: {
    forum_participation: "Forum participation",
    teacher_profile_visits: "Teacher profile visits",
    lesson_requests: "Lesson requests",
    completed_bookings: "Completed bookings",
    teacher_registration: "Teacher registration",
    profile_completion: "Profile completion",
    teacher_activation: "Teacher activation",
    lesson_requests_received: "Lesson requests received",
    completed_sessions: "Completed teaching sessions",
  },
  taskType: { copywriting: "Copywriting", design: "Design", video: "Video editing", seo: "SEO", approval: "Approval", other: "Other" },
  taskStatus: {
    backlog: "Backlog", assigned: "Assigned", in_progress: "In progress", in_review: "In review",
    changes_requested: "Changes requested", approved: "Approved", completed: "Completed",
  },
  priority: { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" },
  permissionGroup: { workspace: "Workspace", modules: "Modules", content: "Ideas, briefs and content" },
  permission: {
    team: { manage: "Manage members and invitations" },
    roles: { manage: "Create and edit roles" },
    settings: { manage: "Workspace settings" },
    projects: { manage: "Create and edit projects" },
    ai_usage: { view: "View AI usage and costs" },
    strategy: { view: "View strategy and brand", edit: "Edit strategy and brand" },
    intelligence: { view: "View content history and competitors", edit: "Import, sync and manage competitors" },
    seo: { view: "View SERP research and SEO briefs", edit: "Run SERP analyses and write briefs" },
    opportunities: { view: "View content opportunities", edit: "Generate and manage opportunities" },
    calendar: { view: "View the editorial calendar", edit: "Plan and schedule the calendar" },
    content: { view_all: "See all content (not only assigned)", create: "Create ideas and briefs", edit_any: "Edit any content", assign: "Assign tasks and collaborators", review: "Internal review", approve: "Final approval", approve_own: "Approve own work", delete: "Delete content", export: "Export content" },
  },
};

export default domain;
