# Architecture — Marketing Intelligence Platform

> Phase 1 deliverable. Product architecture, MVP scope, data model and key technical decisions.
> Progress tracking lives in [`PROGRESS.md`](../PROGRESS.md).

## 1. Product thesis

Marketers don't lack ideas; they lack **evidence-backed reasons** to choose one idea over another.
The platform turns three inputs into one output:

```
Strategy (what we want)  ─┐
History  (what we did)   ─┼─►  Opportunity engine  ─►  Editorial calendar  ─►  Production workflow
Competitors (what others do) ┘        (why)                (when / where)          (who / status)
```

Every AI output is **traceable**: it cites which strategy element, historical item or competitor
observation it relies on, and is labelled as one of:

| Label | Meaning |
|---|---|
| `data_supported` | Grounded in imported rows (history / competitor content) the user can inspect |
| `hypothesis` | Reasoned from strategy + patterns, but not proven by data |
| `experiment` | Deliberately novel creative bet |

Hard rules baked into prompts *and* data model:
- A planned historical item is **not** a published item. `publication_status` is imported, never inferred.
- No performance claims without performance columns. Metrics fields are nullable and the AI is told when they are empty.
- No fabricated competitor metrics. Every competitor content row has a `source` (`manual`, `csv`, `meta_api`, `youtube_api`, …).

## 2. Stack and why

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16 (App Router) + TypeScript** | Server Components + Server Actions = one codebase, secure server-only code paths for AI keys and DB service roles. |
| UI | **Tailwind CSS v4 + shadcn/ui (Radix)** | Owned component source (no lock-in), accessible primitives, easy to make it look like Linear rather than a template. |
| DB / Auth / Files | **Supabase** (Postgres, Auth, Storage) | Postgres with Row Level Security gives real multi-tenant isolation at the DB layer; Auth and private Storage buckets included. |
| AI | **Anthropic Claude API** (`@anthropic-ai/sdk`), server-side only | Strong long-context analysis (whole calendars in one prompt), native PDF input, structured outputs validated with Zod. Behind a small provider module so another model can be swapped in. |
| Validation | **Zod** | One schema shared by forms, server actions and AI structured outputs. |
| Parsing | `papaparse` (CSV), `exceljs` (XLSX), Claude PDF input (PDF) | PDF calendars are visual tables; LLM extraction is more robust than text heuristics. Extraction always lands in a **preview** step before import. |
| Calendar DnD | `@dnd-kit` | Accessible, headless drag and drop. |
| Hosting | Vercel (app) + Supabase Cloud (data) | Zero-ops for an MVP; both have free tiers. |

Alternatives considered: Prisma/Drizzle ORM (rejected for MVP: RLS-first Supabase client is simpler and keeps authorization in the DB), separate backend service (unnecessary until long-running jobs need a queue — see §7).

## 3. Code organisation

```
src/
  app/                    Routes only (thin). Server components fetch via services.
    (auth)/               login, signup, auth callback
    (app)/                authenticated shell with sidebar
      dashboard/ projects/ [projectId]/strategy|history|competitors|opportunities|calendar|production|analytics
      settings/
  components/
    ui/                   shadcn/ui primitives (button, card, dialog, …)
    app/                  app-level composites (sidebar, page header, empty state)
    <feature>/            feature components (strategy/, history/, …)
  lib/
    supabase/             browser/server/proxy clients
    validation/           Zod schemas (shared by forms, actions, AI)
    utils.ts
  server/                 *server-only* business logic
    services/             DB access per domain (projects, strategy, …) — UI never queries tables directly
    actions/              Server Actions (validate → authorize → service → revalidate)
    ai/                   Claude client, prompts, structured output schemas
    imports/              CSV/XLSX/PDF extractors + column-mapping logic
  types/database.ts       DB row types
supabase/migrations/      SQL schema + RLS policies (source of truth)
```

Rule: **routes → actions → services → DB**. Prompts and parsers have no React imports and are unit-tested.

## 4. Multi-tenancy and permissions

- `workspaces` own everything. A user can belong to many workspaces (agency use case).
- `workspace_members.role` ∈ `owner | admin | editor | viewer`.
  - viewer: read everything in the workspace
  - editor: create/edit projects content, run AI
  - admin: + manage members, delete projects
  - owner: + delete workspace, billing (later)
- Every project-scoped table carries `project_id`; RLS policies resolve `project → workspace → membership`
  through `security definer` helper functions (`is_workspace_member`, `has_workspace_role`, `project_workspace`).
- The browser only ever uses the **anon key + user session**; RLS is the authorization boundary.
  The **service-role key is not used by the app** in the MVP.

## 5. Data model (summary)

Full DDL: [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).

```
workspaces ─< workspace_members >─ auth.users ── profiles
    │
    └─< projects ──1 brand_profiles
           │──1 strategies
           │──< personas, content_pillars, campaigns, kpis, project_channels
           │──< import_jobs ─< historical_content_items
           │──< competitors ─< competitor_channels
           │        └─< competitor_content_items
           │──< analysis_reports            (historical | competitor | comparison)
           │──< opportunities               (score, confidence, evidence, insight_type)
           │──< editorial_calendars ─< content_items ─< content_assets
           └─< ai_runs                      (audit: model, tokens, status, error)
```

