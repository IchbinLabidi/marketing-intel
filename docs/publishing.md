# Publishing from the editorial calendar

## Status

| Network | Publish now | Schedule | Media sources | Status |
|---|---|---|---|---|
| Facebook Page | ✓ text, photo, video | ✓ Facebook's own scheduling (10 min to 30 days ahead) | stored file (sent as bytes), https link | Phase 1, live once publishing is enabled |
| Instagram (professional account linked to the Page) | ✓ JPEG image, Reel (MP4/MOV) | ✗ not supported by the API (publish at the time) | stored file (temporary signed link, 1 h, with consent), https link | Phase 1 |
| Google Drive (as a source) | | | | Phase 2: needs Google Cloud OAuth client + Picker API |
| YouTube, LinkedIn, TikTok | | | | Phase 3: needs each network's developer app and approvals |

## How media is handled

- **File on the computer:** it's previewed in the browser only. Nothing is uploaded until you click **Keep for publishing**. That stores the file in the project's private storage bucket (`production-media`, at most 50 MB). A file that is only selected disappears when the window closes, so it can't be used for a later publication.
- **Facebook:** the server reads the stored file and sends its bytes to Facebook (multipart upload). No link to the file is ever created.
- **Instagram:** the Content Publishing API only accepts media by URL. With your explicit consent in the dialog, a signed link valid for one hour is created for Instagram to download the file. The file is never made public.
- **External https links** attached to a post are passed as they are.

## Reliability

- Each (post, network, account) has a single row in `content_publications` (status, platform post id, link, error, attempts). A second click, or a retry after success, can't publish twice.
- Instagram videos are processed asynchronously. If processing takes longer than about 90 seconds, the status stays **Processing** and **Check again** finishes the publication.
- Errors are classified as follows:
  - **auth** (expired token, missing permission) and **validation** (format, length): never retried automatically.
  - **transient** (rate limit, Meta outage): get a suggested next attempt time.
- Hosting limit: Vercel Hobby runs cron jobs once a day. Exact-time publishing therefore uses Facebook's native scheduling. A general scheduler for the other networks needs a frequent job runner (Phase 3).

## Enabling Facebook and Instagram publishing

1. On the Publish dialog, click **Enable publishing**. You go through Facebook Login again, this time also asking for `pages_manage_posts` and `instagram_content_publish`.
2. People with a role on the Meta app (admin, developer, tester) can publish immediately, in development mode.
3. For anyone else, submit these two permissions to Meta **App Review**. This needs business verification (done), a screencast of the publish flow, and the app switched to Live.

## Google Drive (Phase 2)

Signal asks for the `drive.file` scope only. With it, Signal can only open the files you pick in Google's Picker, never the rest of your Drive. Only the file reference is saved: Drive id, name, type, size, thumbnail and Drive link. The file's bytes are read through the Drive API when the post is published:
- **Facebook:** the bytes are sent directly.
- **Instagram:** a temporary private copy is kept with a 1-hour link, then deleted once Instagram has the file.

No file is ever made public. Disconnecting revokes the access with Google.

### Google Cloud setup (once)
1. Go to https://console.cloud.google.com and pick the project that holds the YouTube API key, or create one.
2. In **APIs & Services → Library**, enable **Google Drive API** and **Google Picker API**.
3. Set up the **OAuth consent screen**:
   - User type **External**, app name *Signal*, your support email.
   - Scopes: `.../auth/drive.file`, `openid`, `email`.
   - While the app is in *Testing*, add your Google account as a test user. Then click **Publish app**: in Testing, Google expires refresh tokens after 7 days. `drive.file` is a non-sensitive scope, so Google doesn't need to verify the app for it.
4. Create the OAuth client: **Credentials → Create credentials → OAuth client ID → Web application**.
   - Authorized JavaScript origins: `https://marketing-intel-alpha.vercel.app` (and `http://localhost:3000` for local use).
   - Authorized redirect URIs: `https://marketing-intel-alpha.vercel.app/api/drive/callback` (and `http://localhost:3000/api/drive/callback`).
5. Create the API key: **Credentials → Create credentials → API key**, then restrict it to the Google Picker API and to the referrer `https://marketing-intel-alpha.vercel.app/*`.
6. Find the project number on the project dashboard, under Project info.
7. In Vercel, add the following under Project → Settings → Environment Variables, then redeploy:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_PICKER_API_KEY` (optional if the YouTube key has the Picker API enabled)
   - `GOOGLE_CLOUD_PROJECT_NUMBER`

The same OAuth client also enables full YouTube access later (Phase 3). For that, add the YouTube redirect URI listed in `docs/social-integrations.md`.
