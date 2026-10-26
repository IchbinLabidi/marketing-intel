# Signal — AI Marketing Intelligence Platform

Turns a brand's marketing strategy, past editorial calendars and competitor observations into a performance-driven
editorial calendar. Built for marketing teams and agencies managing several brands.

> "Signal" is a working name — change it in `src/config/site.ts`.

- Architecture, MVP scope and data model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What's done and what's next: [`PROGRESS.md`](PROGRESS.md)

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS v4 · shadcn/ui-style components on Radix ·
Supabase (Postgres + Row Level Security, Auth, Storage) · Anthropic Claude API (server-side only) · Zod.

## Setup (about 10 minutes)

1. **Install**: Node 20+ and pnpm, then `pnpm install`.
2. **Supabase**: create a free project at [supabase.com](https://supabase.com).
   - SQL Editor → paste and run `supabase/migrations/0001_init.sql`.
   - Authentication → URL Configuration → add `http://localhost:3000/auth/callback` (and your production URL) to redirect URLs.
   - Optional for local testing: Authentication → Providers → Email → turn off "Confirm email".
3. **Environment**: `cp .env.example .env.local` and fill in:
   | Variable | Where |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page (anon / publishable key) |
   | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
4. **Meta (Facebook + Instagram)**, for Historical Intelligence: create a Meta app and add `META_APP_ID`, `META_APP_SECRET`,
   `META_TOKEN_ENCRYPTION_KEY` and `APP_URL`, then run `supabase/migrations/0002_*.sql` and `0003_*.sql`.
   Step-by-step guide: [`docs/META_SETUP.md`](docs/META_SETUP.md). Without Meta, history can still be imported from files.
5. **Run**: `pnpm dev` → http://localhost:3000. Sign up; a workspace is created for you.

Without Supabase variables the app shows a setup screen. Without `ANTHROPIC_API_KEY` everything works except AI
buttons, which are disabled with an explanation. Nothing is faked.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build && pnpm start` | Production build |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm test` | Unit tests (validation, AI prompt/schema layer) |
| `node e2e/smoke.cjs` | Browser smoke test against a running app (needs a fresh DB) |
| `psql -f supabase/tests/local_stub.sql -f supabase/migrations/0001_init.sql -f supabase/tests/rls_test.sql` | Row Level Security isolation test on plain Postgres |

## Deploy

Vercel: import the repo, add the three environment variables, deploy. Add the production `/auth/callback` URL in Supabase.

## Project layout

```
src/app            routes (thin): (auth) login/signup, (app) dashboard/projects/p/[projectId]/…/settings
src/components     ui/ primitives, app/ shell, feature folders
src/lib            supabase clients, domain constants, Zod validation
src/server         services (DB access), actions (Server Actions), ai (Claude client, prompts, schemas)
supabase           migrations (schema + RLS) and SQL tests
```
