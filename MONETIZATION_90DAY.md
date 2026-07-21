# ModernMonk — 90-Day Monetization Plan

**Channel:** [@modernmonkshot](https://youtube.com/@modernmonkshot) (`UCv8n_ykbynzj6-gwdwX6loA`)  
**Audit date:** 2026-07-21  
**Goal:** YouTube Partner Program eligibility as early as possible within 90 days.

---

## 1. Expert audit — why growth was flat

| Finding | Impact | Evidence |
|--------|--------|----------|
| **Channel was “Made for kids”** | Critical | `selfDeclaredMadeForKids: true` — kills comments, notifications, personalized recs, most ads |
| **Default upload privacy = unlisted** | Critical | Algorithm never sees unlisted; zero growth path |
| **Topic thrash (topic-agnostic)** | High | Food one day, trains next, Bollywood, history — no coherent “what this channel is” for the algorithm |
| **Weak engagement loops** | High | 0–14 likes, ~0 comments on most videos; no CTA in scripts |
| **Shorts not optimized for shelf** | Medium | Mixed length, weak first-second hooks, #Shorts inconsistently applied |
| **Brand new channel** | Context | Created 2026-07-02; 6 subs / ~9.2k views — early stage, not “dead” |
| **What works** | Opportunity | Food origin Shorts hit **1k–1.1k views** (Butter Chicken, Fusion, Spice Route) |

### YPP bar (public requirements)

1. **1,000 subscribers**, and  
2. **4,000 public watch hours** (12 months) **or** **10M valid public Shorts views** (90 days)

With automation, **Shorts velocity + one clear niche** is the realistic path.

---

## 2. Strategy (from patterns of large faceless/educational Shorts channels)

1. **One identity:** India stories — food origins, simple money, history twists, hidden places.  
2. **Public only** — no unlisted “production” uploads.  
3. **Not made for kids** — channel + every video.  
4. **Shorts-first:** 5 Shorts + 1 long/day (under free API quota).  
5. **25–45s Shorts** — matches your winners; hard cap 55s.  
6. **Hook in sentence 1** — pattern interrupt (MrBeast/faceless Shorts standard).  
7. **Soft CTA** — “follow for the next one” / yes-no question (MrWhoseTheBoss / Kurzgesagt-style soft close, not hard sell).  
8. **SEO titles** — curiosity + specificity + `#Shorts`.  
9. **Thumbnails** — high-CTR bold type (already shipped).  
10. **Evening IST publish** — 19:00 IST cron for IN mobile peak.  
11. **Double down on winners** — research scorer boosts food/money/history/places.  
12. **Volume with quality gates** — still refuse thin/repetitive scripts; better one good Short than three weak ones.  
13. **Playlists by pillar** (manual once: Food / Money / History / Places).  
14. **Community tab / pinned comment** — manual 2×/week until API bot is worth it.  
15. **End long-form with subscribe CTA** — in narration (no paid end-screen tools).  
16. **Free stack only:** edge-tts, Groq/Gemini free, Pexels/Pixabay, Wikimedia, YouTube Data API, ffmpeg, Remotion.

---

## 3. Math (rough, directional)

| Path | Need | At 5 Shorts/day |
|------|------|------------------|
| Shorts views | 10M / 90d ≈ **111k views/day** | Requires viral tail — unlikely day 1; still best *attempt* for automation |
| Subs + hours | 1k subs + 4k hours | More realistic if avg Short gets 2–10k views over weeks + 1 long for session time |

**Operating target (automation):**  
- Publish **6 public videos/day** (5 Shorts + 1 long)  
- Optimize for **1k+ views on best Shorts** (already proven on food)  
- Track weekly: subs, Shorts views, top title patterns  

---

## 4. What shipped in code (runs from next cron)

| Change | File(s) |
|--------|---------|
| `privacy_status: public` | `config.yaml`, workflow env |
| Shorts-first counts (1 long + 5 Shorts, 55s cap) | `config.yaml` |
| Growth niche scoring + pillar seeds | `lib/growth.js`, `lib/research.js` |
| Hook/CTA script directives | `lib/script-writer.js` |
| Title/description/tag optimizers | `lib/growth.js` |
| Upload: public, not kids, Shorts category + `#Shorts` title | `lib/youtube-upload.js` |
| India neural voice preference | `config.yaml`, `lib/tts.js` fallback |
| Cron **19:00 IST** (`30 13 * * *`) | `.github/workflows/daily.yml` |
| Fixed 4 legacy “made for kids” videos | `scripts/fix-channel-growth.mjs` |
| High-CTR thumbnails | `lib/thumbnail.js` (prior) |
| Channel lock to ModernMonkShot | `lib/youtube-upload.js` (prior) |

---

## 5. Your manual checklist (30 minutes, free)

1. **Studio → Settings → Channel → Advanced → Audience**  
   Confirm **“No, set this channel as not made for kids.”**  
2. **Playlists:** create Food Origins / Money / History / Places; add existing winners.  
3. **Channel trailer / feature** a 1k-view food Short.  
4. **Pin a comment** on new longs: “Which story next — food, money, or history?”  
5. **Do not** buy subs/views (ban risk; kills YPP).  
6. Optional free distribution: share 1 Short/day to Reddit r/India / finance / food (no spam; value first).

---

## 6. Weekly review (automation + you)

- [ ] Subs delta  
- [ ] Shorts views (Studio → Analytics → Content)  
- [ ] Top 3 titles — reverse into `growth.js` hooks if a new pattern wins  
- [ ] Any video still kids/unlisted? Re-run `node scripts/fix-channel-growth.mjs`  

---

## 7. Honest CTO note

Automation can **fix, package, and publish** at scale. It cannot guarantee virality. The previous setup (kids flag + unlisted + niche thrash) almost guaranteed *no* growth. The new setup removes those blockers and aligns with what already got you 1k-view Shorts. **90-day monetization is ambitious but possible** if a few Shorts break out; the code is now aimed at that, not at quiet unlisted archiving.
