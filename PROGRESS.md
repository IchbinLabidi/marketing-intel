# Progress

Legend: ✅ done · 🟡 partial · ⬜ not started

## Phase 1 — Product architecture ✅
- ✅ Architecture, stack decisions, MVP scope, roadmap (`docs/ARCHITECTURE.md`)
- ✅ Full database schema for all modules with Row Level Security (`supabase/migrations/0001_init.sql`)
- ✅ RLS isolation test: users can't read or write other workspaces; viewers can't write

## Phase 2 — Project initialisation ✅
- ✅ Next.js 16 + TypeScript + Tailwind v4, ESLint, Vitest
- ✅ Supabase SSR auth wiring (proxy session refresh, server/browser clients)
- ✅ Explicit "not configured" states for Supabase and AI

## Phase 3 — Design system ✅
- ✅ Theme tokens (light + dark ready), Geist font
- ✅ Primitives: button, input, textarea, select, label, card, badge, dialog, dropdown, tabs, avatar, skeleton, toasts
- ✅ App shell: sidebar with workspace switcher, project switcher, module navigation, mobile drawer
- ✅ Shared patterns: page header, empty state, form field, submit button, action toasts, forms that keep input on errors

## Phase 4 — Core application 🟡
- ✅ Sign up / sign in / sign out, email confirmation callback
- ✅ Personal workspace auto-created on signup; create, rename and switch workspaces
- ✅ Roles (owner, admin, editor, viewer) enforced in the UI, Server Actions and RLS
- ✅ Projects: create, edit, archive/restore, delete (admin, typed confirmation)
- ✅ Brand identity (mission, vision, values, audience, products, differentiators, visual identity)
- ✅ Social channels with target posting rhythm
- ✅ Strategy builder: foundations, personas, customer journey, funnel, content pillars (with mix check), brand voice, campaigns, KPIs
- ✅ AI assistant per strategy section (Claude, structured output, states assumptions and questions, user reviews before saving)
- ✅ AI call logging (`ai_runs`: model, tokens, status)
- ✅ Dashboard with real strategy completeness and next step per project
- ⬜ Invite members by email (needs a server-side invite flow with the Supabase service role)
- ⬜ Profile settings (name, avatar)

## Phase 5 — Historical intelligence ✅
- ✅ Migration `0002`: historical items link to strategy `content_pillars`/`campaigns`; description, CTA, actual date; full metric set
  (impressions, reach, engagements, clicks, likes, comments, shares, saves, video views, leads, subscriptions, conversions) on
  historical items **and** `content_items`; opportunities linked to their analysis report; cross-project reference triggers
- ✅ Upload Excel (.xlsx/.xls), CSV (delimiter + Windows-1252 detection) and PDF (Claude) to the private `imports` bucket; duplicate-file warning (sha256)
- ✅ Preview → multilingual auto-mapping (fr/en/ar headers) → validation (errors block, warnings flag) → inline correction / explicit row exclusion → confirm
- ✅ Imported calendars: covered period, import date, records; edit/delete records; replace file (re-import); delete import; filters
- ✅ Deterministic analysis: volume by month/platform/format/pillar, frequency vs channel targets, low months and silences,
  pillar balance vs strategy targets, untested formats, repetition clusters (near-duplicate / fresh angle / recurring theme),
  campaign themes, seasonality on the Tunisian school year + Ramadan (only fully covered windows), metric averages only when imported
- ✅ Year-over-year: school years, calendar years or imports
- ✅ AI recommendations (Claude, strategy-aware) stored as `opportunities` with evidence, labelled fact / hypothesis / experiment
- ✅ "Generate calendar using historical insights": AI draft → review/edit → saved to `editorial_calendars`/`content_items` as planned
- ✅ Editorial Calendar page lists saved calendars and items (replaced by the full calendar in Phase 7a)

## Phase 5b — Meta integration (Historical Intelligence, Meta-first) ✅ code · ⏳ needs Meta app credentials
- ✅ Migration `0003`: `meta_connections`, `meta_tokens` (RLS with no policies + role-checked security-definer RPCs,
  AES-256-GCM encrypted), `meta_sync_runs`; synced posts stored in `historical_content_items` (`source = meta_api`,
  unique `(project_id, source, external_id)`), `views` metric, raw API metrics in `metrics_raw`, AI pillar flag
