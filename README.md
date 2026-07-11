# youtube-automation

A small, free, token-free daily pipeline: writes a script (Groq/Gemini free tier), narrates it (Microsoft Edge TTS, free, no key), renders it with FFmpeg (background + burned-in captions), and uploads to YouTube (real Data API v3 upload, not a stub). Scheduled by GitHub Actions, not by OpenClaw's own cron — this never spends Claude/Fable tokens.

Daily output: **2 long-form videos (10+ min) + 4 Shorts** for that day's niche (6 uploads/day total — YouTube's free API quota is 10,000 units/day and an upload costs 1,600 units, so 6/day is the safe ceiling without requesting a quota increase).

Content is **India-focused by default**, except where the subject is inherently global (AI). Niche rotates by day of week — see `niches.js`:

| Day | Niche |
|---|---|
| Mon | Indian Stock Market & Finance |
| Tue | AI & Education (global) |
| Wed | Indian Mystery & History |
| Thu | Indian Food & Culture |
| Fri | Indian Tourism & Places |
| Sat | Bollywood, Cricket & Entertainment |
| Sun | India Week Updates & Trending |

### How today's topic is chosen

Each run calls `lib/trends.js`, which pulls a **real, current topic** for the day's niche — free, no API key, no LLM tokens spent:

- Mon–Sat: searches Google News (`hl=en-IN&gl=IN`) using that niche's rotating query set (e.g. "Nifty Sensex news", "Bollywood news today") and takes today's top real headline as the topic, with the next few headlines passed to the script writer as factual grounding.
- Sunday: pulls Google's live "Trending Now" feed for India directly — whatever India is actually searching for right now becomes the topic.
- If either live lookup fails (network blip, feed down), it falls back to a curated per-niche topic bank in `niches.js` so a bad day for Google's RSS feeds can never block the job. `output/<date>/manifest.json` records which source (`google-news` / `google-trends` / `fallback-bank`) was actually used for each video.

Every video's description gets 3-6 relevant hashtags generated alongside the title/tags (Shorts always forcibly include `#Shorts`, since that's what routes an upload into the Shorts shelf — not left to the model).

### Visuals

Each long-form video is built from several contextual visual segments — one per script chapter, not a single static background for the whole video. `lib/visuals.js` tries, in order, per segment:

1. **AI-generated image** (`lib/ai-image.js`, via Pollinations.ai — free, no key, runs on their servers so no GPU needed here). This is the primary source: the chapter title becomes the image prompt directly, so relevance is guaranteed by construction instead of hoping a search engine finds something close. This replaced an earlier stock-photo-search-only approach that repeatedly returned wrong/irrelevant or even inappropriate images (e.g. a cricket-recap video once got a funeral-ghat photo just from loose keyword overlap).
2. **Stock photo/video fallback** (`lib/visual-sources.js`) only if AI generation is unavailable/slow/erroring — Pollinations is a free community service with no uptime guarantee. Falls through Pexels video → Pexels photo (needs a free `PEXELS_API_KEY`) → Openverse → Wikimedia Commons (both no-key, filtered to commercially-safe licenses, with the same title-relevance check).
3. A generated gradient, if nothing worked anywhere — a segment can never fail outright.

CC-licensed stock assets that *are* used (fallback path only) get credited automatically in the description, since most of those licenses require attribution. AI images and Pexels need none.

