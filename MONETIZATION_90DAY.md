# ModernMonk — 90-Day Monetization Plan (Updated)

**Channel:** [@modernmonkshot](https://youtube.com/@modernmonkshot) (`UCv8n_ykbynzj6-gwdwX6loA`)  
**Audit date:** 2026-08-04 (updated **2026-08-12** post-pivot)  
**Goal:** YouTube Partner Program eligibility within 90 days.

---

## 0. Post-pivot check-in (2026-08-12)

| Signal | Result |
|--------|--------|
| Food-first pivot | **Working directionally** — best new Short `Biryani not Indian?` **789 views** |
| Biryani cluster | 789 / 259 / 246 / 103 — proof the niche still converts |
| Money days (Aug 8–9) | **Failed** — mostly single-digit / low double-digit views |
| Duplicate titles | Re-uploaded “Lawsuit Over Dish”, “Tandoor Goes Global” — **fixed tighter dedupe** |
| Subs | Still **16** — packaging/voice still not converting to follows |
| Owner feedback | Edge-TTS voice unwatchable → **Chatterbox clone on all Shorts** |
| Long-form | Paused (`long_count_per_day: 0`) while clone TTS budget goes to Shorts |

---

## 1. Current status report (live API, 2026-08-04 baseline; refresh via `npm run growth:report`)

| Metric | Value | Notes |
|--------|-------|--------|
| Subscribers | **16** | Need 1,000 |
| Lifetime views | **~15,026** | |
| Videos | **117** | High volume, low conversion |
| Made for kids | **false** | Fixed (was critical blocker) |
| Privacy | **All public** | Fixed (was unlisted) |
| Monetization | **Not enabled** | Below YPP thresholds |
| Channel age | ~33 days (created 2026-07-02) | Early stage |

### What actually worked (top Shorts by views)

| Title | Views | Length | Pattern |
|-------|------:|-------:|---------|
| Butter Chicken's Wild West | 1,169 | 37s | Food origin |
| Food Fight | 1,127 | 29s | Food |
| Fusion Frenzy | 1,082 | 27s | Food |
| Spice Route | 1,047 | 42s | Food / spice history |
| Hydrogen Train | 860 | 35s | One-off news |
| One Decision | 777 | 41s | History twist |

### What is failing (recent uploads)

| Title | Views | Problem |
|-------|------:|---------|
| Einstein's Challenge | 67 | Off-brand abstract physics |
| Reality Not Weird | 48 | Quantum / abstract |
| Black Hole Paradox | 16 | Dead niche for this channel |
| Quantum Mechanics (long) | 0 | Long + wrong pillar |
| China's Five Year Plan | 0–30 | Off-brand geo-politics |

**Verdict:** The 2026-07-24 pivot to AI/ML + physics + daily hacks **destroyed the growth curve**. Food Shorts at 25–45s are the only proven product-market fit.

---

## 2. Root causes (expert YouTuber lens)

1. **Identity thrash** — Algorithm cannot recommend a channel that is food one week, Spider-Man the next, quantum the next.
2. **Wrong Shorts length** — Forced 50–100s abstract lectures; winners were 27–42s.
3. **Long-form gated Shorts** — If long failed (thin topic / TTS floor), the day shipped **zero Shorts**.
4. **Abstract “deep” topics** — Hard for free LLM to script without repetition; hard for mobile Shorts retention.
5. **Channel branding lag** — Description still read as generic finance/life, not food-story identity.
6. **Volume without series** — 117 videos, 16 subs = distribution without retention/brand.

---

## 3. Bold decisions (implemented in code 2026-08-04)

| Decision | Why |
|----------|-----|
| **Revert pillars to India food (weight 4) + money (2) + history (2) + places (1)** | Only food cluster hit 1k+ |
| **Hard-ban off-brand topics** (quantum, Marvel, Zeigarnik, etc.) | Proven 0–67 view killers |
| **Shorts-first pipeline** | Shorts upload before any long render |
| **Shorts independent of long** | Failed long no longer zeros the day |
| **25–45s target (20–55 hard bounds)** | Match winner distribution |
| **en-IN neural voice** | India audience conversion |
| **Hybrid media (not AI-only)** | Food needs real-looking visuals |
| **India trends ON, YT US trending OFF** | Reduce Marvel/score noise |
| **Growth report script** | Weekly truth, not vibes |

---

## 4. Math (honest)

| Path | Need | Reality check |
|------|------|----------------|
| Shorts YPP | 10M views / 90d ≈ **111k views/day** | Needs viral tail; automation alone rarely hits this |
| Classic YPP | **1k subs + 4k watch hours** | More realistic if food Shorts keep hitting 1k–10k and longs add hours |

**Operating targets (next 90 days):**

- Ship **5 public Shorts/day** on food/money/history/places only  
- Optimize for **repeat 1k+ view Shorts** (already proven once)  
- **1 long/day** only as secondary (watch hours), never blocks Shorts  
- Weekly: run `node scripts/channel-growth-report.mjs`  
- Goal line: **1,000 subs** first; watch hours via longs + binge sessions  

---

## 5. 90-day playbook

### Days 1–14 (this week + next)
- [x] Code: niche revert, Shorts-first, length fix, off-brand ban  
- [ ] Run `node scripts/fix-channel-growth.mjs` (branding + kids)  
- [ ] Studio: confirm “not made for kids”  
- [ ] Create 4 playlists: Food Origins / Money / History / Places  
- [ ] Feature best food Short as channel trailer  
- [ ] Manual trigger: `niche=indian-food-story` for 3 days straight  

### Days 15–45
- Double down on any Short that hits 500+ views (same dish/angle sequel)  
- Pin comment on every long: “Food, money, or history next?”  
- Share 1 best Short/day to Reddit (value-first, no spam)  
- Kill any week that drifts off pillars (report script flags `off-brand-abstract`)  

### Days 46–90
- If subs &lt; 200: increase food weight further / cut longs to free quota for 6 Shorts  
- If one Short breaks 10k+: make a 5-part series on that dish/theme  
- Apply to YPP the day thresholds clear — do **not** buy subs/views  

---

## 6. Manual checklist (30 min, free)

1. Studio → Settings → Channel → Advanced → Audience → **Not made for kids**  
2. Playlists: Food / Money / History / Places  
3. Feature a 1k-view food Short  
4. Run growth report weekly  
5. Never buy engagement  

---

## 7. Code map (this update)

| Change | File(s) |
|--------|---------|
| Proven India pillars + off-brand ban | `lib/growth.js`, `niches.js` |
| Config: Shorts length, voice, hybrid media | `config.yaml` |
| Research scoring + India trends | `lib/research.js` |
| Shorts-first orchestrator | `orchestrator.js` |
| Shorts scripts standalone | `lib/script-writer.js` |
| Niche workflow input text | `.github/workflows/daily.yml` |
| Branding | `scripts/fix-channel-growth.mjs` |
| Dashboard | `scripts/channel-growth-report.mjs` |

---

## 8. Honest note

Automation can **publish and package** at scale. It cannot force virality.  
The previous setup (kids + unlisted + niche thrash + abstract pivot) almost guaranteed flat growth.  
This setup removes those blockers and **only ships the content type that already got 1k views**.  

**90-day monetization is ambitious.** Hitting 1k subs is the primary realistic gate; 10M Shorts views is the stretch. The code is now aimed at the former without fantasizing the latter.