- ✅ Official Facebook Login (state cookie, server-side code exchange, long-lived token, `appsecret_proof` on every call),
  Page selection, linked Instagram professional account detection, reconnect, change Page, disconnect (± delete posts)
- ✅ Sync: initial, incremental, backfill across runs, metric refresh, batch insights (50/request), per-account learning
  of supported/rejected metrics, rate-limit and expired-token handling, sync log, Sync now / Refresh all metrics
- ✅ Automatic sync: daily `/api/cron/meta-sync` (service role + CRON_SECRET, `vercel.json`) or, without them, on page open when stale (>24 h)
- ✅ Deauthorize and data-deletion callbacks (signed_request verified) + public status page
- ✅ Performance analytics per platform (raw vs calculated): top/weakest posts, monthly trend, format, pillar, topics,
  hooks, CTAs, refresh candidates; AI pillar assignment; performance fed into recommendations and calendar generation
- ✅ Live: Elios Academy Page + @elios.academy connected and synced (1000 Facebook posts with more by backfill, 1137 Instagram)

## Phase 7a — Editorial Calendar module ✅
- ✅ Migration `0005`: `failed` status, `projects.timezone` (IANA, default Africa/Tunis), `content_items.scheduled_at`
  (timestamptz, set only when a time exists), `media_url`, `published_at`/`published_url`/`publish_error`;
  `historical_content_items.published_at` (exact Meta timestamp, filled by the next sync/refresh)
- ✅ Month / week / day views, Today, previous/next, URL-driven state (shareable, back button works), project time zone selector
- ✅ Workflow states Draft / Pending approval / Approved / Scheduled / Published / Failed (dot + icon + label, never colour alone)
- ✅ Cards: thumbnail (media URL), caption/hook preview, platform icon, time, format, state, pillar, funnel; compact in month/week
- ✅ Drag and drop (@dnd-kit, mouse + touch) to another day or hour; optimistic move persisted by `reschedulePostAction`,
  reverts on error; conflict warning within 60 min on the same platform; published posts can't move, scheduled can't go to the past
- ✅ Combined filters: platform, status, pillar (or none), funnel, campaign, plan, date range; clear filters
- ✅ Create (click a day/slot), edit, delete (in-app confirmation), duplicate (as draft), save draft, submit for approval,
  approve, schedule/reschedule, mark as published (manual confirmation with date/time/link; never automatic)
- ✅ AI generate / regenerate per post: brand voice, strategy, pillar, funnel, platform rules, real performance digest and
  best times; returns rationale + assumptions to complete; nothing saved until the user saves
- ✅ Publishing insights side panel (streams in): suggested slots, best days, pillar lifts, 6-month trend — calculated only.
  Timing ranks interactions per post (not engagement rate, which low-reach evening Facebook posts inflate);
  a slot needs ≥5 posts and ≥1% of the history
- ✅ Instagram + Facebook first; other platforms selectable as "planning only"
- ⏳ Meta auto-publishing not implemented (connection is read-only; needs `pages_manage_posts` / `instagram_content_publish` + App Review)

## Phase 7b — Content Opportunities engine ✅ code · ⏳ live AI generation (Anthropic credit exhausted)
- ✅ Migration `0006`: extends `opportunities` (score breakdown, focus, generation id, status timestamps; states
  new / in_progress / scheduled / published / dismissed, old `saved` → `in_progress`), `projects.opportunity_weights`,
  `opportunity_feedback` (RLS), cross-project guards for opportunity ↔ pillar/persona/calendar post
- ✅ Signals (`src/lib/opportunities/signals.ts`): pillar / format / topic / hook / CTA performance, timing, top and weak
  posts, refresh candidates, pillars under target or dormant 90 days, funnel and format gaps, competitor topics (only when
  competitor posts exist). Each has numbers, period, method and supporting post ids; the AI may only cite these
- ✅ Scoring (`scoring.ts`): configurable weights (default 25/20/20/15/10/10); historical and gap dimensions calculated
  from cited signals, the other four are AI ratings with reasons; neutral 50 when no performance data, differentiation
  excluded without competitor data. Evidence class and confidence decided in code (data-supported needs a real signal)
