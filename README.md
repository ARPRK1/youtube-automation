# youtube-automation — ModernMonk

A free, token-free daily pipeline that writes, voices, illustrates, and uploads
YouTube **Shorts** — end to end, on a schedule, without spending any
Claude/Fable tokens. It writes a script (Groq/Gemini free tier), narrates it in
the **owner's cloned voice** (Chatterbox, free), builds **script-matched**
visuals (real stock first, AI only when needed — every anchor image
vision-verified), and uploads via the real YouTube Data API v3.

**Channel:** [@modernmonkshot](https://youtube.com/@modernmonkshot) — a
**global "one sharp fact you didn't know" curiosity channel**. Faceless,
Shorts-first, no random human faces. See `MONETIZATION_90DAY.md` for the live
growth plan and `QUALITY.md` for the voice/visual quality playbook.

Content pillars (weighted rotation — `lib/growth.js` + `niches.js`): world
facts · Top 5/10 · history with a twist · science curiosities · riddles/quizzes
(food origin stories as occasional spice — the one cluster that historically hit
1k+ views).

> **Not the old setup.** This channel was previously India-food / then
> AI-physics; both were abandoned. If you find a doc or comment implying "India
> only" or "AI images are the primary visual," it's stale — the code is the
> source of truth.

## What one daily run produces

- **Mode:** Shorts-only by default (`video.long_count_per_day: 0`). Long-form is
  optional watch-hours fuel and **never gates Shorts** — a failed long can't
  zero out the day.
- **Volume:** `video.shorts_count_per_day` (default 5), vertical 9:16, ~28–50s
  spoken + a ~2s clean end-hold.
- **Cost:** $0 recurring. YouTube free quota ~10k units/day; an upload is
  ~1,600 units → ~5–6 uploads/day max.

## How a Short is built (per video)

1. **Research** (`lib/research.js`) — picks the day's topic from the weighted
   curiosity pillars + a curated evergreen bank, scored by a free LLM for Shorts
   potential, de-duplicated against recent history, with real source URLs pulled
   from Google News for factual grounding. Region-neutral (`topics.region`,
   default `US`) for a global audience.
2. **Script** (`lib/script-writer.js`) — a free LLM writes speech-first
   narration (hook → payoff → clean close) and concrete `visual_needs`. Vague/
   mood/person visual needs are stripped and backfilled with real proper nouns
   (`sanitizeVisualNeeds`).
3. **Voice** (`lib/tts.js` + `lib/speech-performance.js`) — the narration is
   split into **performance beats** (hook / fact / reveal / cta / breath), each
   synthesized by **Chatterbox** in the owner's cloned voice at its own
   emphasis/pacing, with variable pauses, EBU-R128 loudness normalization, and a
   real end-hold. Captions are timed to the actual per-beat audio.
4. **Visuals** (`lib/media-sourcing.js` + `lib/visual-sources.js` +
   `lib/ai-image.js`) — for each beat, **real stock/Wikimedia/Pexels is tried
   first** for concrete nouns; AI (Pollinations/Flux) is the fallback for
   abstract diagrams. Every candidate is **vision-verified** for relevance,
   watermarks, and — under `media.never_people` — prominent human faces (real
   *and* AI). The last image holds through the end-silence.
5. **Assemble** (`lib/visuals.js` + `lib/assemble.js`) — Ken Burns + xfade
   timeline, muxed with narration and burned-in captions.
6. **Thumbnail + Quality gate** (`lib/thumbnail.js` + `lib/quality-gate.js`) —
   CTR thumbnail; the gate blocks black/frozen frames, banned AI-cliché phrases,
   missing metadata, and **majority visual-mismatch** (anchor images that failed
   vision-relevance). Failures route to `ready_to_upload/` for manual review
   instead of publishing.
7. **Upload** (`lib/youtube-upload.js`) — real Data API v3 upload, locked to the
   ModernMonk channel (refuses to publish to any other channel the OAuth token
   might be bound to), **public**, **not made for kids**, `#Shorts` enforced.

`runs/<date>/manifest.json` records every stage's outcome and the real video
URL. Don't trust a video as "done" without checking it.

## Quality & QA loops (no full render needed)

```bash
npm run voice:prepare-reference   # build a clean 8–15s clone reference clip
npm run voice:smoke               # hear 2–3 sample lines in ~1 min
npm run preview:shotlist -- --niche world-facts --count 2   # per-beat visual plan
npm run test:units                # pure-function unit tests
npm run dry-run                   # validate keys/config, generate/upload nothing
```

See **`QUALITY.md`** for the 60-second QA checklist, the knobs, and how to
re-record the voice reference.

## One-time setup (all free)

### 1. LLM keys — Groq and/or Gemini

- Groq: https://console.groq.com/keys (primary; add `GROQ_API_KEY_2` etc. for
  more free quota — the pipeline round-robins across them)