Design notes:
- **Strategy is structured, not a blob.** Pillars, personas, campaigns and KPIs are rows so calendar items
  and opportunities can reference them by id (balance checks, filters, analytics).
- **Imports are staged.** `import_jobs` stores raw extracted rows + column mapping + validation errors;
  rows are only written to `historical_content_items` on confirmation. Re-importing is safe (job-level delete cascades).
- **`content_items.status`** is a Postgres enum matching the production workflow:
  `idea → planned → brief_ready → in_production → in_review → approved → scheduled → published`.
- **Languages:** `content_language` enum `fr | en | ar | ar_tn` (Tunisian Arabic / Derja) on projects (default) and items/assets.
- `ai_runs` records every model call for cost tracking and debugging; never stores API keys.
- **Calendar time** (migration `0005`): each project has an IANA `timezone`. A post stores its wall-clock
  `scheduled_date` / `scheduled_time` in that zone plus the absolute `scheduled_at` (timestamptz, only when a time is set).
  Range queries use `scheduled_at` for timed posts and `scheduled_date` for date-only posts; changing the project zone
  keeps the instants and recomputes the wall-clock columns. Conversions live in `src/lib/calendar/time.ts` (Intl, DST-safe).
- **Workflow states** shown in the calendar group the enum: idea/planned/brief_ready/in_production → Draft,
  in_review → Pending approval, approved, scheduled, published, failed. "Scheduled" is an internal booking: the Meta
  connection is read-only, so `published` is set only by a person confirming it (with date/time and optional link).
- **Opportunities = signals → AI → score.** `buildSignals` turns real rows into numbered facts (statement, method,
  period, n, lift/gap, post ids). The model only picks which signals an idea builds on and rates four judgment
  dimensions; code computes historical performance and content gap from the cited signals, the evidence class,
  confidence and the weighted score (`src/lib/opportunities/scoring.ts`). Evidence is stored as a snapshot on the row,
  so "View evidence" shows exactly what the idea was based on. A calendar post links back via `content_items.opportunity_id`
  and drives the opportunity's status.
- **Reach quality.** Meta returns truncated reach for older posts; `usableReach` ignores reach below a post's own
  interactions or under 10% of the platform's median reach over its latest 12 months. Platforms where usable reach
  covers under half the posts are ranked on interactions instead of engagement rate.
- The calendar page loads only aggregate history columns (`PERFORMANCE_COLUMNS`) and streams the insights panel, so
  navigation and drag-and-drop don't wait on the full Historical Intelligence analysis.

## 6. MVP scope

**In the MVP**
1. Auth (email + password, magic link optional), workspace auto-created on signup, invite members by email (Phase 4b).
2. Projects CRUD with brand identity, audience, products, channels.
3. Strategy builder: all sections editable; AI "suggest / improve" per section.
4. Historical import: CSV/XLSX/PDF → preview → mapping → validation → import → AI analysis report; year-vs-year comparison.
5. Competitors: CRUD + channels; content via **manual entry and CSV import**; AI analysis. API connectors behind a feature flag when credentials exist.
6. Opportunity engine: generate, score, save/dismiss, push to calendar.
7. Calendar generator: period + frequency + platforms + capacity → items; month/week/day views, drag to reschedule, filters, edit, regenerate one item (built in Phase 7a).
8. Content production: per-item generation of caption/script/carousel/stories/brief/hashtags in fr/en/ar/ar_tn; status board, assignee, due dates.
9. Analytics (MVP = strategic analytics only): pillar/funnel/platform balance of planned vs. historical content, workflow throughput. No engagement metrics until a real data source is connected.

**Explicitly not in the MVP**
- Auto-publishing to social networks, scraping, billing, SSO, real-time collaboration cursors, mobile app.

## 7. Scaling path

- Long AI jobs (large calendars, PDF extraction) start as streamed server actions. When they exceed serverless limits,
  move to a job queue (Inngest or Supabase Queues) with `ai_runs.status` as the progress record — the schema already supports it.
- Social connectors implement one interface (`fetchRecentContent(channel) → CompetitorContentInput[]`) so Meta Graph,
  YouTube Data API, LinkedIn, TikTok Research API can be added independently.
- Billing: Stripe on `workspaces` (plan, seats, AI credit quota from `ai_runs`).

## 8. Configuration you must provide

| Variable | Where to get it | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API | All DB/auth calls |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key) | same page | Browser + server client (RLS applies) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | All AI features (server only) |
| `ANTHROPIC_MODEL` (optional) | — | Defaults to `claude-opus-5-5` |

Then run the migration in `supabase/migrations/` (SQL editor or `supabase db push`). Without these values the app
shows a clear "not configured" screen instead of pretending to work.

## 9. Roadmap

| Phase | Content | Status |
|---|---|---|
| 1 | Architecture, MVP, schema, roadmap | ✅ |
| 2 | Project initialisation | ✅ |
| 3 | Design system + app shell | ✅ |
| 4 | Auth, workspaces, projects, strategy builder | ✅ (members invite pending) |
| 5 | Historical intelligence (import + analysis + compare + recommendations + calendar from insights) | ✅ |
| 6 | Competitor intelligence | — |
| 7 | Opportunity engine + calendar generator + content production | — |
| 8 | Testing & hardening | — |