- ✅ AI: generate (count + pillar/platform/funnel focus + instruction), regenerate, refine, different angle; near-duplicate
  filter (token Jaccard ≥ 0.6) against every existing idea, dismissed included
- ✅ Dashboard: overview, "What your data shows" signals panel (streamed, generate from a signal), 8 filters, 4 sorts,
  cards (score, confidence, evidence class, hook, angle, CTA, audience, evidence), View evidence (score table, signals,
  method, period, supporting posts with metrics and links, assumptions), weights dialog
- ✅ Add to Editorial Calendar: the calendar's own editor, prefilled; one post per opportunity (UI + server check);
  status follows the post (draft → in progress, dated → added to calendar, confirmed → published, deleted → in progress)
- ✅ Feedback stored; used in the next generation prompt and to adjust relevance of similar ideas (damped, ±20 max).
  No automatic model training: outcome-based tuning is not implemented
- ✅ Fixes found while testing: truncated Meta reach before 2025 produced fake engagement rates (now filtered for every
  module); repetition analysis was quadratic (Historical Intelligence page 57–104 s → ~7 s with 3,137 posts)
- ⏳ Generation not run live: the Anthropic account has no credit (the app now says so clearly)

## Phase 7c — Content Production (built by Codex, reviewed) ✅ live (0007 + 0008 applied 2026-10-26)
- ✅ Verified live on eliosacademy: create (r1) → edit (r2) → submit → modifications requested with reason → back to
  production → internal approval → manager approval → Ready → scheduled 20 Dec 18:00 (shown in the calendar) → text
  edited from the calendar → back to In Production (approval and slot cleared) → restore revision 2 (as r11);
  comment + full activity timeline; empty-reason modification blocked; AI error message; opportunity "Create content"
  → one linked task with brief, second click opens the same task; deletion of both test items; opportunity restored
- ✅ Migration `0007`: production stages on `content_items` (idea → brief → in production → internal review → approval →
  ready → published), main content, visual direction, audience, language variants, revision, approval actor/time;
  `content_versions` (snapshot per revision), `content_activity` (stage, comments, mentions, review decisions),
  `content_templates`, private `production-media` bucket; RLS: only the assignee (or unassigned creator) and admins edit
- ✅ Database rules (triggers + security-definer RPCs `save_production`, `production_transition`, `production_comment`,
  `restore_production`): optimistic locking by revision, internal review then manager approval (configurable), any copy
  edit after approval sends content back to production, scheduling needs final approval, "published" only when matched
  to a synced Meta post, one content item per opportunity, opportunity status follows its content
- ✅ UI `/production`: board/list/review views, editor with language variants (RTL for Arabic), AI operations (generate,
  rewrite, hooks, tone, shorten/expand, CTA, hashtags, translate, adapt platform, Reel / carousel / story conversions),
  comments with mentions, history and restore, media links and uploads, templates, workflow settings
- ✅ Calendar ↔ production: approval only in production, "Schedule" after final approval, publication verified against
  the connected Meta account; opportunities → "Create content" opens a production task
- ✅ Review fixes (0008 and app): deleting an opportunity or user no longer fails on linked content; opportunity
  statuses recomputed (planned items are "in progress", not "scheduled"); history calendar generator links each
  opportunity to one item only; card shows "Open in calendar" once content exists
- ✅ Tests: `node scripts/test-production-db.mjs` (40 PostgreSQL checks on an isolated PGlite database, all migrations)

## Phase 6 — Competitor Intelligence ✅ live (migration 0009 applied 2026-10-26)
- ✅ Migration `0009`: competitors (description, industry, audience, monitoring daily/weekly/manual, history period,
  max posts, status); `competitor_channels` (project-scoped, unique profile per project, followers, bio, avatar,
  status, last error, coverage, posts collected); `competitor_content_items` (profile link, media, hashtags,
  mentions, duration, saves, raw metrics, followers at collection; trigram caption search); append-only
  `competitor_metric_snapshots` (profile + post); `competitor_sync_runs` (one running per competitor)
- ✅ Providers (`src/server/competitors/providers`): Instagram Business Discovery (Meta, live), Facebook Page public
  content (needs Meta "Page Public Content Access" App Review), YouTube Data API v3 (`YOUTUBE_API_KEY`), X API v2
  (`X_BEARER_TOKEN`, paid plan); TikTok / LinkedIn / Threads / Pinterest: no official API for other accounts → manual posts