- Gemini: https://aistudio.google.com/apikey (fallback)

At least one is required. Vision (relevance + never-people) needs Groq or
Gemini too — **keep at least one key set**, or those safety checks degrade open.

### 2. YouTube upload — Google Cloud OAuth client

1. https://console.cloud.google.com/ → new project (free).
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen (External; add yourself as a test user).
4. Create credentials → OAuth client ID → **Desktop app**. Note the ID/secret.
5. Mint a refresh token (pick the **ModernMonk Brand Account** on the consent
   screen — the upload code hard-fails on the wrong channel):
   ```bash
   YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... node scripts/get-youtube-refresh-token.js
   ```

### 3. Optional — stock media keys

- `PEXELS_API_KEY` (https://www.pexels.com/api/) — real photo/video b-roll.
- `PIXABAY_API_KEY` (https://pixabay.com/api/docs/) — more b-roll.

Without them, real-media sourcing leans on Wikimedia/Openverse + AI fallback.

### 4. GitHub Actions secrets

Push to GitHub, then **Settings → Secrets and variables → Actions**:

- `GROQ_API_KEY` (+ `GROQ_API_KEY_2`, …), `GEMINI_API_KEY`
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`,
  `YOUTUBE_CHANNEL_ID`
- `PEXELS_API_KEY`, `PIXABAY_API_KEY` (optional)

`.github/workflows/daily.yml` runs daily at 12:30 UTC and can be triggered
manually (`workflow_dispatch`), with inputs to pin a pillar (`niche`), change
counts, or run long-only backfill. It installs Chatterbox on the runner and
builds the clean voice reference automatically.

## Local testing

```bash
npm install
cp .env.example .env    # fill in the keys
npm run dry-run          # validates config; generates/uploads nothing
npm start                # generates + uploads today's batch for real
```

Uploads default to **public** (`upload.privacy_status`, overridable with
`YOUTUBE_PRIVACY_STATUS`). Public is required for the algorithm / YPP watch
hours — do not default to unlisted.

## Architecture

```
niches.js                weekday → pillar + evergreen topic bank + accent color
lib/research.js          pillars + Google News grounding → today's scored topic
lib/llm.js               free-tier LLM (Groq → Gemini), text + vision, key rotation
lib/script-writer.js     narration + concrete visual_needs + metadata (never Claude)
lib/speech-performance.js narration → hook/reveal/cta/breath performance beats
lib/tts.js               Chatterbox clone per beat + loudnorm + end-hold + real captions
lib/chatterbox-tts.js    persistent Python model server client
lib/media-sourcing.js    real stock → AI fallback, vision-verified, shot-list geometry
lib/visual-sources.js    Pexels/Pixabay/Openverse/Wikimedia (licensed)
lib/ai-image.js          Pollinations/Flux prompts (never people)
lib/vision-check.js      Groq/Gemini vision: relevance + watermark + person
lib/visuals.js           Ken Burns + xfade background timeline
lib/assemble.js          mux narration + burned-in captions
lib/thumbnail.js         ffmpeg CTR thumbnail
lib/quality-gate.js      pre-upload blocking checks (incl. vision-majority)
lib/youtube-upload.js    Data API v3 upload, channel lock
orchestrator.js          ties it together → runs/<date>/manifest.json
```

No step calls Claude, Fable, or any paid API. The only recurring cost is time.
