# Meta (Facebook + Instagram) setup

Historical Intelligence reads your Facebook Page posts and your Instagram Business/Creator media with the
official **Meta Graph API** (version set by `META_GRAPH_VERSION`, default `v26.0`). Access is **read-only**:
the app never publishes, comments or changes anything on your accounts.

## 1. Accounts you need

- A **Facebook Page** you manage with a role that includes **Analyze** (Admin, Editor, Moderator, Advertiser or Analyst).
  Page post insights require the Page to have **100+ likes**; below that Meta returns no insights (posts still sync).
- Optional: an **Instagram professional account** (Business or Creator) **linked to that Page**
  (Meta Business Suite → Settings → Accounts → Instagram accounts). Personal Instagram accounts can't be read by any API.

## 2. Create the Meta app

1. Go to <https://developers.facebook.com/apps> → **Create app**.
2. Use case: **Other** → app type **Business** (required for Page and Instagram insights).
3. Add the products:
   - **Facebook Login for Business** (or *Facebook Login*).
   - **Instagram** → *API setup with Facebook login* (Instagram Graph API through the Page).
4. **Facebook Login → Settings**:
   - *Valid OAuth Redirect URIs*: `http://localhost:3000/api/meta/callback` for development, plus
     `https://YOUR-DOMAIN/api/meta/callback` for production (must match `META_REDIRECT_URI` / `APP_URL` exactly).
   - *Client OAuth login* and *Web OAuth login*: **on**. *Enforce HTTPS*: on (localhost is allowed in development mode).
5. **App settings → Basic**: copy the **App ID** and **App secret**; fill *Privacy Policy URL*, *Terms URL*, *App icon*, *Category*.
   - *Data deletion*: choose **Data deletion callback URL** → `https://YOUR-DOMAIN/api/meta/data-deletion`.
   - *Deauthorize callback URL* (Facebook Login → Settings): `https://YOUR-DOMAIN/api/meta/deauthorize`.
6. Optional, **Facebook Login for Business → Configurations**: create a configuration with the permissions below and
   put its id in `META_LOGIN_CONFIG_ID` (the app then sends `config_id` instead of `scope`).

## 3. Permissions requested

| Permission | Why |
|---|---|
| `pages_show_list` | list the Pages you manage so you can pick one |
| `pages_read_engagement` | read Page posts, reactions, comments and shares |
| `pages_read_user_content` | Meta requires it together with `pages_read_engagement` to list a Page's posts |
| `read_insights` | Page post insights (media views, viewers, clicks, video views) |
| `instagram_basic` | the linked Instagram account and its media (caption, type, permalink, likes, comments) |
| `instagram_manage_insights` | Instagram media insights (views, reach, saved, shares, total interactions) |
| `business_management` | Pages and Instagram accounts owned through a Business portfolio |

**Apps created with the use-case dashboard** only accept permissions that belong to a use case added to the app.
If Facebook shows *"Invalid Scopes: read_insights, instagram_basic, instagram_manage_insights"*, open
**App dashboard → Use cases** and:
- add (or open) **"Manage everything on your Page"** → **Customize** → add `read_insights` and `pages_read_user_content`
  (with `pages_show_list`, `pages_read_engagement`, `business_management`);
- add **"Manage messaging & content on Instagram"** (Instagram API, *with Facebook login*) → **Customize** → add
  `instagram_basic` and `instagram_manage_insights`.
Save, then try **Connect Meta** again. `META_SCOPES` (comma-separated) can override the requested list if needed.

No publishing, messaging or ads permission is requested. If you have a Business Manager role on the Page and Meta
asks for it, `ads_read` may additionally be needed for some Instagram insights.

## 4. Environment variables (server only — never `NEXT_PUBLIC_`)

```
META_APP_ID=                       # App settings → Basic
META_APP_SECRET=                   # App settings → Basic (keep secret)
META_TOKEN_ENCRYPTION_KEY=         # random 32+ chars, e.g. `openssl rand -base64 48`; encrypts tokens at rest
APP_URL=http://localhost:3000      # public base URL of the app
# META_REDIRECT_URI=               # optional, defaults to $APP_URL/api/meta/callback
# META_LOGIN_CONFIG_ID=            # optional, Facebook Login for Business configuration id
# META_GRAPH_VERSION=v26.0         # optional
# META_SYNC_MAX_POSTS=1000         # optional, posts listed per platform per run (backfill continues next run)

# Scheduled sync and Meta callbacks (no user session):
SUPABASE_SERVICE_ROLE_KEY=         # Supabase → Project Settings → API keys → secret/service_role. Server only.
CRON_SECRET=                       # random 32+ chars; the scheduler sends `Authorization: Bearer $CRON_SECRET`
```

Changing `META_TOKEN_ENCRYPTION_KEY` makes stored tokens unreadable: everyone must reconnect Meta.

Without `SUPABASE_SERVICE_ROLE_KEY`/`CRON_SECRET` everything works except the nightly job and the Meta
deauthorize/data-deletion callbacks; automatic sync then runs when an editor opens Historical Intelligence and the last
sync is older than 24 h.

## 5. Database

Run `supabase/migrations/0003_meta_integration.sql` (after 0001 and 0002) in the Supabase SQL editor.

## 6. Development testing (before App Review)

While the app is in **Development mode**, only people with a role on the app can log in:
App roles → add yourself (and testers) as **Administrator / Developer / Tester**. Testers must accept the invitation.
All permissions above work for these people without App Review, on Pages they manage.

Then: project → **Historical Intelligence** → **Connect Meta** → choose the Page → the first sync starts.
Use **Sync now** for new posts and **Refresh all metrics** to re-read metrics of every synced post.

Scheduler: on Vercel, `vercel.json` already declares a daily cron on `/api/cron/meta-sync` and Vercel sends
`CRON_SECRET` automatically. Elsewhere, call it daily:
`curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/meta-sync`.

## 7. App Review (required to serve users who have no role on the app)

1. **Business verification** of your company (App settings → Basic → Verification).
2. Request **Advanced Access** for each permission in §3 (App Review → Permissions and Features), with:
   - a screencast showing: login → Page selection → synced posts and metrics in Historical Intelligence → disconnect;
   - a written use case per permission (read-only analytics of the user's own Page/Instagram content);
   - test credentials or instructions for the reviewer.
3. Privacy Policy that describes the Facebook/Instagram data you store and how users delete it (Disconnect → "also delete
   synced posts", or the data deletion callback).
4. Switch the app to **Live** mode after approval.

## 8. Production checklist

- `APP_URL` and the Valid OAuth Redirect URI use your HTTPS domain.
- Data deletion and deauthorize callback URLs point at the production domain and `SUPABASE_SERVICE_ROLE_KEY` is set.
- `META_APP_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` are stored only in the
  hosting provider's secret environment variables.
- In the Meta app: *Require App Secret* (Settings → Advanced) can be turned on; every call sends `appsecret_proof`.

## What is and isn't retrieved

- **Facebook Page posts**: message, date, permalink, attachment type, reactions, comments, shares; insights
  `post_media_view`, `post_total_media_view_unique`, `post_clicks`, `post_video_views` (videos) when Meta returns them.
- **Instagram media** (feed, carousels, reels): caption, type, permalink, date, likes, comments; insights `views`, `reach`,
  `likes`, `comments`, `shares`, `saved`, `total_interactions`.
- Metrics Meta rejects for an account are learned on the first sync and listed under the connection; they are never estimated.
- Stories (24 h) and ads are not imported. Legacy `impressions`/`plays` are not requested (deprecated by Meta).