- ✅ Collection engine: upsert on (competitor, source, external id), snapshots every run, per-profile status
  (synchronized / partial / failed / requires configuration / manual only), coverage shown; monitoring via
  `/api/cron/competitor-sync` (service role + CRON_SECRET, vercel.json) or, without them, when an editor opens the page
- ✅ Analytics (`src/lib/competitors/analysis.ts`, same method for us and them): frequency, platform/format/topic/
  hashtag/weekday distributions, hooks, CTAs, best posts and outliers by lift vs the account's own median, rate per
  follower only when followers are known, public metric coverage
- ✅ UI: competitor management (URL detection, duplicates refused), dashboard, content library (server-side filters,
  pagination, grid/list, post detail with snapshots and original link), comparison with calculated findings,
  gaps & ideas with "Create Content Opportunity" (editable, deduplicated, competitor posts kept as evidence)
- ✅ AI: competitor analysis and gap analysis + ideas (Observed vs Hypothesis enforced; ideas scored by the
  opportunity engine). ⏳ Not run live: no Anthropic credit
- ✅ Fixes found while testing: Arabic hamza split words (normalizeText now strips all combining marks), English/
  French/Derja filler words, brand names excluded from topics
- ✅ Verified live with a public Instagram business account (37 real posts, 5.4M followers, likes and comments;
  second collection: no duplicates, 2 snapshots per post); Facebook → "Requires configuration" (Meta permission error);
  YouTube → needs key; TikTok → manual only; library, compare, AI error state, mobile, 404; test data deleted

## Phase 6b — SERP Intelligence ✅ live (migration 0010 applied 2026-10-26, SerpApi key set) · ⏳ AI (no Anthropic credit)
- ✅ Migration `0010`: `serp_analyses` (keyword, country, language, Google, device, provider, status, features,
  intent, ranking-page analysis, AI analysis, fetched_at), `serp_items` (organic, featured snippet, People also ask,
  related, local, images, videos, top stories, knowledge panel, ads, shopping), `seo_briefs`; opportunities gain
  `seo` + `serp_analysis_id` and source `serp_analysis`; same-project trigger; RLS per workspace/project
- ✅ Provider (`src/server/serp/provider.ts`): SerpApi (Google, server-side key, 11 markets incl. Tunisia, fr/ar/en,
  desktop + mobile). No scraping of Google. Ranking pages are read politely (robots.txt, 10 s, 2 MB, max 8)
- ✅ Calculated, not AI: intent from SERP features + page types (keyword wording 1 pt), content types, ranking-page
  structure (words, H2/H3, FAQ, schema), shared topics, our site's position, domain table, snapshot comparison
- ✅ AI (labelled "SERP data" vs "AI recommendation", refs checked): SERP analysis, SEO opportunities into the
  Content Opportunities module, SEO content brief, article draft; "Add to Editorial Calendar" (planned, never published)
- ✅ UI: `/seo` (analyze form, keywords, ranking domains, briefs), `/seo/[analysisId]`, `/seo/briefs/[briefId]`
- ⏳ Not available: search volume, difficulty, ongoing rank tracking (snapshots are stored, so tracking can be added)
## AI provider layer — Gemini default, Claude for premium ✅ live (migration 0011 applied 2026-10-26) · ⏳ needs GEMINI_API_KEY
- ✅ One entry point for every AI feature (`runStructured` in `src/server/ai/run.ts`); provider SDK calls only in
  `src/server/ai/providers.ts` (Gemini `@google/genai` 2.28.0, Anthropic SDK). Callers unchanged
- ✅ Routing (`src/lib/ai/models.ts`): tier per feature (light / standard / premium). Defaults chosen 2026-10-26:
  light `gemini-3.1-flash-lite` (pillar classification, single posts, short edits), standard `gemini-3.8-flash`,
  premium `claude-sonnet-5-5` (SEO article drafts) with Gemini fallback. Env overrides per feature, module, tier,
  default provider/model; the other provider is used when a key is missing or rejected / out of credit
- ✅ Structured JSON on both providers (Zod → Gemini JSON Schema subset; Claude structured outputs), validated with Zod;
  retries: SDK 2 retries on 408/429/5xx, 1 retry on invalid JSON, 1 provider fallback; Claude system prompt cached,
  Gemini implicit cache tokens recorded; 400k-character prompt guard; optional `AI_MONTHLY_BUDGET_USD` per workspace
