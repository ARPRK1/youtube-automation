# Claude Code — Owner Brief: ModernMonk YouTube Automation Quality Overhaul

**Paste this entire document into Claude Code as the task prompt.**  
Repo: `youtube-automation` (local + GitHub `ARPRK1/youtube-automation`).  
Channel: [@modernmonkshot](https://youtube.com/@modernmonkshot) · ID `UCv8n_ykbynzj6-gwdwX6loA` · brand **ModernMonk**.

You are a senior YouTube growth engineer + faceless Shorts production expert + Node/ffmpeg systems engineer. Act autonomously. Ship working code. Prefer depth over cosmetics. Do not leave half-fixed voice or visuals.

---

## 0. Who I am (the owner)

I run a fully automated YouTube Shorts pipeline. I do **not** want to hand-edit every video. I want the **system** to produce Shorts that:

1. Sound like **me** (cloned voice with real human pacing — pauses, emphasis, rises/falls — not flat TTS reading a paragraph).
2. Show visuals that **literally match the words being spoken** at that second (no random faces, no wrong objects, no generic AI wallpaper).
3. Feel **human-made with effort**, not “AI slop” — something I would willingly watch myself.
4. Grow toward YPP: **1,000 subs** + watch hours or Shorts views. Currently ~**16 subs**, ~**17k views**, ~**130+ videos** — high volume, low conversion. Quality packaging is the bottleneck now, not “more random uploads.”

I am **not** a developer. Implement end-to-end. Use free/open tools where possible (current stack). Do not introduce paid SaaS unless optional and behind a flag. Do not buy views/subs.

---

## 1. Product identity (do not thrash)

**Brand one-liner:** *ModernMonk — one sharp fact you didn’t know.*

**Format:** Shorts-first (vertical 9:16), ~28–50s spoken + clean end hold.  
**long_count_per_day is 0** in `config.yaml` — Shorts-only mode. When long count is 0, **never** run long-form research/backup paths (bug already partially fixed; verify fully).

**Content pillars** (universal curiosity — infinite niche):

| Pillar ID | Content |
|-----------|---------|
| `world-facts` | Geography, animals, inventions, “wait what?” facts |
| `top-lists` | Top 5 / Top 10 countdowns (any domain) |
| `history-twist` | One-decision / myth-bust history |
| `science-curiosity` | Everyday physics/logic — punchy, not lectures |
| `mind-quiz` | Riddles / guess / reveal |
| `indian-food-story` | Occasional spice only (proven 1k-view past winners) |

**Do not** drift into: Marvel/Spider-Man spam, Bollywood score spam, pure money-guru thrash, multi-week abstract AI/physics lecture series without packaging, “made for kids,” unlisted-by-default.

**Live data that matters (use as priors):**

- Best all-time Shorts: India **food origin** 27–42s (~1.0–1.2k views).
- Post food-first pivot: “Biryani not Indian?” ~789 views.
- Dead content: quantum/China five-year/generic AI lectures/money thrash → single-digit to low dozens of views.
- **Owner QA of latest clone Shorts (Islands Vanish / Reappearing Act / Now You See Me):** voice still **not** my tone; missing pauses/expression; still feels like **fast reading**; visuals still **don’t match spoken content** well enough. Parameter knobs alone were not enough — architectural fixes required.

---

## 2. Current architecture (ground truth)

Read these first before editing:

```
orchestrator.js          # daily pipeline; Shorts-first; produceVideo()
config.yaml              # all knobs
lib/research.js          # topic pick + scoring
lib/growth.js            # pillars, titles, CTAs, playlist classify
lib/script-writer.js     # Long + Short LLM scripts, visual_needs
lib/tts.js               # edge-tts / kokoro / chatterbox + sentence split + atempo + end silence
lib/chatterbox-tts.js    # persistent Python server client
scripts/chatterbox_server.py
voice-sample/reference.wav   # owner reference (~57s) — DO NOT delete; improve usage
lib/media-sourcing.js    # real stock → AI fallback; expandSegmentVisualBeats
lib/ai-image.js          # Pollinations Flux prompts / never people
lib/visual-sources.js    # Pexels/Pixabay/Openverse/Wikimedia
lib/vision-check.js      # Gemini/Groq vision relevance
lib/visuals.js           # Ken Burns + xfade timeline
lib/assemble.js          # mux audio + captions
lib/thumbnail.js         # CTR thumbs
lib/quality-gate.js      # pass/fail before upload
lib/youtube-upload.js    # Data API v3, channel lock
.github/workflows/daily.yml
```

**Pipeline per Short today:**

1. Research topic (`researchTodaysTopic`)
2. `writeShortScripts` → title, narration, `visual_needs[]`
3. Per segment: TTS (`synthesizeSegmentAudio`) + `sourceMediaForSegment` + `expandSegmentVisualBeats`
4. `renderVisualTimeline` → `renderFinalVideo` + thumbnail + quality gate + upload

**Known implementation attempts already in repo (still insufficient):**

- Chatterbox clone: `exaggeration=0.75`, `cfg_weight=0.28`, `speech_rate=0.88`, `sentence_pause_ms=380`, `end_silence_sec=2`, sentence_split
- Scripts: complete-sentence trim, forced closing CTA
- Visuals: `never_people`, hybrid stock, prefer reuse real over AI thrash, beat-aligned prompt slices
- Owner still rejects quality → **go deeper than config tweaks**

**Constraints:**

- Free-tier stack preferred: Groq/Gemini LLM, edge-tts, Chatterbox, Pollinations, Pexels free key, YouTube API.
- YouTube free quota ~10k units/day; upload ≈ 1600 units → ~5–6 uploads/day max. Don’t burn quota on bulk playlist/unlist loops during production days.
- GitHub Actions public runner: Chatterbox is **CPU-slow** (~tens of seconds per sentence). Design for that: Shorts-only, limit sentence count, or cache, but **quality > speed**.
- Node ESM (`"type": "module"`), Node ≥20.

---

## 3. Primary mission (priority order)

### P0 — Voice that actually sounds like the owner

**Problem diagnosis (expert):**

- Zero-shot clone of a reference WAV often captures **timbre** but not **performance** (phrasing, breath, emphasis).
- Synthesizing a full paragraph (or even flat sentence list) without performance markup yields “audiobook reader” cadence.
- Post-hoc `atempo` slows audio but **does not add real prosody**.
- Hard-splitting on `.` alone can break natural speech rhythm if sentences are long/uniform.
- Reference sample quality and **how** it’s used (full clip vs curated 6–15s clean take) matters more than another 0.05 on exaggeration.

**Required outcomes:**

1. Listener recognizes **owner’s speaking style** (pauses after hooks, stress on surprise words, slower key facts, quicker connectors).
2. Not “someone reading text fast.” Not monotone. Clear phrase boundaries.
3. Every Short **ends cleanly**: complete final sentence + **≥1.5–2.0s** silence hold before cut (already partially implemented — verify audio **and** video hold last frame; no mid-sentence cutoff).
4. Ship a **voice QA path**: generate 2–3 sample lines from `reference.wav` to artifact/local file without full video render (`scripts/` or workflow), so we can A/B prosody without 2-hour full pipeline.

**Technical directions to explore (implement best combination, not all blindly):**

1. **Reference audio curation**
   - Script/tool to analyze `voice-sample/reference.wav` (duration, silence, loudness).
   - Prefer a **clean 8–15s** continuous speech slice for Chatterbox prompt (export `voice-sample/reference-clean.wav`) if full 57s dilutes style.
   - Document how owner should re-record if needed: quiet room, conversational storytelling energy, not script-reading monotone.

2. **Performance-aware script → speech**
   - Change Shorts narration generation to emit **spoken beats**, not one paragraph:
     - Optional structured JSON: `{ "beats": [ { "text": "...", "pause_after_ms": 200|400|600, "emphasis": "hook|fact|reveal|cta" } ] }`
   - Map emphasis → slight exaggeration / pause / optional mild rate change per beat.
   - Keep total spoken words in a range that stays under Shorts max duration **after** pauses + end hold.

3. **Chatterbox generation strategy**
   - Keep persistent server (`scripts/chatterbox_server.py`).
   - Per-beat generate (not whole script) with intentional pauses between beats (variable, not only fixed 380ms).
   - Tune `exaggeration` / `cfg_weight` / `temperature` **with a small offline grid or documented A/B**, not guess once.
   - Avoid stacking “higher exaggeration + heavy atempo” if it sounds unnatural; prefer correct cfg_weight first.
   - Optional: light **loudness normalization** (ffmpeg `loudnorm`) for consistent presence.

4. **If Chatterbox cannot match owner after serious effort**
   - Implement a clear fallback ladder with config flags:
     1. Improved Chatterbox (preferred)
     2. edge-tts with **humanized SSML-like pacing** (breaks, slower rate) as temporary
     3. Document what paid clone (e.g. ElevenLabs) would need — but don’t hard-require paid keys
   - Do **not** silently ship flat TTS and call it done.

5. **Acceptance tests for voice**
   - Unit/integration: sentence/beat splitter; end silence present; duration gates include hold.
   - Manual checklist in README: “Listen for: breath gap after hook; stress on the surprising noun; CTA is last full sentence; 2s dead air.”

### P1 — Visuals that match the spoken words (anti-slop)

**Problem diagnosis (expert):**

- Faceless Shorts die when the eye sees something **unrelated** to the ear.
- Stock search on loose keywords returns wrong entities; AI Flux often invents faces/scenes.
- `visual_needs` from the LLM are often too vague or not timed to specific phrases.
- Multi-beat AI style thrash (whiteboard → pencil → ink) reads as “template,” not editorial.
- Vision verify is rate-limited / sometimes skipped; AI-only path has no real verification.

**Required outcomes:**

1. For each ~3–5s beat, the on-screen image is a **reasonable literal match** for the words in that window (object/place/map/animal/diagram — not random human faces).
2. Prefer **real stock / Wikimedia / Pexels** for concrete nouns; AI only for truly abstract diagrams.
3. **Zero random people** unless the script is *about* a named historical figure **and** we use silhouette/symbolic only (channel already has `never_people` — enforce end-to-end, including stock search filters if needed).
4. Fewer, better cuts: hold real photos longer; stop slideshow of unrelated AI styles.
5. Quality gate **fails** a Short if vision relevance fails on majority of beats (when vision keys exist), instead of shipping slop.

**Technical directions:**

1. **Script → timed visual plan**
   - After narration is final, build a **shot list** aligned to audio (word timestamps if available; else proportional word slices — already partially in `sliceTextForBeat`).
   - Each shot: `{ t0, t1, query, must_include, forbid: ['person','crowd','portrait'], style: 'photo'|'map'|'diagram' }`.
   - LLM must output **searchable concrete queries** (“sandy island map”, “google maps pin”, “whaling ship woodcut”) not “mystery”, “concept of disappearance”.

2. **Media retrieval upgrades**
   - Multi-query fallback per shot (synonyms / more specific).
   - Reject candidates that vision marks irrelevant; try next candidate aggressively.
   - Cache successful entity→url mappings for the day to avoid thrash.
   - When Pexels key present, prefer **video b-roll** over stills for energy (short loops).

3. **AI image prompts (when used)**
   - Positive-only framing; no “not a person” (known Flux trap already documented in `ai-image.js` comments — preserve that lesson).
   - Force documentary / object / map aesthetics; ban portrait vocabulary in prompts.
   - One consistent visual language per Short (e.g. all editorial photo + one map), not 5 art styles.

4. **Sync**
   - Visual cut points should align to sentence/beat boundaries where possible (cut on pause).
   - Last 2s: freeze or slow push on final image during end silence (no new wrong image).

5. **Acceptance tests for visuals**
   - Manifest records per beat: spoken slice, query used, source, vision pass/fail.
   - Add a `scripts/preview-visual-plan.mjs` that prints shot list without full render.
   - Optional smoke: one Short render locally/CI with artifact inspection.

### P2 — Script craft for retention (Shorts)

**YouTube Shorts reality:**

- Hook in **first 1–2 seconds** or scroll-away.
- One idea, complete payoff, soft loop CTA.
- Incomplete endings destroy session time.
- Top 5 / riddle / myth-bust formats outperform random abstract lectures for discovery **if** packaged tightly.

**Required outcomes:**

1. Narration is written for **speech** (short sentences, contractions, spoken rhythm), not essay.
2. Full arc always: **hook → proof/story → land**.
3. CTA is a **complete last sentence**, not mid-list cut.
4. Different Shorts in a batch are true different angles (no 5 near-duplicates).
5. Titles: mobile-first, curiosity, `#Shorts`, under ~48 chars before tag; no generic “Deep Fact / Myth Bust” spam titles without substance.

**Implement in `lib/script-writer.js` + `lib/growth.js`.**

### P3 — Channel hygiene & growth systems

Already partially done: playlists, unlist-slop, public + not-kids, growth report.

**Still required / verify:**

1. Daily job never depends on long-form when `long_count_per_day: 0`.
2. Don’t exhaust YouTube API quota on maintenance during production days.
3. Feature playlist “Curiosity Facts” as main shelf; keep Food / Finance / Science / History archives.
4. Quality gate should block upload of stub duration, mid-sentence endings (detect no terminal punctuation / trailing incomplete clauses), and failed vision majority.
5. Update `MONETIZATION_90DAY.md` / README with **current** strategy and voice/visual QA checklist.

---

## 4. What “good” looks like (acceptance criteria)

A Short is **shippable** only if:

| Check | Pass rule |
|-------|-----------|
| Hook | First sentence is pattern-interrupt within ~2s of audio start |
| Voice | Not flat read; audible pauses between ideas; slower than “auctioneer”; clone recognizable vs pure edge-tts |
| Closure | Ends on complete sentence + ≥1.5s silence; video holds |
| Visual match | ≥70% of beats vision-pass OR strong deterministic real-media match on concrete nouns |
| No face spam | No random modern portraits |
| Length | Spoken body roughly 28–45s; total with hold ≤ `shorts_max_seconds` |
| Title | Specific + curiosity + `#Shorts` |
| Identity | Fits curiosity pillars; not off-brand thrash |

Ship at least:

1. Code changes implementing P0 + P1 deeply (not config-only).
2. A **voice smoke** script/workflow producing sample WAVs.
3. A **visual plan** debug dump for one topic.
4. One successful dry path: `npm run dry-run` still works; document how to run a 1–2 Short production smoke.

---

## 5. Out of scope / do not do

- Do not buy growth, bots, or fake engagement.
- Do not re-open “made for kids.”
- Do not switch default privacy to unlisted.
- Do not thrash identity back to pure food-only **or** pure abstract AI lectures — stay universal curiosity with visual-first packaging.
- Do not add heavy paid dependencies without feature flags and free defaults.
- Do not claim success without addressing **owner’s stated failures** (voice not mine; visuals mismatch).

---

## 6. Working method for Claude Code

1. **Explore** the files listed in §2; quote real functions you change.
2. **Diagnose** root causes with code references (not vibes).
3. **Implement** P0 then P1 then P2; small commits with clear messages.
4. **Test** what you can without full GPU: unit tests for splitters/closures; dry-run; optional chatterbox smoke if environment allows.
5. **Document** in a short `QUALITY.md`: knobs, how to re-record reference, how to QA a Short in 60 seconds.
6. If blocked (no API keys, no Python deps), leave clear TODOs and still ship structural improvements.

---

## 7. Suggested implementation sketch (you may improve)

```
lib/speech-performance.js   # beat planner, pause map, emphasis
lib/tts.js                  # consume beats; per-beat chatterbox; loudnorm; end hold
lib/shot-list.js            # narration → timed shots with search queries
lib/media-sourcing.js       # retrieve per shot; stricter verify; less style thrash
lib/script-writer.js        # beat-structured Shorts JSON
lib/quality-gate.js         # closure + vision majority + duration
scripts/voice-smoke.mjs     # 3 lines → wav artifact
scripts/shotlist-preview.mjs
config.yaml                 # new knobs documented
```

---

## 8. Business context (why this matters)

- Automation already **publishes**. Growth failed on **product quality + identity thrash**.
- Algorithm rewards watch time + rewatch + follows. AI-slop audio/visuals get zero second chances on a 16-sub channel.
- The path to monetization is: **consistent curiosity Shorts that humans finish**, then follow. Not 6 mediocre uploads/day.

Your job is to make the next Short one the owner would **choose** to watch — then scale that.

---

## 9. Final instruction

Start now. Prioritize **voice performance architecture** and **timed visual–script alignment**. Treat config knob twiddling as insufficient unless paired with structural change. When done, summarize: root causes, files changed, how to generate a smoke Short, and remaining risks.

Channel: ModernMonk (@modernmonkshot). Repo: youtube-automation. Owner expects genius-level YouTube automation engineering — deliver it.
