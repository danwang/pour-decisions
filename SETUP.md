# Setup: hosting, sign-in and sync

How Pour Decisions is deployed, and how the optional sign-in and progress sync work. The game itself needs none of this: with `js/cloud-config.js` emptied it runs as a plain static site with saves in `localStorage`.

```
Browser ──(static files)──▶ Cloudflare Worker  pour.peanutstar.com   (built from GitHub main)
   │
   └──(sign-in, saves)───▶ Supabase  cbsxfvkkeuxfflbucawb             (auth + one Postgres table)
                              └──(sign-in emails)──▶ SMTP provider     (pending, see Email)
```

## Hosting: Cloudflare

- **Site:** https://pour.peanutstar.com, served by the Cloudflare Worker `pour-decisions` (static assets only, no server code). `peanutstar.com` is registered on Cloudflare, so DNS and the HTTPS certificate are managed there.
- **Deploys:** every push to `main` builds and deploys automatically (Workers Builds, connected to the GitHub repo).
  - Build command: `node tools/test.js && node tools/build-site.js`
  - Deploy command: `npx wrangler deploy`
- **What gets published:** `tools/build-site.js` copies only the served files (`index.html`, `ads.html`, `style.css`, `js/`) into `dist/`, stamps `js/version.js` with the commit, and writes `dist/_headers` (5-minute cache). `wrangler.jsonc` points the Worker at `dist/`. Tools, tests and SQL are not served.
- **Checking a deploy:** the home screen shows the build ("build 2ccb1a0 · …"), or fetch `https://pour.peanutstar.com/js/version.js`.

Render (`render.yaml`) is the older host. It still deploys on push until it's shut down.

## Accounts and sync: Supabase

Project `cbsxfvkkeuxfflbucawb` (us-east-1, free plan). Its URL and publishable key are in `js/cloud-config.js`. Both are public by design: the key grants only what row-level security allows.

### Database

One table, shared by every game on the project ([supabase/schema.sql](supabase/schema.sql)):

| column | |
|---|---|
| `user_id` | the player (`auth.users`) |
| `game` | which game; required, no default (this one is `'pour'`) |
| `data` | that game's whole save, as JSON |
| `updated_at` | last write |

The primary key is `(user_id, game)`. Row-level security limits each signed-in player to their own rows; signed-out requests see nothing and can write nothing.

### Sign-in

- **Email only, no passwords.** One email carries both a link and a code. The link signs in whichever browser opens it; the code works anywhere, including an iPhone home-screen app, where links open in Safari instead. Using either one makes the other stop working.
- **Dashboard settings** (Authentication):
  - *URL Configuration*: Site URL `https://pour.peanutstar.com`; Redirect URLs list every address the game runs on, each ending in `/**` (the live site, `http://localhost:8173/**`, `http://localhost:8174/**`). A link requested from an unlisted address goes to the Site URL instead.
  - *Email Templates*: paste [supabase/email-sign-in.html](supabase/email-sign-in.html) into both **Magic link or OTP** and **Confirm signup** (a first sign-in uses the second). Subject: `Your Pour Decisions code: {{ .Token }}`. The dashboard preview shows the placeholders literally; real emails fill them in.

### Bot check (Cloudflare Turnstile)

Sign-up is open to anyone, so sending a sign-in email requires passing Cloudflare Turnstile. That keeps the form from being used to spam addresses. Most players never see it: the widget runs only when they tap Send, and shows a "verify you're human" box only when Cloudflare is unsure.

- **Cloudflare → Turnstile:** a widget (Managed mode) whose hostnames are `pour.peanutstar.com` and `localhost`. Its **site key** is public and goes in `turnstileSiteKey` in `js/cloud-config.js`. Its **secret key** goes only into Supabase.
- **Supabase → Authentication → Attack Protection (Bot and Abuse Protection):** CAPTCHA protection on, provider Turnstile, with the widget's secret key. Supabase then rejects sign-in requests without a valid token. Entering the emailed code doesn't need one.
- **Order matters:** deploy the site key first, then turn on CAPTCHA in Supabase. In the other order, sign-in fails until the site key is live.
- **Testing:** Cloudflare's test site keys work on any host: `1x00000000000000000000AA` always passes, and `3x00000000000000000000FF` always shows the interactive box.

### Email

Pending. Supabase's built-in email only reaches members of the Supabase organization and is heavily rate-limited, and editing templates requires custom SMTP. The plan is Resend (free tier):

1. Add and verify `peanutstar.com` in Resend (its DNS records go in Cloudflare, set to "DNS only").
2. Create an API key with sending access.
3. Supabase → Authentication → Emails → SMTP: host `smtp.resend.com`, port `465`, user `resend`, password = the API key, sender e.g. `noreply@peanutstar.com`.

### How sync works

Code: `js/cloud.js` (sign-in, sync, account sheet) and `SortSave.merge` in `js/migrations.js`.

- **Local first.** The save in `localStorage` stays the source of truth. The game never waits on the network and plays the same signed out or offline. The Supabase client loads from jsDelivr (pinned version, integrity-checked) only when someone signs in or already has a session.
- **Each sync** reads the account's row, merges it into this device's save, adopts the result, and writes it back if it changed. Syncs run about 4 s after a change, when the tab is hidden, and when it comes back.
- **Merge rules:** stars and best scores are unioned per puzzle; daily results are unioned and the streak recounted (catch-up solves never count toward it); Endless follows whichever side has solved more; the unfinished puzzle is the one touched last; settings stay per device.
- **Reset while signed in** wipes the account too, and devices that synced before the reset drop their old copy at their next sync. Reset while signed out clears only that device.
- **Moving to a new address** (another domain or host) starts every browser with an empty local save there, because storage is per address. Signing in on the old address first uploads the progress, and signing in on the new one brings it back.

### Free-plan caveat

Supabase pauses free projects after about a week with no activity. While paused, sign-in and sync fail (the game itself keeps working from local saves) until someone clicks Restore in the dashboard. A keep-alive ping every few days (cron-job.org, or a scheduled GitHub Action querying `/rest/v1/saves?limit=1` with the publishable key) prevents it. Not set up yet.

## Adding another game

Each game gets its own repo, its own Cloudflare Worker and its own subdomain (e.g. `nextgame.peanutstar.com`), so saves, deploys and tests stay separate. They share this Supabase project, so one account works everywhere:

1. Copy `js/cloud.js`, `js/cloud-config.js` and the account sheet markup, and give the game its own `game` name in the config.
2. Add `https://nextgame.peanutstar.com/**` to Supabase's Redirect URLs.
3. Nothing changes in the database: the new game's rows appear under its own `game` name.

## Local development

```bash
node tools/serve.js
```

Serves the repo at http://localhost:8173 with the live commit as the build stamp. Sign-in works locally against the real Supabase project, since localhost is on the redirect list. To try the deployable build, run `node tools/build-site.js` and serve `dist/`.