- ✅ Migration `0011`: `ai_runs` + provider, tier, cached/cache-write tokens, estimated cost, duration, attempts,
  fallback; `ai_usage_breakdown` and `ai_cost_since` (security invoker, RLS applies)
- ✅ `/ai-usage` dashboard: period filter, cost / requests / tokens, by feature (with current model), model, member,
  day, request log with errors, budget bar, current routing
- ✅ Live: migration 0011 applied and checked (8 columns, 2 invoker functions, RLS + 3 policies, 30 earlier rows set to
  anthropic); `/ai-usage` shows the 24 real requests of this month (filters, periods, log, routing, 375 px). Earlier
  rows have no cost estimate (logged before cost tracking)
- ⏳ Not run live: Gemini calls (no key yet), Claude (no credit)

## Editorial Intelligence Engine ✅ live (migration 0012 applied 2026-10-26) · ⏳ live AI (no Gemini key / Claude credit)
- ✅ Guided flow `/p/[id]/calendar/plan` → `/calendar/plan/[calendarId]`: 1–2 month, platforms, frequency, objective,
  capacity, custom dates · 3 opportunities · 4 content mix · 5 generate · 6 review / lock / regenerate · 7 approve
- ✅ Data sources (`src/lib/editorial/sources.ts`): 15 sources, available / partial / missing from real rows; missing
  data is passed to the AI as missing and posts without a signal are marked "not performance-validated"
- ✅ Content mix (`src/lib/editorial/plan.ts`, calculated): pillar target shares, strategy funnel % or the objective's
  mix (+ campaign funnel focus), formats per platform × measured lift, campaign coverage, seasons/campaign/custom
  dates, best weekdays from timing data; editable, validated (every distribution sums to the total); slots laid out
  deterministically (locked posts keep their share)
- ✅ Opportunities: shared engine (`services/opportunity-engine.ts`) with business objective, campaign, effort;
  scoring + search demand (SERP signals), campaign relevance, freshness, production effort (all data-based);
  ideas without a data signal capped at 60 (kept on re-weighting); SERP and published-result signals added
- ✅ Content per week (one AI call per week, only that week's relevant signals): topic, hook, angle, CTA, caption or
  brief, creative direction, rationale; reel (hook, script, scenes, on-screen text, CTA), carousel (cover, slides,
  final CTA), story frames, article (keyword, SEO title, meta, H1, outline); suggested times from timing data
- ✅ Repetition: exact (word overlap / same hook / caption) + close pairs judged by the light model (same angle vs
  different angle), against the calendar and 6 months of posts. Optimizer: pillars, funnel, platforms, frequency,
  campaigns, repetition, dates, workload (effort points, capacity), spacing of similar posts
- ✅ Regenerate post / week / all (locked and in-production posts kept), lock, date change (calendar rules + recheck),
  drag & drop in the Editorial Calendar, approve → posts to Content Production (Brief); nothing scheduled/published
- ✅ Feedback loop: verified published posts judged on their objective's KPI (reach, engagement rate, saves+shares,
  clicks, conversions, comments+shares) vs the platform's own median; learnings (≥2 posts) feed signals and prompts
- ✅ Cost per calendar (`ai_runs.calendar_id`), shown on the plan page; requests also appear in AI usage ("Editorial engine")
- ✅ Migration `0012`: calendars (status, objective, plan, sources, optimizer, approval), posts (locked, topic, angle,
  rationale, format_details, objective_kpi, repetition), opportunities (campaign, effort, calendar), ai_runs.calendar_id;
  same-project / same-workspace guards
- ✅ Live on eliosacademy (Nov 2026, Instagram 5 + Facebook 6 + Website 1/week): 14/15 sources available (3,223
  posts with metrics, 438 competitor posts, 1 SERP keyword, 5 pillars with targets, 1 campaign); mix from strategy
  shares and funnel %, carousels ×3.74 on Instagram, exam season + campaign dates; validation blocks unbalanced
  edits; save → step 5; AI error state (no credit) logged against the calendar; backlog add/remove; 375 px; deleted.
  Fixed while testing: mix editor kept a stale copy after "Recalculate"; "blog" shown instead of "Website / SEO"
