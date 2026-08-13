# QUALITY.md — ModernMonk Shorts quality playbook

The two things that decided this channel's fate: **does the voice sound like a
human telling you something**, and **does every image match the words being
spoken right then**. Everything here exists to make those two true, and to let
you *check* they're true in about a minute — without waiting out a full render.

---

## 1. The 60-second QA of a finished Short

Play the Short once and listen/watch for these. A Short is shippable only if
all pass (mirrors the acceptance table in the owner brief):

**Voice**
- [ ] **Hook lands in ~2s** — first line is a pattern interrupt, delivered a
      touch faster and punchier than the rest.
- [ ] **It sounds like YOU**, not a generic reader. Timbre + cadence.
- [ ] **Real pauses between ideas** — a beat of silence before a reveal
      ("But…", "Turns out…"), not wall-to-wall talking.
- [ ] **Stress on the surprising word**, quicker on connectors.
- [ ] **Not an auctioneer** — deliberate, not rushed.

**Closure**
- [ ] Ends on a **complete sentence** (CTA or clean restated fact).
- [ ] **~2s of silence hold** after the last word, and the **last image holds**
      through it (no new image appears during the dead air).

**Visuals**
- [ ] Every few seconds, the image is a **literal match** for the words then.
- [ ] **No random human faces.** People only as silhouette/from-behind/absent.
- [ ] Real photos held longer; not a slideshow of 8 different AI art styles.

If you can't watch it, **say so** — don't claim it's good because the pipeline
exited 0. The gate catches broken renders and gross mismatches, not taste.

---

## 2. Fast QA loops (no full render)

### Voice A/B — hear the clone in ~1 minute
```bash
npm run voice:smoke
```
Synthesizes 2–3 sample lines through the **real** production voice path (beat
planner → Chatterbox → per-beat prosody → loudnorm → end hold) into
`voice-smoke/`. It also prints each line's beat plan so you can see the
hook/reveal/cta labels before you even listen.

Test your own line, or A/B against edge-tts to isolate whether a problem is the
clone or the pacing:
```bash
npm run voice:smoke -- "Glass is not a solid. It is not a liquid either."
npm run voice:smoke -- --provider edge-tts
```

