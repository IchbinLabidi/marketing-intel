---
name: "social-media-content-strategy"
description: "Use to plan social media content for Elios Academy, SOSProf.net or another brand: monthly calendars, content pillars, post ideas, and routing each idea to the carousel, video or tutorial workflow."
---

# Social media content strategy (all brands)

This is the entry point for planning content. It decides **what** to publish, for **which brand**, in **which format**, and then hands each piece to the right production workflow. It doesn't design or render anything itself.

## 0. Lock the brand first
Ask "Which brand is this for?" unless the request already names it. One plan covers one brand. Never mix names, logos, colours, websites, tone or audiences between brands.

| Brand | Audience | Tone | Colours | Website |
|---|---|---|---|---|
| Elios Academy | students 15–19 (exam prep), and their parents | premium EdTech, energetic, motivating | navy #23356e, orange #f49e1f, green #7ba25b | www.eliosacademy.com |
| SOSProf.net | parents booking tutoring, students, teachers | clean, reassuring, service | blue #004ABD, yellow #FEB00C, white | sosprof.net (app.sosprof.net) |
| Formatic Academy / future brands | from the brand's own brief | from the brand's own brief | measured from the official logo | verified only |

For a new brand, collect the audience, offer, official logo and website before planning. Never invent them.

## 1. Brief (infer what you can, ask only what changes the plan)
- Objective: awareness, bookings/sign-ups, engagement, education, recruitment (teachers), or an announcement.
- Period and cadence: for example 4 weeks, 3–5 posts a week. Treat any cadence as a suggestion, not a promise of results.
- Platforms: Facebook, Instagram, TikTok, YouTube Shorts.
- Real material available: platform features, lessons, teachers who agreed to appear, offers with verified prices and dates.
- Language: Tunisian Derja in Arabic script by default, with French terms kept as used in Tunisian education.

## 2. Content pillars (pick 3–5 per brand; SOSProf.net always uses its six)
- **Elios Academy:** exam method and tips, subject capsules (maths, physics, SVT…), parents' guides, student motivation, offers and enrolment.
- **SOSProf.net:** the six permanent pillars of its two-sided marketplace (students & parents demand, teachers supply), with their 25/20/20/15/10/10 allocation, KPIs, idea template, 100-point priority score, backlog fields and calendar rules. Read `references/sosprof-six-pillars.md` for every SOSProf.net plan, idea list, calendar, backlog or analytics request. That file applies to SOSProf.net only.
- Rotate the pillars across the weeks. Each post carries one message only.

## 3. Choose the format, then route to the workflow

| Content need | Format | Workflow (skill) |
|---|---|---|
| Teach a concept, a guide or a comparison in slides | Carousel 4:5 (3–10 slides) | `premium-education-carousel-designer` |
| Awareness / viral / promo ad | Short video **15–30 s** | `human-voiceover-video-production` (pick a style from its 10-style library) |
| Show how a platform feature works | Tutorial video **30–60 s** from real screens | `platform-tutorial-video-tunisian-voiceover` (style 5 of the hub) |
| One formula or exercise explained | Capsule video | `educational-capsule-video` |
| The user filmed themselves talking | Premium Reel edit | `premium-educational-video-editor` |
| Lesson that should show history/science visuals | Mini-documentary | `educational-documentary-video` |
| Long recorded lesson to tighten | Lesson edit | `educational-smart-cuts` |

The global video rules from `human-voiceover-video-production` apply to every video idea in the plan:
- Awareness and promo videos are 15–30 s. Tutorials and explainers are 30–60 s.
- Never AI voiceover. Each narrated video idea gets a Tunisian Derja recording script first; the user records it; voice, subtitles and visuals are synced afterwards.
- Higgsfield MCP for suitable generated shots (characters, cinematic scenes), always with sound off. Real UI comes from real screenshots.

## 4. Deliverable: the content plan
Deliver a calendar (a doc or an xlsx when asked) with one row per post:

| Date | Platform | Pillar | Format and duration | Hook (first line / first 2 s) | One message | CTA | Workflow | Assets needed | Status |
|---|---|---|---|---|---|---|---|---|---|

Add:
- 2–3 hook variants for the posts that matter most.
- For each narrated video, the line "Recording script: to write before production" so nothing is produced with a synthetic voice.
- A short list of what the user must supply (recordings, teacher consent, verified prices, logos).
- Metrics to watch per objective (reach and 3-second views for awareness, saves and shares for carousels, link clicks and sign-ups for bookings). Never predict numbers.
- SOSProf.net only: add the pillar column (01–06), the audience side and the content ID for each row, describe each idea with the template in `references/sosprof-six-pillars.md`, and check the month against the pillar allocation.

## 5. Rules
- Never invent statistics, results, testimonials, ratings, prices, teachers or features. Never guarantee grades or income.
- Ask before featuring named real people in paid ads. Blur private user data in screenshots.
- Seasonality for Tunisia: rentrée (September), first-term exams (December), mid-year (March), Bac revision (April–June), Bac results (July). Use it, but check exact dates with the user.
- Keep each brand's plan in its own file and folder, for example `/mnt/project-files/<brand>-content-plan-<month>/`.
- After the user approves a row, run its workflow skill. Don't start production of several pieces at once without saying so.