- ⏳ Gemini key set 2026-10-26 (accepted), but gemini-3.1-flash-lite and gemini-3.8-flash answered 503 "high demand"
  for ~30 min (one request waited 5 min then failed with a headers timeout; gemini-2.5 models are closed to new
  users). Fixes: Gemini calls now stream (thought summaries keep the connection alive, 8 min hard stop); 503/529 and
  no-response timeouts are reported as "overloaded" and switch to Claude when it is available
- ✅ Overload / quota handling (`src/lib/ai/errors.ts`, unit-tested): 503/529/no answer = overloaded (retried twice,
  backoff ~2 s / ~4 s, no first chunk in 90 s = retry); 429 split into rate limit vs quota (not retried); credit,
  key, quota, rate limit, overload switch to Claude only when it has a key and isn't known to be unavailable;
  providers that failed lastingly are skipped for a while (credit 30 min, quota 15, overload 3); both unavailable →
  immediate combined message. Every call logged as one `[ai]` line (provider, model, feature, type, status, attempts,
  latency; keys redacted); request log stores `[provider:type]`. AI usage → "Run AI test" / "Retry AI test": passes
  only when the model returns valid JSON echoing a random code. Verified live 2026-10-26: Gemini 3 attempts
  overloaded (90 s silence, 503, 90 s silence), Claude no credit, panel shows both, nothing reported as working.
  Limitation: provider health is kept in server memory (per instance; reset on restart)

## Phase 7 — Opportunity engine, calendar generator, content production ⬜
## Phase 8 — Testing & hardening ⬜

## Verified
- Editorial engine: typecheck, lint, `vitest` (118 tests incl. 14 editorial + updated scoring), PGlite (66 checks incl.
  5 engine guards), production build. Not run live: migration 0012, AI generation (no Gemini key, no Claude credit)
- Phase 6b: typecheck, lint, `vitest` (SERP tests incl. AI Overview + topic labels), PGlite (57 checks incl. 6 SERP
  isolation), production build; migration 0010 applied live and checked (RLS, policies, triggers). Live on eliosacademy:
  "cours informatique bac tunisien", Tunisia, fr + ar, desktop + mobile → 4 snapshots, 8/8 ranking pages read,
  AI Overview captured, desktop/mobile and fr/ar comparisons, ranking domains, delete, AI error state, mobile 375 px.
  Fixes found: country-wide `location` made Google broaden the query (now the main city); AI Overview was dropped;
  heading topics showed folded stems; domain table counted snapshots as keywords. Not run: AI (no Anthropic credit)
- Phase 7b: typecheck, lint, `pnpm test` (69 tests), production build, migration 0006 applied; live on eliosacademy:
  59 signals from 3,137 posts, filters/sorts, View evidence, Add to calendar (prefill, status sync, delete → back in
  progress), duplicate refused server-side from a second tab, feedback + relevance, weights, AI error state, mobile,
  404 for a non-member project. Not run: AI generate/regenerate/refine (no Anthropic credit)
- Phase 7a: typecheck, lint, `pnpm test` (54 tests), production build; live on eliosacademy: month/week/day, navigation,
  filters + clear, drag to day and to hour (persisted after reload), drag conflict dialog, create/schedule, editor conflict
  "Keep both", duplicate, in-app delete confirmation, AI regenerate (not saved), mobile 375 px (no page overflow),
  `published_at` backfilled by "Refresh all metrics" (2000 Facebook + 1137 Instagram posts with exact times)
- `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (11 tests) pass
- Browser smoke test (`e2e/smoke.cjs`) passes against a local Supabase stack (GoTrue + PostgREST + Postgres 16)
- AI calls were **not** exercised live yet (no API key in the build environment); schemas and prompts are unit-tested
- Phase 5: `pnpm test` (30 tests), typecheck; live run against Supabase: XLSX import (152 rows, 2 errors fixed/excluded, 151 imported),
  analysis, compare, record edit, AI recommendations, AI calendar generation (19 items saved), PDF import (5 rows), empty / header-only /
  unsupported / duplicate files, anonymous and cross-workspace isolation (404 / empty results / storage not found)
- Test fixtures: `node e2e/fixtures/make-history-fixtures.mjs`
