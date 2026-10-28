# Social media integrations

Each project connects its own accounts on **Project → Integrations**. Access is read-only, and authorization always goes through the provider's own sign-in (OAuth). Users never enter a social media password in the app. Tokens are encrypted with AES-256-GCM on the server and stored in tables that browsers can't read. They are never sent to the client and never logged.

| Provider | What connects | How | Status in this codebase |
|---|---|---|---|
| Meta | One Facebook Page and its linked Instagram professional account per project | Facebook Login for Business (OAuth) | Live (since migration 0003) |
| YouTube | Several channels per project | Public data with `YOUTUBE_API_KEY`, or Google OAuth for full data | Public mode works with the existing key. Full mode needs an OAuth client. |
| LinkedIn | Company pages the member administers | OAuth (Community Management API) | Implemented. Needs an approved LinkedIn app. |
| TikTok | One account per authorization (connect again to add more) | Login Kit + Display API (OAuth) | Implemented. Needs an approved TikTok app. |

## Server settings

| Variable | Used for |
|---|---|
| `YOUTUBE_API_KEY` | YouTube public data (already set) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | YouTube full access (watch time, shares, subscribers gained) |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn pages |
| `LINKEDIN_API_VERSION` (optional, `YYYYMM`) | LinkedIn REST version header (default `202509`; LinkedIn retires versions after about a year) |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` (optional) | Token encryption. Falls back to `META_TOKEN_ENCRYPTION_KEY`. |
| `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | Daily background sync (`/api/cron/social-sync`, 04:30 UTC). Without them, accounts refresh when an editor opens the Integrations page and the data is more than a day old, or with **Sync now**. |
| `<PROVIDER>_SCOPES`, `<PROVIDER>_REDIRECT_URI` (optional) | Override the scopes or the redirect URI |

Redirect URIs to register with each provider (replace `APP_URL` with the deployed URL, e.g. `https://marketing-intel-alpha.vercel.app`):

- YouTube (Google): `APP_URL/api/integrations/youtube/callback`
- LinkedIn: `APP_URL/api/integrations/linkedin/callback`
- TikTok: `APP_URL/api/integrations/tiktok/callback`

## Developer apps, permissions and eligibility

### YouTube
1. In console.cloud.google.com, enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Under Credentials, create an **OAuth client ID** of type Web application and add the redirect URI above.
3. On the OAuth consent screen, add the scopes `youtube.readonly` and `yt-analytics.readonly`. Until Google verifies the app, only listed test users can connect.
4. The person connecting must own or manage the channel.

### LinkedIn
1. At linkedin.com/developers, create an app and verify it with the company page.
2. Request the **Community Management API** product. LinkedIn reviews the request, and access isn't automatic.
3. Add the redirect URI. The scopes are `r_organization_admin` and `r_organization_social`.
4. The member connecting must be an **administrator** of the page. Personal profiles can't be analysed.
5. Access tokens last 60 days. Refresh tokens are issued only to apps LinkedIn enables for them; otherwise the page shows **Needs attention** and asks to reconnect.

### TikTok
1. At developers.tiktok.com, create an app and add **Login Kit** and **Display API** (Web).
2. Add the scopes `user.info.basic`, `user.info.profile`, `user.info.stats` and `video.list`, plus the redirect URI.
3. Submit the app for review. Until it's approved, only sandbox test accounts can connect.

### Meta
This is unchanged. See the requirements on the Integrations card: Facebook Login for Business, App Review for the listed permissions, and an Instagram Business or Creator account linked to the Page.

## Data model (migration 0015)

- `social_connections` holds one row per connected account: provider, account id and name, status, granted and declined scopes, followers, sync state. Each (project, provider, account) is unique.
- `social_tokens` holds encrypted access and refresh tokens. RLS is on with no policies, so tokens are only reachable through security-definer functions that check `intelligence.edit`.
- `social_account_snapshots` stores daily followers and channel totals, which give audience growth. There is one row per account per day.
- `social_sync_runs` logs each sync with its status, counts and errors. A unique partial index allows only one running sync per account.
- Posts and videos go into `historical_content_items`, keyed on `(project_id, source, external_id)`, so repeated syncs update rows instead of duplicating them. A sync never overwrites the fields the team edits (pillar, funnel stage, campaign). New columns: `social_connection_id`, `watch_time_minutes`.

## Sync

- **First sync:** the full history, up to 1,000 posts (`SOCIAL_SYNC_MAX_POSTS`).
- **Later syncs:** new posts plus everything published in the last 30 days, because recent counters still move.
- **Retries:** temporary failures (HTTP 429, 5xx, network) are retried with exponential backoff and `Retry-After`.
- **Expired or revoked access:** the account is marked **Needs attention** and posts already imported stay.
- **Missing permission:** the account is marked **Permission denied**.
- **Disconnect:** the token is revoked with the provider (when it's the last account using it) and deleted here. Imported posts are kept unless the user deletes them.

## Metrics per provider

| | Meta | YouTube public | YouTube full | LinkedIn | TikTok |
|---|---|---|---|---|---|
| Views | ✓ (where allowed) | ✓ | ✓ | – | ✓ |
| Reach / unique impressions | ✓ | – | – | ✓ | – |
| Impressions | ✓ (where allowed) | – | – | ✓ | – |
| Likes, comments | ✓ | ✓ | ✓ | ✓ | ✓ |
| Shares | ✓ | – | ✓ | ✓ | ✓ |
| Saves | Instagram | – | – | – | – |
| Clicks | – | – | – | ✓ | – |
| Watch time | – | – | ✓ | – | – |
| Followers (daily) | – | ✓ if public | ✓ if public | ✓ | ✓ |

A dash means the API doesn't provide the metric. The app shows "Not available" for it, never zero. All figures are organic, and paid advertising results are not imported.
