# 🎧 bandcamp-releases

Monitors Bandcamp "new release" emails, extracts every track, and serves them
in a lightweight web player backed by Supabase. Like a track to send it to a
**Download later** list; hide one to drop it from view.

## Pieces

| Part | Where | What |
|---|---|---|
| Player | `index.html` / `app.js` / `style.css` | Static site, GitHub Pages. Reads Supabase directly. |
| Ingester | `ingest/run.mjs` | Gmail → Bandcamp → Supabase. Runs daily via GitHub Actions. |
| Parser | `ingest/parse.mjs` | Pure Bandcamp page/email parsing (no I/O). |
| Stream resolver | Supabase Edge Function `resolve-stream` | Returns a fresh (short-lived) audio URL at play time. |
| DB | Supabase project `bandcamp-releases` (`zfhbokjdavitfihusmzt`) | `tracks`, `ingest_runs`. RLS: public read + toggle `rating`/`download_later` only. |

## Data model — `tracks`

`bandcamp_track_url` (unique key), `bandcamp_release_url`, `title`, `artist`,
`album`, `artwork_url`, `duration`, `released_at`, `is_clip_only`, `stream_url`
(cache), `source_email_id`, `source_subject`, `rating`
(`unrated` | `liked` | `hidden`), `download_later`.

Ingest upserts on `bandcamp_track_url` with `merge-duplicates` and never writes
`rating` / `download_later`, so your choices survive re-runs.

## Setup — daily ingest (GitHub Actions)

1. **Google OAuth client** (once): Google Cloud Console → APIs & Services →
   Credentials → *Create OAuth client ID* → **Desktop app**. Enable the **Gmail API**.
2. **Refresh token** (once):
   ```bash
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node ingest/get-refresh-token.mjs
   ```
   Approve in the browser, copy the printed token.
3. **Repo secrets** (Settings → Secrets and variables → Actions):
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `SUPABASE_URL` = `https://zfhbokjdavitfihusmzt.supabase.co`,
   `SUPABASE_SERVICE_KEY` = service_role key from Supabase → Project Settings → API.
4. Run **Actions → bandcamp ingest → Run workflow** (tick *dry run* first to preview).
   After that it runs daily at 06:20 UTC and drains the backlog ~40 emails/day.

The ingester creates a `✅ Done` Gmail label and applies it to every processed
email, so nothing is handled twice.

## Local dry run

```bash
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=… \
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… DRY_RUN=1 node ingest/run.mjs
```

## Player

Served from the repo root by GitHub Pages. `config.js` holds the Supabase URL and
anon key — both are safe to expose (RLS limits writes to the two state columns).
