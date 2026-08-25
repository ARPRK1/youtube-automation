// 3-month ALTERNATE-DAY long-form plan for the "Amazing Places & Earth's
// Wonders" niche. Uses the same bank the pipeline picks from (niches-long.js)
// so the plan and the automation never drift. Safety-screened against the same
// NSFW/off-brand filters. Emits a reviewable Markdown + HTML calendar.
//
// Run: node scripts/plan-longs.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LONG_TOPICS } from '../niches-long.js';
import { NSFW_VISUAL_RE } from '../lib/script-writer.js';
import { isOffBrandTopic } from '../lib/growth.js';

function screen(t) {
  const p = [];
  if (NSFW_VISUAL_RE.test(t)) p.push('NSFW/anatomical');
  if (isOffBrandTopic(t)) p.push('off-brand');
  return p;
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Rough visual/theme tag for each topic (for the plan's colour coding).
function themeOf(t) {
  const s = t.toLowerCase();
  if (/animal|creature|deep-sea|glow|species|regenerate/.test(s)) return { k: 'Animals', c: '--t-green' };
  if (/structure|engineering|bridge|tunnel|monument|road|tallest|ancient/.test(s)) return { k: 'Structures', c: '--t-amber' };
  if (/solar system|moon|space|sky|weather/.test(s)) return { k: 'Sky & Space', c: '--t-violet' };
  if (/lost|abandoned|shipwreck|unexplained|phenomen|no official map|signals/.test(s)) return { k: 'Mysteries', c: '--t-coral' };
  return { k: 'Places & Nature', c: '--t-teal' };
}

async function main() {
  const flagged = LONG_TOPICS.filter((t) => screen(t).length > 0);
  console.log(`[plan-longs] screening ${LONG_TOPICS.length} long topics`);
  if (flagged.length > 0) {
    console.error('[plan-longs] SAFETY FAIL:'); flagged.forEach((t) => console.error(`  - "${t}" :: ${screen(t).join(', ')}`));
    process.exitCode = 1; return;
  }
  const uniq = new Set(LONG_TOPICS.map((t) => t.toLowerCase()));
  if (uniq.size !== LONG_TOPICS.length) { console.error('[plan-longs] duplicate topics'); process.exitCode = 1; return; }
  console.log(`[plan-longs] SAFETY PASS — ${LONG_TOPICS.length} unique, 0 anatomical/off-brand.`);

  // Alternate-day schedule over ~90 days = ~45 slots. Rotate through the bank.
  const start = new Date('2026-08-26T00:00:00Z');
  const slots = [];
  for (let i = 0; i < 45; i++) {
    const d = new Date(start.getTime() + i * 2 * 86400000);
    const topic = LONG_TOPICS[i % LONG_TOPICS.length];
    slots.push({ n: i + 1, date: d.toISOString().slice(0, 10), topic, theme: themeOf(topic) });
  }

  const outDir = path.join(process.cwd(), 'plan');
  await mkdir(outDir, { recursive: true });
  const md = [
    '# ModernMonk — 3-Month Long-Form Plan (Amazing Places & Earth\'s Wonders)',
    '',
    '_Alternate-day Top-10 list videos (5–8 min). Safety-screened; physical-world / high-visual topics only. The automation picks from the SAME bank (`niches-long.js`), so this plan and the daily job never drift._',
    '',
    `**Cadence:** every 2 days · **${slots.length} videos** · ${slots[0].date} → ${slots[slots.length - 1].date}`,
    '',
    '| # | Date | Theme | Topic |',
    '|--:|------|-------|-------|',
    ...slots.map((s) => `| ${s.n} | ${s.date} | ${s.theme.k} | ${s.topic} |`),
    ''
  ].join('\n');
  await writeFile(path.join(outDir, 'long-form-3month-plan.md'), md, 'utf-8');
  await writeFile(path.join(outDir, 'long-form-3month-plan.html'), renderHtml(slots), 'utf-8');
  console.log(`[plan-longs] wrote plan/long-form-3month-plan.md + .html (${slots.length} slots)`);
}

function renderHtml(slots) {
  const rows = slots.map((s) => `<tr><td class="num">${s.n}</td><td class="num muted">${esc(s.date)}</td><td><span class="tag" style="--c:var(${s.theme.c})">${esc(s.theme.k)}</span></td><td>${esc(s.topic)}</td></tr>`).join('');
  return `<title>ModernMonk Long-Form Plan</title>
<style>
  :root{--bg:#f6f7f8;--surface:#fff;--ink:#15181c;--muted:#59616b;--hair:#e3e6e9;--accent:#116b74;
    --t-teal:#1f9e9a;--t-amber:#b9791f;--t-violet:#7c56e0;--t-green:#2f9e44;--t-coral:#d9484a;
    --good-bg:#e7f6ec;--good-ink:#1c7a3a;--good-line:#bfe6cc;
    --serif:"Palatino Linotype",Palatino,Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;}
  :root:not([data-theme="light"]){@media (prefers-color-scheme:dark){--bg:#0f1214;--surface:#171b1f;--ink:#e9ebee;--muted:#98a1ab;--hair:#262c31;--accent:#3fc3ce;--t-teal:#38c2bd;--t-amber:#d69b45;--t-violet:#a389f0;--t-green:#54c46a;--t-coral:#ef6d6f;--good-bg:#12271a;--good-ink:#5fd07f;--good-line:#1f4a2e;}}
  :root[data-theme="dark"]{--bg:#0f1214;--surface:#171b1f;--ink:#e9ebee;--muted:#98a1ab;--hair:#262c31;--accent:#3fc3ce;--t-teal:#38c2bd;--t-amber:#d69b45;--t-violet:#a389f0;--t-green:#54c46a;--t-coral:#ef6d6f;--good-bg:#12271a;--good-ink:#5fd07f;--good-line:#1f4a2e;}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;padding:clamp(20px,5vw,60px)}
  .wrap{max-width:900px;margin:0 auto}
  .eyebrow{font:600 12px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
  h1{font-family:var(--serif);font-weight:600;font-size:clamp(28px,5vw,42px);line-height:1.06;margin:12px 0 8px;text-wrap:balance}
  .lede{color:var(--muted);max-width:62ch;margin:0 0 20px}
  .meta{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;margin-bottom:8px}
  .safe{display:inline-flex;gap:8px;align-items:center;background:var(--good-bg);color:var(--good-ink);border:1px solid var(--good-line);border-radius:999px;padding:6px 13px;font-weight:600;font-size:13.5px}
  .safe svg{width:15px;height:15px}.stat{font-size:14px;color:var(--muted)}.stat b{color:var(--ink);font-variant-numeric:tabular-nums}
  .tablewrap{overflow-x:auto;border:1px solid var(--hair);border-radius:12px;background:var(--surface);margin-top:22px}
  table{border-collapse:collapse;width:100%;min-width:520px;font-size:14.5px}
  thead th{position:sticky;top:0;background:var(--surface);text-align:left;font:600 11px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);padding:12px 15px;border-bottom:1px solid var(--hair)}
  tbody td{padding:10px 15px;border-bottom:1px solid color-mix(in oklab,var(--hair) 60%,transparent);vertical-align:top}
  tbody tr:last-child td{border-bottom:none}tbody tr:hover td{background:color-mix(in oklab,var(--accent) 5%,transparent)}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}.muted{color:var(--muted)}
  .tag{font-size:12px;font-weight:600;color:var(--c);white-space:nowrap;background:color-mix(in oklab,var(--c) 12%,transparent);border:1px solid color-mix(in oklab,var(--c) 32%,transparent);padding:2px 9px;border-radius:6px}
  footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--hair);color:var(--muted);font-size:13px}
  code{font-family:var(--mono);font-size:.9em;background:color-mix(in oklab,var(--accent) 10%,transparent);padding:1px 5px;border-radius:4px}
</style>
<div class="wrap">
  <div class="eyebrow">ModernMonk · Long-Form</div>
  <h1>Amazing Places &amp; Earth's Wonders</h1>
  <p class="lede">Alternate-day Top-10 list videos (5–8 min), chosen for click-through (dramatic thumbnails) and for visuals our tools render best — real places, nature, animals, and structures. Not abstract, no people-focus.</p>
  <div class="meta">
    <span class="safe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Safety pass · 0 anatomical / off-brand</span>
    <span class="stat"><b>${slots.length}</b> videos</span>
    <span class="stat">every <b>2</b> days</span>
    <span class="stat">${esc(slots[0].date)} → ${esc(slots[slots.length - 1].date)}</span>
  </div>
  <div class="tablewrap"><table><thead><tr><th>#</th><th>Date</th><th>Theme</th><th>Topic</th></tr></thead><tbody>${rows}</tbody></table></div>
  <footer>Auto-generated + safety-screened by <code>scripts/plan-longs.mjs</code> from the shared bank in <code>niches-long.js</code>. The alternate-day long task picks from the same bank, skipping recent repeats.</footer>
</div>`;
}

main();