**Optional but recommended:** add a free `PEXELS_API_KEY` (https://www.pexels.com/api/) purely as a stronger fallback layer if Pollinations has a bad day — not required for normal operation anymore.

### Animated intro (Remotion)

Each long-form video gets a short (~2.8s) animated title card before the narration starts — niche label and title, kinetic-text entrance, niche-specific accent color (see `accentColor` per niche in `niches.js`) — built with [Remotion](https://remotion.dev) (`remotion/IntroCard.jsx`, rendered via `lib/intro.js`). Remotion is free for individual/small-team use, runs on plain Node + headless Chromium (CPU only, no GPU needed) — but its renderer has **no Windows-on-ARM build**, so it cannot be tested on that class of machine; it's expected to work normally on GitHub Actions' standard Linux runners. If the intro render or splice fails for any reason, that single video falls back to shipping without the intro rather than failing the whole video — check `steps.intro` in `manifest.json` to see whether it actually rendered. Shorts skip the intro entirely (a title card would eat into the 59s budget and works against a Short's "hook in the first 2 seconds" goal).

## One-time setup (all free)

### 1. Script generation — Groq and/or Gemini API key

Both have generous free tiers and don't touch your Claude/Fable usage at all.

- Groq: https://console.groq.com/keys
- Gemini: https://aistudio.google.com/apikey

You already have both configured in `~/.openclaw/.env` — reuse the same values here.

### 2. YouTube upload — Google Cloud OAuth client (one-time, free)

1. Go to https://console.cloud.google.com/ and create a new project (free).
2. Enable **YouTube Data API v3** (APIs & Services → Library).
3. Configure the OAuth consent screen (External, add yourself as a test user is enough — you don't need Google review for personal use).
4. Create credentials → OAuth client ID → Application type **Desktop app**. Note the Client ID and Client Secret.
5. Run the one-time helper locally to mint a refresh token:
   ```
   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node scripts/get-youtube-refresh-token.js
   ```
   It prints a URL — open it, approve access with the Google account that owns your YouTube channel, and the refresh token prints in your terminal. Save it.

### 3. Optional — Pexels API key for stock-photo backgrounds

Free, no cost ever: https://www.pexels.com/api/. Without this, videos use a generated gradient background instead of a stock photo — still looks fine, just plainer.

### 4. Push this repo to GitHub and add secrets

Create a new (can be private) GitHub repo, push this folder to it, then under **Settings → Secrets and variables → Actions** add:

- `GROQ_API_KEY` and/or `GEMINI_API_KEY`
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- `PEXELS_API_KEY` (optional)

The workflow in `.github/workflows/daily.yml` runs daily at 03:33 UTC (~9:03am IST) and can also be triggered manually from the Actions tab (`workflow_dispatch`).

## Local testing (do this before enabling the schedule)

```
npm install
cp .env.example .env   # fill in the keys above
npm run dry-run         # validates config, generates and uploads nothing, costs nothing
npm start                # generates and uploads today's full batch for real
```

Check `output/<date>/manifest.json` after a real run — every video has a `steps` object recording exactly which stage succeeded, and an `upload` object with the real YouTube video ID/URL (or a `skipped`/error reason). Don't trust a video as "done" without checking this file; the old pipeline used to claim success without checking real output.

Videos upload as **unlisted** by default (`YOUTUBE_PRIVACY_STATUS=unlisted`). Once you've confirmed a batch looks right on your channel, switch it to `public` in `.env` / the repo variable.

## Architecture

```
niches.js              day-of-week -> niche + topic bank + accent color
lib/trends.js            Google News/Trends -> today's real topic per niche (free, no key)
lib/script-writer.js   Groq/Gemini -> narration + title/description/tags (never Claude)
lib/tts.js              edge-tts -> mp3 + word-timed .srt (free, no key)
lib/srt.js              SRT parsing helpers
lib/ai-image.js          Pollinations.ai -> AI image per chapter (free, no key, no GPU needed)
lib/visual-sources.js    Pexels/Openverse/Wikimedia fallback if AI image generation fails
lib/visuals.js           builds the per-chapter background clip (AI image -> stock -> gradient)
remotion/                animated title-card intro (React/Remotion components)
lib/intro.js             bundles + renders the Remotion intro
lib/assemble.js          mux narration + background + captions, prepend intro -> final mp4
lib/thumbnail.js         ffmpeg-generated thumbnail, no external service
lib/youtube-upload.js    real YouTube Data API v3 upload (googleapis, OAuth refresh token)
orchestrator.js          ties it together, writes output/<date>/manifest.json
```

No step in this pipeline calls Claude, Fable, or any paid API. The only recurring cost is your time.