### Visual plan — see the shot list without generating images
```bash
# Offline (no API keys): preview any narration + visual_needs
npm run preview:shotlist -- --narration "There is a country with no rivers. It still keeps a navy. Guess which one." --needs "world map, naval ship, desert coastline"

# Live (needs GROQ/GEMINI key): generate real Short scripts and preview them
npm run preview:shotlist -- --niche world-facts --count 2
```
Prints, per beat: the time window, the entity it'll search for, the exact
narration slice it sits over, the subject classification, and the style. The
**ANCHOR** beat (#0) of each segment is the one image that gets vision-verified
at render time. Read down the `over:` lines and ask "does this entity match
these words?"

---

## 3. The reference voice (the single biggest clone lever)

Zero-shot cloning copies the **whole** reference clip's character — including
its silences, breaths, and room noise. A tight, clean, *conversational* 8–15s
take clones your style far better than a long clip. Build the curated clip:

```bash
npm run voice:prepare-reference
```
This analyzes `voice-sample/reference.wav`, finds the longest clean voiced span,
and writes `voice-sample/reference-clean.wav` (mono 24kHz, normalized). The TTS
path **auto-prefers** that clean file when it exists. **Listen to it** — if it
caught a breath or a bad phrase, pick the window by hand after listening:

```bash
npm run voice:prepare-reference -- --start 14 --dur 11
```

### How to re-record (if the clone still isn't you)
- Quiet room, phone/mic ~20cm away, no fan/AC hum.
- **Tell a short story or explain a fact** the way you'd say it to a friend —
  *not* reading a script in monotone. The model copies your energy; give it
  conversational energy with natural rises and falls.
- 20–40 seconds is plenty. One clean continuous take beats five stitched ones.
- Save over `voice-sample/reference.wav`, then re-run `voice:prepare-reference`.

---

## 4. The knobs (config.yaml → `voice:` and `media:`)

**Voice performance**
| Knob | Does what | Default |
|---|---|---|
| `chatterbox_exaggeration` | BASE emotional lift. Beat planner nudges per beat. | 0.72 |
| `chatterbox_cfg_weight` | Lower = slower, more deliberate, freer prosody. | 0.30 |
| `chatterbox_temperature` | Sampling variety. | 0.85 |
| `speech_rate` | Post-synth slowdown (atempo, pitch kept). 0.90 ≈ 10% slower. | 0.90 |
| `sentence_pause_ms` | Base inter-sentence pause (planner overrides per beat). | 360 |
| `end_silence_sec` | Silence hold after the last word (also the visual hold). | 2.0 |
| `beat_performance_enabled` | The P0 fix: per-beat hook/reveal/cta/breath prosody. | true |
| `loudnorm_enabled` | EBU R128 so every Short sits at a steady, present level. | true |
| `reference_clean_sample` | Curated clip, auto-preferred over the raw reference. | reference-clean.wav |

> Config knobs alone were **not** enough — that was the owner's whole
> complaint. The real fix is `lib/speech-performance.js` deciding pauses and
> emphasis *per beat* from the actual words. Turning `beat_performance_enabled`
> off reverts to the old flat-sentence behavior; leave it on.

**Visuals / anti-slop**
| Knob | Does what | Default |
|---|---|---|
| `never_people` | Hard ban on prominent human faces — enforced on **both** AI and real stock (vision `hasPerson`). | true |
| `verify_relevance` | Vision-check real candidates for relevance/watermark/person. | true |
| `verify_ai_primary` | Also vision-check the **anchor** AI image per segment (closes "AI is relevant by construction"). | true |
| `prefer_real_stock` / `prefer_reuse_real_over_ai` | Favor real photos and reuse over AI style thrash. | true |
| `visual_beat_seconds_short` / `max_visual_beats_short` | Pacing: seconds per beat / cap. | 3.8 / 10 |

---

## 5. What the quality gate blocks (pre-upload)

A Short that fails routes to `ready_to_upload/` for manual review instead of
publishing. Blocking failures now include:
- Black-frame gaps, frozen-frame gaps, banned AI-cliché phrases, missing
  title/description/thumbnail (existing).
- **Visual mismatch (new):** when a vision key is present and the **majority of
  segment anchor images failed vision-relevance**, the video is showing the
  wrong thing for the narration — blocked.

Warnings (logged, not blocked): minority anchor mismatch, degraded/uncertain
vision checks, near-threshold audio clipping.

---

## 6. Architecture of the P0/P1 fixes (where to look)

- `lib/speech-performance.js` — **beat planner**. Narration → beats tagged
  hook/fact/reveal/cta/breath, each with its own pause + exaggeration/cfg/rate
  delta. Pure heuristic, zero added latency.
- `lib/tts.js` — consumes the beats: per-beat Chatterbox synthesis at the
  beat's prosody, variable pauses, `loudnorm`, and a reported `endHoldSec` so
  the visual timeline can hold the last frame.
- `lib/media-sourcing.js` — `planVisualBeats` (pure shot geometry, shared with
  the preview), never-people rejection on real stock, AI-anchor vision
  verification, `visionRelevant` in the manifest.
- `lib/script-writer.js` — `sanitizeVisualNeeds`: drops mood/abstract/person
  visual_needs and backfills concrete proper nouns from the narration.
- `lib/quality-gate.js` — vision-majority anchor check.
- `scripts/voice-smoke.mjs`, `scripts/shotlist-preview.mjs`,
  `scripts/prepare-reference-voice.mjs` — the QA loops above.

---

## 7. Known risks / TODO
- Chatterbox on CPU (GitHub Actions) is slow (~tens of seconds/beat). Beat
  splitting adds a few short synth calls per Short; acceptable for Shorts-only,
  but watch total run time if beat counts grow.
- Vision verification depends on GROQ/GEMINI keys. Without them, never-people
  and vision-majority **cannot** run — the pipeline degrades open (ships) and
  logs it. Keep at least one key set.
- Chatterbox package must be installed in the run environment
  (`pip install chatterbox-tts`). If it's missing, TTS falls back to edge-tts
  (humanized pacing but not the clone) — the smoke script says so explicitly.
